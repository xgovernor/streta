import Feature, { type FeatureLike } from "ol/Feature";
import Draw from "ol/interaction/Draw";
import {
  LineString,
  Point,
  Polygon,
  type Geometry as OlGeometry,
} from "ol/geom";
import GeoJSON from "ol/format/GeoJSON";
import MVT from "ol/format/MVT";
import OlMap from "ol/Map";
import View from "ol/View";
import type BaseLayer from "ol/layer/Base";
import LayerGroup from "ol/layer/Group";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorTileLayer from "ol/layer/VectorTile";
import { unByKey } from "ol/Observable";
import { fromLonLat, transform } from "ol/proj";
import VectorSource from "ol/source/Vector";
import VectorTileSource from "ol/source/VectorTile";
import XYZ from "ol/source/XYZ";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import type { StyleFunction } from "ol/style/Style";
import type { EventsKey } from "ol/events";
import { apply } from "ol-mapbox-style";
import "./projections";
import { BASEMAPS } from "../lib/gis/data";
import { GEOGRAPHIC_CRS, VIEW_CRS } from "../lib/gis/crs";
import { orderedLayers } from "../lib/gis/datasets";
import { visibleFeatures } from "../lib/gis/filter";
import {
  eachPosition,
  geometryArea,
  geometryLength,
  haversineMeters,
} from "../lib/gis/geometry";
import type {
  BasemapDefinition,
  BasemapId,
  CameraState,
  DatasetLayer,
  Geometry,
  MeasureMode,
  MeasureSummary,
} from "../lib/gis/types";
import { formatArea, formatDistance } from "../lib/format";
import { measureGeodesic } from "../lib/gis/tiledBackend";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";
import { useUiStore } from "../state/uiStore";
import { createDatasetStyle, measureStyle } from "./vectorStyle";
import {
  createTelemetryLayers,
  updateFlightFeatures,
  updateEarthquakeFeatures,
  updateSatelliteFeatures,
  setTelemetryLayerVisibility,
  clearTelemetryLayers,
} from "./webglTelemetry";
import { useTelemetryStore } from "../state/telemetryStore";

type BasemapLayers = Record<BasemapId, BaseLayer>;

const BASEMAP_Z = 0;
const DATA_Z_BASE = 20;
const MEASURE_Z = 900;
const ANALYSIS_Z = 950;
const GRATICULE_Z = 5;

let activeMap: OlMap | null = null;
let activeTeardown: (() => void) | null = null;
let activeMeasureClear: (() => void) | null = null;
let activeAnalysisSource: VectorSource | null = null;
let activeBufferPicker: ((coord: [number, number]) => void) | null = null;

let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;
let hoveredTarget: { layerId: string; featureId: string } | null = null;
let isOverPopup = false;

const HOVER_DELAY_MS = 250;
const LEAVE_DELAY_MS = 150;

export function setPopupHovered(hovered: boolean): void {
  isOverPopup = hovered;
  if (hovered) {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  } else {
    if (!hoveredTarget && useMapStore.getState().activeFeature) {
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        if (!isOverPopup && !hoveredTarget) {
          useMapStore.getState().setActiveFeature(null);
        }
      }, LEAVE_DELAY_MS);
    }
  }
}

const geoJson = new GeoJSON();

function isDatasetLayer(layer: BaseLayer): boolean {
  return layer.get("dataset") === true;
}

function toGeoJsonFeature(feature: DatasetLayer["features"][number]) {
  return {
    type: "Feature",
    id: feature.id,
    geometry: feature.geometry,
    properties: feature.properties,
  };
}

/**
 * Builds map features for a layer. Reprojection happens inside OpenLayers, so a
 * single feature that cannot be represented should cost that feature only —
 * the good ones still draw.
 */
function toOlFeatures(layer: DatasetLayer): Feature<OlGeometry>[] {
  const options = { dataProjection: layer.crs, featureProjection: VIEW_CRS };
  // Attribute filters decide what draws; the layer keeps the rest of its data.
  const shown = visibleFeatures(layer);
  let features: Feature<OlGeometry>[] = [];
  let failed = 0;

  try {
    features = geoJson.readFeatures(
      {
        type: "FeatureCollection",
        features: shown.map(toGeoJsonFeature),
      } as never,
      options,
    ) as Feature<OlGeometry>[];
  } catch {
    features = [];

    for (const feature of shown) {
      try {
        features.push(
          ...(geoJson.readFeatures(
            {
              type: "FeatureCollection",
              features: [toGeoJsonFeature(feature)],
            } as never,
            options,
          ) as Feature<OlGeometry>[]),
        );
      } catch {
        failed += 1;
      }
    }
  }

  for (const feature of features) {
    feature.set("layerId", layer.id, true);
  }

  if (failed > 0) {
    console.warn(
      `${failed} feature${failed === 1 ? "" : "s"} in "${layer.name}" cannot be drawn in ${VIEW_CRS}`,
    );
  }

  return features;
}

function createGraticuleFeatures(): Feature<LineString>[] {
  const features: Feature<LineString>[] = [];

  for (let lon = -180; lon <= 180; lon += 30) {
    const feature = new Feature({
      geometry: new LineString([fromLonLat([lon, -85]), fromLonLat([lon, 85])]),
    });

    feature.set("major", lon === 0);
    features.push(feature);
  }

  for (let lat = -60; lat <= 60; lat += 30) {
    const feature = new Feature({
      geometry: new LineString([
        fromLonLat([-180, lat]),
        fromLonLat([180, lat]),
      ]),
    });

    feature.set("major", lat === 0);
    features.push(feature);
  }

  return features;
}

function graticuleStyle(feature: FeatureLike): Style {
  const major = feature.get("major") === true;

  return new Style({
    stroke: new Stroke({
      color: major ? "rgba(110,132,150,.62)" : "rgba(110,132,150,.32)",
      width: major ? 1.1 : 1,
      lineDash: major ? undefined : [3, 6],
    }),
  });
}

/**
 * One basemap layer, ready to be switched on. Vector styles become a group of
 * layers driven by `ol-mapbox-style`; raster services become a single tiled
 * layer reading their XYZ templates directly. Both live at the bottom of the
 * stack, so overlays and datasets always draw above them.
 */
function createBasemapLayer(
  basemap: BasemapDefinition,
  active: boolean,
): BaseLayer {
  const properties = { id: basemap.id, basemap: true };

  if (basemap.kind === "raster") {
    return new TileLayer({
      visible: active,
      source: new XYZ({
        urls: basemap.urls,
        attributions: basemap.attribution.map((item) => item.label),
        // Past this zoom the service has no new tiles, so OpenLayers scales
        // the deepest ones instead of requesting pages that do not exist.
        maxZoom: basemap.maxZoom,
      }),
      zIndex: BASEMAP_Z,
      properties,
    });
  }

  const group = new LayerGroup({ visible: active, properties });

  void apply(group, basemap.url)
    .then(() => {
      group.getLayers().forEach((layer) => layer.setZIndex(BASEMAP_Z));
    })
    .catch((error: unknown) => {
      console.error(`Failed to load ${basemap.name} basemap`, error);
    });

  return group;
}

function createBasemapLayers(active: BasemapId): BasemapLayers {
  return Object.fromEntries(
    BASEMAPS.map((basemap) => [
      basemap.id,
      createBasemapLayer(basemap, basemap.id === active),
    ]),
  ) as BasemapLayers;
}

interface LayerBinding {
  layer: VectorLayer<VectorSource> | VectorTileLayer;
  features: DatasetLayer["features"];
  filters: DatasetLayer["filters"];
  style: DatasetLayer["style"];
  tileUrl?: string;
}

export function mountMap(target: HTMLElement): () => void {
  activeTeardown?.();

  const ui = useUiStore.getState();
  const project = useProjectStore.getState();
  const initialCamera = useMapStore.getState().camera;

  const basemapLayers = createBasemapLayers(ui.basemap);

  const graticuleLayer = new VectorLayer({
    source: new VectorSource({ features: createGraticuleFeatures() }),
    style: graticuleStyle,
    visible: false,
    zIndex: GRATICULE_Z,
    properties: { id: "graticule", overlay: true },
  });

  const measureSource = new VectorSource();
  const measureLayer = new VectorLayer({
    source: measureSource,
    style: measureSketchStyle,
    zIndex: MEASURE_Z,
    properties: { id: "measure", overlay: true },
  });

  const analysisSource = new VectorSource();
  const analysisLayer = new VectorLayer({
    source: analysisSource,
    style: analysisStyle,
    zIndex: ANALYSIS_Z,
    properties: { id: "analysis", overlay: true },
  });
  activeAnalysisSource = analysisSource;

  const view = new View({
    center: fromLonLat([initialCamera.lon, initialCamera.lat]),
    zoom: initialCamera.zoom,
    rotation: initialCamera.rotation,
    minZoom: 1.4,
    maxZoom: 22,
    constrainResolution: false,
  });

  const map = new OlMap({
    target,
    view,
    layers: [...Object.values(basemapLayers), graticuleLayer, measureLayer, analysisLayer],
    controls: [],
  });

  activeMap = map;

  createTelemetryLayers(map);

  if (import.meta.env.DEV) {
    (window as unknown as { __strataMap?: OlMap }).__strataMap = map;
  }

  const bindings = new Map<string, LayerBinding>();

  const syncDatasetLayers = (layers: DatasetLayer[]) => {
    const wanted = new Set(layers.map((layer) => layer.id));

    for (const [id, binding] of bindings) {
      if (!wanted.has(id)) {
        map.removeLayer(binding.layer);
        bindings.delete(id);
      }
    }

    layers.forEach((layer, index) => {
      let binding = bindings.get(layer.id);
      const isMvt = Boolean(layer.tileUrl || layer.format === "mvt");
      const tileUrl = layer.tileUrl ?? `strata://tiles/${layer.id}/{z}/{x}/{y}.pbf`;

      if (!binding) {
        if (isMvt) {
          const vtLayer = new VectorTileLayer({
            source: new VectorTileSource({
              format: new MVT({ idProperty: "id" }),
              url: tileUrl,
              maxZoom: 22,
            }),
            style: createDatasetStyle(layer, isSelectedIn(layer.id)),
            declutter: true,
            properties: { id: layer.id, dataset: true },
          });

          map.addLayer(vtLayer);
          binding = {
            layer: vtLayer,
            features: layer.features,
            filters: layer.filters,
            style: layer.style,
            tileUrl,
          };
          bindings.set(layer.id, binding);
        } else {
          const vectorLayer = new VectorLayer({
            source: new VectorSource({ features: toOlFeatures(layer) }),
            style: createDatasetStyle(layer, isSelectedIn(layer.id)),
            declutter: true,
            properties: { id: layer.id, dataset: true },
          });

          map.addLayer(vectorLayer);
          binding = {
            layer: vectorLayer,
            features: layer.features,
            filters: layer.filters,
            style: layer.style,
          };
          bindings.set(layer.id, binding);
        }
      } else {
        const currentIsMvt = binding.layer instanceof VectorTileLayer;
        if (isMvt !== currentIsMvt || (isMvt && binding.tileUrl !== tileUrl)) {
          map.removeLayer(binding.layer);
          if (isMvt) {
            const vtLayer = new VectorTileLayer({
              source: new VectorTileSource({
                format: new MVT({ idProperty: "id" }),
                url: tileUrl,
                maxZoom: 22,
              }),
              style: createDatasetStyle(layer, isSelectedIn(layer.id)),
              declutter: true,
              properties: { id: layer.id, dataset: true },
            });
            map.addLayer(vtLayer);
            binding.layer = vtLayer;
            binding.tileUrl = tileUrl;
          } else {
            const vectorLayer = new VectorLayer({
              source: new VectorSource({ features: toOlFeatures(layer) }),
              style: createDatasetStyle(layer, isSelectedIn(layer.id)),
              declutter: true,
              properties: { id: layer.id, dataset: true },
            });
            map.addLayer(vectorLayer);
            binding.layer = vectorLayer;
            binding.tileUrl = undefined;
          }
        } else if (!isMvt && (binding.features !== layer.features || binding.filters !== layer.filters)) {
          (binding.layer as VectorLayer<VectorSource>).setSource(
            new VectorSource({ features: toOlFeatures(layer) }),
          );
        }
        binding.features = layer.features;
        binding.filters = layer.filters;
      }

      if (binding.style !== layer.style) {
        binding.layer.setStyle(
          createDatasetStyle(layer, isSelectedIn(layer.id)),
        );
        binding.style = layer.style;
      }

      binding.layer.setVisible(layer.visible);
      binding.layer.setOpacity(layer.opacity);
      // The caller hands the layers over in draw order: datasets in sequence,
      // and inside each dataset its own stack.
      binding.layer.setZIndex(DATA_Z_BASE + index * 10);
    });
  };

  function isSelectedIn(layerId: string) {
    return (featureId: string) => {
      const selection = useProjectStore.getState().selection;
      return (
        selection?.layerId === layerId && selection.featureId === featureId
      );
    };
  }

  const applyBasemap = (id: BasemapId) => {
    for (const [key, layer] of Object.entries(basemapLayers)) {
      layer.setVisible(key === id);
    }
  };

  /** Repaints dataset layers so selection highlight follows store changes. */
  const repaint = () => {
    for (const binding of bindings.values()) {
      binding.layer.changed();
    }
  };

  const topFeatureAt = (
    pixel: number[],
  ): { feature: FeatureLike; layerId: string } | null => {
    const hits: { feature: FeatureLike; layerId: string }[] = [];

    map.forEachFeatureAtPixel(
      pixel,
      (feature, layer) => {
        const layerId = layer ? String(layer.get("id") ?? "") : String(feature.get("layerId") ?? "");
        hits.push({
          feature,
          layerId,
        });
        return true;
      },
      { hitTolerance: 6, layerFilter: isDatasetLayer },
    );

    return hits.length ? hits[0] : null;
  };

  const emitCamera = () => {
    const center = view.getCenter();
    if (!center) {
      return;
    }

    const [lon, lat] = transform(center, VIEW_CRS, GEOGRAPHIC_CRS);
    useMapStore.getState().setCamera({
      lon,
      lat,
      zoom: view.getZoom() ?? 0,
      rotation: view.getRotation(),
      resolution: view.getResolution() ?? 0,
    });
  };

  const cameraKeys: EventsKey[] = [
    view.on("change:center", emitCamera),
    view.on("change:resolution", emitCamera),
    view.on("change:rotation", emitCamera),
  ];

  const hoverLabelFor = (
    feature: FeatureLike,
    layerId: string,
  ): string | null => {
    const layer = useProjectStore
      .getState()
      .layers.find((item) => item.id === layerId);

    if (!layer) {
      return null;
    }

    const field = layer.style.labelField ?? layer.fields[0]?.name ?? null;
    const value = field ? feature.get(field) : null;

    return value === null || value === undefined ?
        layer.name
      : `${layer.name} · ${value}`;
  };

  const pointerKey = map.on("pointermove", (event) => {
    const [lon, lat] = transform(event.coordinate, VIEW_CRS, GEOGRAPHIC_CRS);
    const hit = topFeatureAt(event.pixel);
    const store = useMapStore.getState();

    let hover: { layerId: string; featureId: string; lon: number; lat: number; properties?: Record<string, unknown> } | null = null;

    if (hit) {
      const rawId =
        hit.feature.getId?.() ??
        hit.feature.get("_id") ??
        hit.feature.get("id");

      if (rawId !== undefined && rawId !== null) {
        const properties = (hit.feature as { getProperties?: () => Record<string, unknown> }).getProperties?.();
        hover = {
          layerId: hit.layerId,
          featureId: String(rawId),
          lon,
          lat,
          properties,
        };
      }
    }

    store.setPointer(
      { lon, lat },
      { x: event.coordinate[0], y: event.coordinate[1] },
    );
    store.setHoverLabel(hover ? hoverLabelFor(hit!.feature, hit!.layerId) : null);

    const element = map.getTargetElement();
    if (element) {
      element.style.cursor =
        useProjectStore.getState().measureMode !== "off" ? "crosshair"
        : hover ? "pointer"
        : "";
    }

    if (!hover) {
      hoveredTarget = null;
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      if (!isOverPopup && store.activeFeature && !leaveTimer) {
        leaveTimer = setTimeout(() => {
          leaveTimer = null;
          if (!isOverPopup && !hoveredTarget) {
            useMapStore.getState().setActiveFeature(null);
          }
        }, LEAVE_DELAY_MS);
      }
    } else {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }

      const isSameFeature =
        hoveredTarget?.layerId === hover.layerId &&
        hoveredTarget?.featureId === hover.featureId;

      if (!isSameFeature) {
        hoveredTarget = { layerId: hover.layerId, featureId: hover.featureId };

        if (hoverTimer) {
          clearTimeout(hoverTimer);
          hoverTimer = null;
        }

        const candidate = hover;
        hoverTimer = setTimeout(() => {
          hoverTimer = null;
          if (
            hoveredTarget?.layerId === candidate.layerId &&
            hoveredTarget?.featureId === candidate.featureId
          ) {
            useMapStore.getState().setActiveFeature(candidate);
          }
        }, HOVER_DELAY_MS);
      }
    }
  });

  const handlePointerLeave = () => {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    hoveredTarget = null;

    const store = useMapStore.getState();
    store.setPointer(null, null);
    store.setHoverLabel(null);

    if (!isOverPopup && store.activeFeature) {
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        if (!isOverPopup && !hoveredTarget) {
          useMapStore.getState().setActiveFeature(null);
        }
      }, LEAVE_DELAY_MS);
    }

    const element = map.getTargetElement();
    if (element) {
      element.style.cursor = "";
    }
  };

  target.addEventListener("pointerleave", handlePointerLeave);

  const dragKey = map.on("pointerdrag", () => {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
    hoveredTarget = null;
    useMapStore.getState().setActiveFeature(null);
  });

  const clickKey = map.on("singleclick", (event) => {
    if (activeBufferPicker) {
      const [lon, lat] = transform(event.coordinate, VIEW_CRS, GEOGRAPHIC_CRS) as [number, number];
      activeBufferPicker([lon, lat]);
      return;
    }

    if (useProjectStore.getState().measureMode !== "off") {
      return;
    }

    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
    hoveredTarget = null;
    isOverPopup = false;

    // Check if user clicked a telemetry target (flight, earthquake, or satellite)
    let hitTelemetry: { type: "flight" | "earthquake" | "satellite"; data: unknown } | null = null;
    map.forEachFeatureAtPixel(
      event.pixel,
      (feature) => {
        const t = feature.get("telemetryType");
        if (t === "flight" || t === "earthquake" || t === "satellite") {
          hitTelemetry = { type: t, data: feature.get("raw") };
          return true;
        }
        return false;
      },
      { hitTolerance: 8 }
    );

    if (hitTelemetry) {
      useTelemetryStore.getState().setSelectedTarget(hitTelemetry as any);
      useUiStore.getState().openPanel("telemetry");
      return;
    }

    const hit = topFeatureAt(event.pixel);

    if (!hit) {
      useProjectStore.getState().clearSelection();
      useMapStore.getState().setPopup(null);
      useMapStore.getState().setActiveFeature(null);
      return;
    }

    const rawId =
      hit.feature.getId?.() ??
      hit.feature.get("_id") ??
      hit.feature.get("id");

    if (rawId === undefined || rawId === null) {
      return;
    }

    // A click selects the feature and opens the detailed feature panel directly (details, not popup)
    useProjectStore.getState().select({
      layerId: hit.layerId,
      featureId: String(rawId),
    });
    useMapStore.getState().setPopup(null);
    useMapStore.getState().setActiveFeature(null);
    useUiStore.getState().openPanel("feature");
  });

  let draw: Draw | null = null;
  let sketchKey: EventsKey | null = null;

  const clearMeasureSketch = () => {
    measureSource.clear();
    useProjectStore.getState().setMeasureSummary(null);
  };

  const applyMeasureMode = (mode: MeasureMode) => {
    if (draw) {
      map.removeInteraction(draw);
      draw = null;
    }

    if (sketchKey) {
      unByKey(sketchKey);
      sketchKey = null;
    }

    if (mode !== "distance" && mode !== "area") {
      clearMeasureSketch();
      return;
    }

    clearMeasureSketch();

    const interaction = new Draw({
      source: measureSource,
      type: mode === "area" ? "Polygon" : "LineString",
      style: measureSketchStyle as StyleFunction,
    });

    interaction.on("drawstart", (event) => {
      measureSource.clear();
      const geometry = event.feature.getGeometry();

      if (!geometry) {
        return;
      }

      const update = () =>
        useProjectStore
          .getState()
          .setMeasureSummary(summarizeGeometry(geometry, mode));

      update();
      sketchKey = geometry.on("change", update);
    });

    interaction.on("drawend", (event) => {
      if (sketchKey) {
        unByKey(sketchKey);
        sketchKey = null;
      }

      const geometry = event.feature.getGeometry();

      if (geometry) {
        useProjectStore
          .getState()
          .setMeasureSummary(summarizeGeometry(geometry, mode));
      }
    });

    map.addInteraction(interaction);
    draw = interaction;
  };

  activeMeasureClear = clearMeasureSketch;

  const projectUnsubscribe = useProjectStore.subscribe((state, previous) => {
    if (
      state.layers !== previous.layers ||
      state.datasets !== previous.datasets
    ) {
      syncDatasetLayers(orderedLayers(state.datasets, state.layers));
    }

    if (state.selection !== previous.selection) {
      repaint();
    }

    if (state.measureMode !== previous.measureMode) {
      applyMeasureMode(state.measureMode);
    }
  });

  const uiUnsubscribe = useUiStore.subscribe((state, previous) => {
    if (state.basemap !== previous.basemap) {
      applyBasemap(state.basemap);
    }

    if (state.graticule !== previous.graticule) {
      graticuleLayer.setVisible(state.graticule);
    }
  });

  const readyKey = map.once("postrender", () => {
    target.classList.add("is-ready");
    useMapStore.getState().setReady(true);
  });

  const sizeFrame = window.requestAnimationFrame(() => map.updateSize());

  applyBasemap(ui.basemap);
  graticuleLayer.setVisible(ui.graticule);
  syncDatasetLayers(orderedLayers(project.datasets, project.layers));
  applyMeasureMode(project.measureMode);
  emitCamera();

  const telemetryUnsubscribe = useTelemetryStore.subscribe((state, previous) => {
    if (state.flights !== previous.flights) {
      updateFlightFeatures(state.flights);
    }
    if (state.earthquakes !== previous.earthquakes) {
      updateEarthquakeFeatures(state.earthquakes);
    }
    if (state.satellites !== previous.satellites) {
      updateSatelliteFeatures(state.satellites);
    }
    if (state.flightsEnabled !== previous.flightsEnabled) {
      setTelemetryLayerVisibility("flights", state.flightsEnabled);
    }
    if (state.earthquakesEnabled !== previous.earthquakesEnabled) {
      setTelemetryLayerVisibility("earthquakes", state.earthquakesEnabled);
    }
    if (state.satellitesEnabled !== previous.satellitesEnabled) {
      setTelemetryLayerVisibility("satellites", state.satellitesEnabled);
    }
  });

  const initTelemetry = useTelemetryStore.getState();
  if (initTelemetry.flights.length > 0) updateFlightFeatures(initTelemetry.flights);
  if (initTelemetry.earthquakes.length > 0) updateEarthquakeFeatures(initTelemetry.earthquakes);
  if (initTelemetry.satellites.length > 0) updateSatelliteFeatures(initTelemetry.satellites);
  if (
    initTelemetry.flights.length === 0 &&
    initTelemetry.earthquakes.length === 0 &&
    initTelemetry.satellites.length === 0
  ) {
    void initTelemetry.refreshFeeds();
  }

  let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  const setupAutoRefresh = (seconds: number) => {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    if (seconds > 0) {
      autoRefreshTimer = setInterval(() => {
        void useTelemetryStore.getState().refreshFeeds();
      }, seconds * 1000);
    }
  };
  setupAutoRefresh(initTelemetry.autoRefreshSeconds);

  const autoRefreshSub = useTelemetryStore.subscribe((state, prev) => {
    if (state.autoRefreshSeconds !== prev.autoRefreshSeconds) {
      setupAutoRefresh(state.autoRefreshSeconds);
    }
  });

  const teardown = () => {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    autoRefreshSub();
    activeMeasureClear = null;
    window.cancelAnimationFrame(sizeFrame);
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
    hoveredTarget = null;
    isOverPopup = false;
    target.removeEventListener("pointerleave", handlePointerLeave);
    unByKey(cameraKeys);
    unByKey(pointerKey);
    unByKey(dragKey);
    unByKey(clickKey);
    unByKey(readyKey);

    if (sketchKey) {
      unByKey(sketchKey);
    }

    projectUnsubscribe();
    uiUnsubscribe();
    telemetryUnsubscribe();
    clearTelemetryLayers();

    target.classList.remove("is-ready");
    map.setTarget(undefined);
    map.dispose();
    bindings.clear();

    if (activeTeardown === teardown) {
      activeTeardown = null;
    }

    activeAnalysisSource = null;
    activeBufferPicker = null;

    if (activeMap === map) {
      activeMap = null;
      useMapStore.getState().setReady(false);
      useMapStore.getState().setPointer(null, null);
      useMapStore.getState().setHoverLabel(null);
    }
  };

  activeTeardown = teardown;
  return teardown;
}

/** Converts a view-space geometry into the geodesic math module's shape. */
function toGeographic(geometry: OlGeometry): Geometry | null {
  const clone = geometry.clone();
  clone.transform(VIEW_CRS, GEOGRAPHIC_CRS);
  const type = clone.getType();

  if (type === "LineString" || type === "Polygon") {
    return {
      type,
      coordinates: (clone as LineString | Polygon).getCoordinates(),
    };
  }

  return null;
}

function summarizeGeometry(
  geometry: OlGeometry,
  mode: "distance" | "area",
): MeasureSummary | null {
  const geographic = toGeographic(geometry);

  if (!geographic) {
    return null;
  }

  let vertices = 0;
  eachPosition(geographic, () => {
    vertices += 1;
  });

  const coords: [number, number][] =
    geographic.type === "LineString"
      ? (geographic.coordinates as [number, number][])
      : ((geographic.coordinates as [number, number][][])[0] ?? []);

  if (coords && coords.length >= 2) {
    measureGeodesic(coords, mode === "area").then((details) => {
      if (details) {
        const current = useProjectStore.getState().measureSummary;
        if (current && current.mode === mode) {
          useProjectStore.getState().setMeasureSummary({
            ...current,
            distance: details.total_distance_m,
            area: details.area_sq_m ?? current.area,
            geodesicDetails: details,
          });
        }
      }
    });
  }

  return {
    mode,
    distance: geometryLength(geographic),
    area: mode === "area" ? geometryArea(geographic) : 0,
    vertices,
  };
}


const SEGMENT_LABEL = new Text({
  font: '600 10.5px "IBM Plex Mono", monospace',
  fill: new Fill({ color: "#101820" }),
  stroke: new Stroke({ color: "rgba(255,255,255,.94)", width: 3 }),
  overflow: true,
});

/**
 * Sketch style: the measure outline plus live per-segment lengths (and the
 * enclosed area), so the numbers are readable where the user is looking.
 */
function measureSketchStyle(feature: FeatureLike, resolution: number): Style[] {
  const styles = measureStyle(feature, resolution);
  const shape = feature.getGeometry() as OlGeometry | undefined;

  if (!shape || resolution > 12_000) {
    return styles;
  }

  if (shape.getType() === "LineString") {
    const coordinates = (shape as LineString).getCoordinates();

    for (let index = 1; index < coordinates.length; index += 1) {
      const from = coordinates[index - 1];
      const to = coordinates[index];
      const start = transform(from, VIEW_CRS, GEOGRAPHIC_CRS);
      const end = transform(to, VIEW_CRS, GEOGRAPHIC_CRS);
      const meters = haversineMeters(start, end);

      if (!Number.isFinite(meters) || meters <= 0) {
        continue;
      }

      styles.push(
        new Style({
          geometry: new Point([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]),
          text: new Text({
            text: formatDistance(meters),
            font: SEGMENT_LABEL.getFont(),
            fill: SEGMENT_LABEL.getFill() ?? undefined,
            stroke: SEGMENT_LABEL.getStroke() ?? undefined,
            offsetY: -12,
            overflow: true,
          }),
          zIndex: 20,
        }),
      );
    }

    return styles;
  }

  if (shape.getType() === "Polygon") {
    const geographic = toGeographic(shape);
    const area = geographic ? geometryArea(geographic) : 0;

    if (area <= 0) {
      return styles;
    }

    const interior = (shape as Polygon).getInteriorPoint().getCoordinates();

    styles.push(
      new Style({
        geometry: new Point(interior),
        text: new Text({
          text: formatArea(area),
          font: SEGMENT_LABEL.getFont(),
          fill: SEGMENT_LABEL.getFill() ?? undefined,
          stroke: SEGMENT_LABEL.getStroke() ?? undefined,
          overflow: true,
        }),
        zIndex: 20,
      }),
    );
  }

  return styles;
}

export function flyTo(lon: number, lat: number, zoom = 8): void {
  const view = activeMap?.getView();
  if (!view) {
    return;
  }

  view.animate({
    center: fromLonLat([lon, lat]),
    zoom,
    duration: 650,
  });
}

export function zoomBy(delta: number): void {
  const view = activeMap?.getView();
  if (!view) {
    return;
  }

  const zoom = view.getZoom() ?? 0;
  view.animate({
    zoom: Math.max(
      view.getMinZoom(),
      Math.min(view.getMaxZoom(), zoom + delta),
    ),
    duration: 240,
  });
}

export function resetNorth(): void {
  activeMap?.getView().animate({ rotation: 0, duration: 320 });
}

/** Jumps the map to a stored camera, used when a project is opened. */
export function applyCamera(camera: CameraState): void {
  const view = activeMap?.getView();

  if (!view) {
    return;
  }

  view.animate({
    center: fromLonLat([camera.lon, camera.lat]),
    zoom: camera.zoom,
    rotation: camera.rotation,
    duration: 0,
  });
}

interface ExtentTarget {
  extent: [number, number, number, number];
  maxZoom: number;
}

/** Union of every visible dataset extent, read from the live sources. */
function visibleDataExtent(): ExtentTarget | null {
  const map = activeMap;

  if (!map) {
    return null;
  }

  const extents: [number, number, number, number][] = [];

  map.getLayers().forEach((layer) => {
    if (!isDatasetLayer(layer) || !layer.getVisible()) {
      return;
    }

    const source = (layer as VectorLayer<VectorSource>).getSource();
    const found = source?.getExtent();

    if (found && Number.isFinite(found[0])) {
      extents.push([found[0], found[1], found[2], found[3]]);
    }
  });

  if (!extents.length) {
    return null;
  }

  const extent = extents.reduce<[number, number, number, number]>(
    (accumulated, current) => [
      Math.min(accumulated[0], current[0]),
      Math.min(accumulated[1], current[1]),
      Math.max(accumulated[2], current[2]),
      Math.max(accumulated[3], current[3]),
    ],
    [...extents[0]] as [number, number, number, number],
  );

  return { extent, maxZoom: 12 };
}

/** Reads the extent of one live dataset layer by id. */
function layerExtent(layerId: string): [number, number, number, number] | null {
  const map = activeMap;

  if (!map) {
    return null;
  }

  const found: [number, number, number, number][] = [];

  map.getLayers().forEach((layer) => {
    if (!isDatasetLayer(layer) || layer.get("id") !== layerId) {
      return;
    }

    const extent = (layer as VectorLayer<VectorSource>)
      .getSource()
      ?.getExtent();

    if (extent && Number.isFinite(extent[0])) {
      found.push([extent[0], extent[1], extent[2], extent[3]]);
    }
  });

  return found.length ? found[0] : null;
}

export function fitToData(): void {
  const target = visibleDataExtent();

  if (!target) {
    return;
  }

  activeMap?.getView().fit(target.extent, {
    padding: [110, 170, 90, 170],
    duration: 700,
    maxZoom: target.maxZoom,
  });
}

/**
 * Where a WGS 84 point sits in the viewport right now. The click card follows
 * the map by asking again whenever the camera moves, so panning does not leave
 * it behind.
 */
export function screenPositionFor(
  lon: number,
  lat: number,
): { x: number; y: number } | null {
  const map = activeMap;

  if (!map) {
    return null;
  }

  const pixel = map.getPixelFromCoordinate(fromLonLat([lon, lat]));
  return pixel ? { x: pixel[0], y: pixel[1] } : null;
}

export function zoomToLayer(id: string): void {
  const map = activeMap;
  const extent = layerExtent(id);

  if (!map || !extent) {
    return;
  }

  map.getView().fit(extent, {
    padding: [120, 190, 100, 190],
    duration: 650,
    maxZoom: 16,
  });
}

export function zoomToSelection(): void {
  const map = activeMap;
  const selection = useProjectStore.getState().selection;

  if (!map || !selection) {
    return;
  }

  const extents: [number, number, number, number][] = [];

  map.getLayers().forEach((layer) => {
    if (!isDatasetLayer(layer) || layer.get("id") !== selection.layerId) {
      return;
    }

    const source = (layer as VectorLayer<VectorSource>).getSource();
    const found = source
      ?.getFeatureById(selection.featureId)
      ?.getGeometry()
      ?.getExtent();

    if (found && Number.isFinite(found[0])) {
      // A point has a degenerate extent: pad it by a few pixels' worth of ground.
      const pad = (map.getView().getResolution() ?? 1) * 40;
      const degenerate = found[0] === found[2] && found[1] === found[3];

      extents.push(
        degenerate ?
          [found[0] - pad, found[1] - pad, found[2] + pad, found[3] + pad]
        : [found[0], found[1], found[2], found[3]],
      );
    }
  });

  if (!extents.length) {
    return;
  }

  map.getView().fit(extents[0], {
    padding: [140, 200, 120, 200],
    duration: 600,
    maxZoom: 17,
  });
}

/** WGS 84 vertices of the current measurement, for copying out of the panel. */
export function measureCoordinates(): [number, number][] {
  const map = activeMap;

  if (!map) {
    return [];
  }

  const rings: [number, number][][] = [];

  map.getLayers().forEach((layer) => {
    if (layer.get("id") !== "measure") {
      return;
    }

    const geometry = (layer as VectorLayer<VectorSource>)
      .getSource()
      ?.getFeatures()[0]
      ?.getGeometry();

    if (!geometry) {
      return;
    }

    if (geometry.getType() === "LineString") {
      rings.push(
        (geometry as LineString).getCoordinates() as [number, number][],
      );
    } else if (geometry.getType() === "Polygon") {
      rings.push(
        (geometry as Polygon).getCoordinates()[0] as [number, number][],
      );
    }
  });

  return (rings[0] ?? []).map((coordinate) => {
    const [lon, lat] = transform(coordinate, VIEW_CRS, GEOGRAPHIC_CRS);
    return [lon, lat] as [number, number];
  });
}

/** Removes the measurement sketch; wired up by the mounted map. */
export function clearMeasureSketch(): void {
  activeMeasureClear?.();
}

/**
 * Analytical overlay styling for geodesic buffer polygons and profile hover markers.
 */
function analysisStyle(feature: FeatureLike): Style | Style[] {
  const type = feature.get("analysisType");

  if (type === "buffer") {
    return new Style({
      stroke: new Stroke({
        color: "#06b6d4",
        width: 2,
        lineDash: [6, 4],
      }),
      fill: new Fill({
        color: "rgba(6, 182, 212, 0.12)",
      }),
    });
  }

  if (type === "bufferCenter") {
    return [
      new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: "#06b6d4" }),
          stroke: new Stroke({ color: "#ffffff", width: 2 }),
        }),
      }),
    ];
  }

  if (type === "profileHover") {
    const elevation = feature.get("elevationM");
    const label = elevation != null ? `${Math.round(elevation)}m` : "";
    return [
      new Style({
        image: new CircleStyle({
          radius: 10,
          fill: new Fill({ color: "rgba(6, 182, 212, 0.25)" }),
        }),
      }),
      new Style({
        image: new CircleStyle({
          radius: 5,
          fill: new Fill({ color: "#ffffff" }),
          stroke: new Stroke({ color: "#06b6d4", width: 2.5 }),
        }),
        text: label
          ? new Text({
              text: label,
              font: '600 11px "IBM Plex Mono", monospace',
              fill: new Fill({ color: "#06b6d4" }),
              stroke: new Stroke({ color: "#101820", width: 3 }),
              offsetY: -16,
            })
          : undefined,
      }),
    ];
  }

  return new Style();
}

/**
 * Renders a geodesic buffer polygon and optional center marker on the analysis overlay layer.
 */
export function renderBufferOverlay(
  bufferGeoJson: any,
  centerCoord?: [number, number],
  radiusMeters?: number,
): void {
  if (!activeAnalysisSource) return;
  activeAnalysisSource.clear();

  if (bufferGeoJson) {
    const features = geoJson.readFeatures(bufferGeoJson, {
      dataProjection: GEOGRAPHIC_CRS,
      featureProjection: VIEW_CRS,
    });
    features.forEach((f) => f.set("analysisType", "buffer"));
    activeAnalysisSource.addFeatures(features);
  }

  if (centerCoord) {
    const centerFeature = new Feature({
      geometry: new Point(fromLonLat(centerCoord)),
    });
    centerFeature.set("analysisType", "bufferCenter");
    centerFeature.set("radiusMeters", radiusMeters);
    activeAnalysisSource.addFeature(centerFeature);
  }
}

/** Clears all features from the buffer and analysis overlay layer. */
export function clearBufferOverlay(): void {
  activeAnalysisSource?.clear();
}

/**
 * Places or removes a synchronized hover cursor on the map corresponding to
 * the active inspection point in the elevation profile chart.
 */
export function setProfileHoverCoord(
  coord: [number, number] | null,
  elevationM?: number,
): void {
  if (!activeAnalysisSource) return;

  const existing = activeAnalysisSource
    .getFeatures()
    .filter((f) => f.get("analysisType") === "profileHover");
  existing.forEach((f) => activeAnalysisSource?.removeFeature(f));

  if (coord) {
    const hoverFeature = new Feature({
      geometry: new Point(fromLonLat(coord)),
    });
    hoverFeature.set("analysisType", "profileHover");
    hoverFeature.set("elevationM", elevationM);
    activeAnalysisSource.addFeature(hoverFeature);
  }
}

/**
 * Enables or disables interactive click-to-pick on the map for selecting buffer query center.
 */
export function setBufferPicker(
  picker: ((coord: [number, number]) => void) | null,
): void {
  activeBufferPicker = picker;
  if (activeMap) {
    const target = activeMap.getTargetElement();
    if (target) {
      target.style.cursor = picker ? "crosshair" : "";
    }
  }
}

/**
 * Smoothly animates the map camera to the target lon/lat.
 */
export function flyToCoordinate(lon: number, lat: number, zoom = 14): void {
  if (!activeMap) return;
  activeMap.getView().animate({
    center: fromLonLat([lon, lat]),
    zoom,
    duration: 500,
  });
}

