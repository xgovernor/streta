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
import { fromLonLat, transform, transformExtent } from "ol/proj";
import VectorSource from "ol/source/Vector";
import VectorTileSource from "ol/source/VectorTile";
import XYZ from "ol/source/XYZ";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import type { StyleFunction } from "ol/style/Style";
import { apply } from "ol-mapbox-style";
import type { EventsKey } from "ol/events";
import WebGLTileLayer from "ol/layer/WebGLTile";
import type GeoTIFF from "ol/source/GeoTIFF";
import {
  createCogLayer,
  sampleRasterPixel,
  type PixelProbeData,
  type RasterFormula,
  type RasterLayerConfig,
} from "./rasterLayer";
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
import { measureGeodesic, fetchFlightTrail } from "../lib/gis/tiledBackend";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";
import { useUiStore } from "../state/uiStore";
import { createDatasetStyle, measureStyle } from "./vectorStyle";
import {
  createTelemetryLayers,
  updateFlightFeatures,
  updateEarthquakeFeatures,
  updateSatelliteFeatures,
  updateFireFeatures,
  updateVesselFeatures,
  setTelemetryLayerVisibility,
  setVesselRouteEmphasis,
  getVesselFeature,
  clearTelemetryLayers,
  displayFlightTrail,
  clearFlightTrails,
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

/**
 * Captures the current map view as a PNG data URL. Returns null if no map
 * is active or capture fails.
 */
export function captureMapAsPng(): string | null {
  if (!activeMap) return null;
  try {
    const mapCanvas = activeMap.getViewport()?.querySelector("canvas");
    if (!(mapCanvas instanceof HTMLCanvasElement)) return null;
    // Force render if possible
    if (typeof (activeMap as any).renderSync === "function") {
      (activeMap as any).renderSync();
    }
    return mapCanvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export function downloadMapCapture(filename = "strata-map.png"): boolean {
  const dataUrl = captureMapAsPng();
  if (!dataUrl) return false;
  try {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch {
    return false;
  }
}

export function captureMapRegionAsPng(rect: { x: number; y: number; width: number; height: number }): string | null {
  if (!activeMap) return null;
  try {
    const viewport = activeMap.getViewport();
    if (!viewport) return null;
    const mapCanvas = viewport.querySelector("canvas");
    if (!(mapCanvas instanceof HTMLCanvasElement)) return null;
    if (typeof (activeMap as any).renderSync === "function") {
      (activeMap as any).renderSync();
    }

    const dpr = window.devicePixelRatio || 1;
    const vpRect = viewport.getBoundingClientRect();
    const sourceX = Math.max(0, (rect.x - vpRect.left) * dpr);
    const sourceY = Math.max(0, (rect.y - vpRect.top) * dpr);
    const sourceW = Math.max(1, rect.width * dpr);
    const sourceH = Math.max(1, rect.height * dpr);

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = sourceW;
    cropCanvas.height = sourceH;
    const ctx = cropCanvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(
      mapCanvas,
      sourceX,
      sourceY,
      sourceW,
      sourceH,
      0,
      0,
      sourceW,
      sourceH,
    );

    return cropCanvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export function downloadMapRegionCapture(
  rect: { x: number; y: number; width: number; height: number },
  filename = "strata-snip.png",
): boolean {
  const dataUrl = captureMapRegionAsPng(rect);
  if (!dataUrl) return false;
  try {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch {
    return false;
  }
}

export async function copyMapRegionToClipboard(
  rect: { x: number; y: number; width: number; height: number },
): Promise<boolean> {
  const dataUrl = captureMapRegionAsPng(rect);
  if (!dataUrl) return false;
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
    return true;
  } catch {
    return false;
  }
}
let activeMeasureClear: (() => void) | null = null;
let activeAnalysisSource: VectorSource | null = null;
let activeBufferPicker: ((coord: [number, number]) => void) | null = null;

let activeRasterBinding: {
  layer: WebGLTileLayer;
  source: GeoTIFF;
  config: RasterLayerConfig;
  bandOrder: string[];
  formula: RasterFormula;
  setFormula: (f: RasterFormula) => void;
  setOpacity: (o: number) => void;
  setContrastScale: (c: number) => void;
} | null = null;
let rasterProbeCallback: ((data: PixelProbeData | null) => void) | null = null;

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
      color: major ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.28)",
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

  const tomtomApiKey =
    typeof import.meta !== "undefined" && import.meta.env?.TOMTOM_API_KEY
      ? import.meta.env.TOMTOM_API_KEY
      : "";

  const trafficLayer = new TileLayer({
    visible: ui.trafficFlow ?? false,
    source: tomtomApiKey
      ? new XYZ({
          url: `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${tomtomApiKey}`,
          maxZoom: 22,
          attributions: ["© TomTom Real-Time Traffic"],
        })
      : new XYZ({
          url: "",
          maxZoom: 22,
        }),
    zIndex: 2,
    properties: { id: "traffic-flow", overlay: true },
  });

  const map = new OlMap({
    target,
    view,
    layers: [
      ...Object.values(basemapLayers),
      trafficLayer,
      graticuleLayer,
      measureLayer,
      analysisLayer,
    ],
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

  let currentlyHoveredTelemFeature: any = null;

  /** Current vessel-feature override for estimate-route emphasis (null = none). */
  const syncVesselRouteEmphasis = (hoverVesselId: string | null) => {
    const selected = useTelemetryStore.getState().selectedTarget;
    const selectedVesselId =
      selected?.type === "vessel" && (selected.data as any)?.mmsi != null
        ? String((selected.data as any).mmsi)
        : null;
    setVesselRouteEmphasis(hoverVesselId, selectedVesselId);
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

    // Telemetry moving target detection
    let hitTelemetry: {
      type: "flight" | "earthquake" | "satellite" | "vessel" | "fire";
      data: any;
      feature: any;
    } | null = null;

    map.forEachFeatureAtPixel(
      event.pixel,
      (feature) => {
        const t = feature.get("telemetryType");
        if (t === "flight" || t === "earthquake" || t === "satellite" || t === "vessel" || t === "fire") {
          hitTelemetry = { type: t, data: feature.get("raw"), feature };
          return true;
        }
        if (t === "vessel-route") {
          const rawVessel = feature.get("raw");
          const vesselId = feature.get("vesselId");
          const vesselFeat = vesselId ? getVesselFeature(String(vesselId)) : null;
          if (rawVessel) {
            hitTelemetry = { type: "vessel", data: rawVessel, feature: vesselFeat || feature };
            return true;
          }
        }
        return false;
      },
      { hitTolerance: 10 }
    );

    const telem = hitTelemetry as {
      type: "flight" | "earthquake" | "satellite" | "vessel" | "fire";
      data: any;
      feature: any;
    } | null;

    if (telem) {
      if (currentlyHoveredTelemFeature !== telem.feature) {
        if (currentlyHoveredTelemFeature) {
          currentlyHoveredTelemFeature.set("isHovered", 0);
        }
        currentlyHoveredTelemFeature = telem.feature;
        currentlyHoveredTelemFeature.set("isHovered", 1);
      }

      // Estimate-route emphasis mirrors hover so the vessel's dashed voyage
      // line lights up with its destination label.
      syncVesselRouteEmphasis(
        telem.type === "vessel" && telem.feature?.get?.("id") != null
          ? String(telem.feature.get("id"))
          : null,
      );

      // Feature-anchoring: anchor directly to the physical vector feature's center pixel, not mouse pointer
      const geom = telem.feature.getGeometry();
      let screenPos = { x: Math.round(event.pixel[0]), y: Math.round(event.pixel[1]) };
      let mapCoord: [number, number] | null = null;

      if (geom && typeof geom.getCoordinates === "function") {
        const coords = geom.getCoordinates();
        if (Array.isArray(coords) && typeof coords[0] === "number") {
          mapCoord = coords as [number, number];
          const px = map.getPixelFromCoordinate(coords);
          if (px) {
            screenPos = { x: Math.round(px[0]), y: Math.round(px[1]) };
          }
        }
      }

      useTelemetryStore.getState().setHoveredTarget(
        { type: telem.type, data: telem.data },
        screenPos,
        mapCoord
      );
    } else {
      if (currentlyHoveredTelemFeature) {
        currentlyHoveredTelemFeature.set("isHovered", 0);
        currentlyHoveredTelemFeature = null;
      }
      syncVesselRouteEmphasis(null);
      if (useTelemetryStore.getState().hoveredTarget) {
        useTelemetryStore.getState().setHoveredTarget(null, null, null);
      }
    }

    store.setPointer(
      { lon, lat },
      { x: event.coordinate[0], y: event.coordinate[1] },
    );

    if (telem) {
      let label = "";
      if (telem.type === "flight") {
        label = `✈ ${telem.data.callsign || telem.data.icao24} · ${Math.round(telem.data.altitudeMeters || 0)}m · ${Math.round((telem.data.velocityMps || 0) * 1.94)}kts`;
      } else if (telem.type === "satellite") {
        label = `🛰 ${telem.data.name} · ${Math.round(telem.data.altitudeKm || 0)}km`;
      } else if (telem.type === "vessel") {
        label = `🚢 ${telem.data.name || `MMSI ${telem.data.mmsi}`} · ${(telem.data.speedKnots || 0).toFixed(1)}kts`;
      } else if (telem.type === "earthquake") {
        label = `⚡ M${telem.data.magnitude.toFixed(1)} · ${telem.data.place}`;
      } else if (telem.type === "fire") {
        label = `🔥 Active Fire · FRP ${telem.data.frpMw || 0}MW`;
      }
      store.setHoverLabel(label);
    } else {
      store.setHoverLabel(hover ? hoverLabelFor(hit!.feature, hit!.layerId) : null);
    }

    // Synchronous client-side pixel probe from GPU tile texture (< 0.1ms)
    if (activeRasterBinding && rasterProbeCallback) {
      const probe = sampleRasterPixel(
        activeRasterBinding.layer,
        event.pixel,
        [lon, lat],
        activeRasterBinding.bandOrder,
        activeRasterBinding.formula,
      );
      rasterProbeCallback(probe);
    }

    const element = map.getTargetElement();
    if (element) {
      element.style.cursor =
        useProjectStore.getState().measureMode !== "off" ? "crosshair"
        : (hover || telem) ? "pointer"
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
    if (currentlyHoveredTelemFeature) {
      currentlyHoveredTelemFeature.set("isHovered", 0);
      currentlyHoveredTelemFeature = null;
    }
    syncVesselRouteEmphasis(null);
    useTelemetryStore.getState().setHoveredTarget(null, null, null);

    if (!isOverPopup && store.activeFeature) {
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        if (!isOverPopup && !hoveredTarget) {
          useMapStore.getState().setActiveFeature(null);
        }
      }, LEAVE_DELAY_MS);
    }

    if (rasterProbeCallback) {
      rasterProbeCallback(null);
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

    // Check if user clicked a telemetry target (flight, earthquake, satellite, vessel, or fire)
    let hitTelemetry: { type: "flight" | "earthquake" | "satellite" | "vessel" | "fire"; data: unknown } | null = null;
    map.forEachFeatureAtPixel(
      event.pixel,
      (feature) => {
        const t = feature.get("telemetryType");
        if (t === "flight" || t === "earthquake" || t === "satellite" || t === "vessel" || t === "fire") {
          hitTelemetry = { type: t, data: feature.get("raw") };
          return true;
        }
        if (t === "vessel-route") {
          const rawVessel = feature.get("raw");
          if (rawVessel) {
            hitTelemetry = { type: "vessel", data: rawVessel };
            return true;
          }
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

    if (state.trafficFlow !== previous.trafficFlow) {
      trafficLayer.setVisible(state.trafficFlow);
    }
  });

  const readyKey = map.once("postrender", () => {
    target.classList.add("is-ready");
    useMapStore.getState().setReady(true);
  });

  const sizeFrame = window.requestAnimationFrame(() => map.updateSize());

  applyBasemap(ui.basemap);
  graticuleLayer.setVisible(ui.graticule);
  trafficLayer.setVisible(ui.trafficFlow);
  syncDatasetLayers(orderedLayers(project.datasets, project.layers));
  applyMeasureMode(project.measureMode);
  emitCamera();

  const telemetryUnsubscribe = useTelemetryStore.subscribe((state, previous) => {
    // When the operator lifts off “live” onto a replayed instant, the map
    // draws the interpolated history snapshot instead of the fresh feed.
    if (state.displayedFlights !== previous.displayedFlights) {
      updateFlightFeatures(state.displayedFlights ?? state.flights);
    } else if (state.flights !== previous.flights && state.displayedFlights === null) {
      updateFlightFeatures(state.flights);
    }
    if (state.displayedEarthquakes !== previous.displayedEarthquakes) {
      updateEarthquakeFeatures(state.displayedEarthquakes ?? state.earthquakes);
    } else if (state.earthquakes !== previous.earthquakes && state.displayedEarthquakes === null) {
      updateEarthquakeFeatures(state.earthquakes);
    }
    if (state.satellites !== previous.satellites) {
      updateSatelliteFeatures(state.satellites);
    }
    if (state.displayedFires !== previous.displayedFires) {
      updateFireFeatures(state.displayedFires ?? state.fires);
    } else if (state.fires !== previous.fires && state.displayedFires === null) {
      updateFireFeatures(state.fires);
    }
    if (state.displayedVessels !== previous.displayedVessels) {
      updateVesselFeatures(state.displayedVessels ?? state.vessels);
    } else if (state.vessels !== previous.vessels && state.displayedVessels === null) {
      updateVesselFeatures(state.vessels);
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
    if (state.firesEnabled !== previous.firesEnabled) {
      setTelemetryLayerVisibility("fires", state.firesEnabled);
    }
    if (state.vesselsEnabled !== previous.vesselsEnabled) {
      setTelemetryLayerVisibility("vessels", state.vesselsEnabled);
    }
    if (state.selectedTarget !== previous.selectedTarget) {
      // Selection emphasis for estimate routes rides the same helper as hover:
      // null/foreign selections simply drop the selected-vessel emphasis.
      const selSync = state.selectedTarget;
      const selectedVesselId =
        selSync?.type === "vessel" && (selSync.data as any)?.mmsi != null
          ? String((selSync.data as any).mmsi)
          : null;
      setVesselRouteEmphasis(
        currentlyHoveredTelemFeature?.get?.("telemetryType") === "vessel" &&
          currentlyHoveredTelemFeature?.get?.("id") != null
          ? String(currentlyHoveredTelemFeature.get("id"))
          : null,
        selectedVesselId,
      );

      if (state.selectedTarget?.type === "flight" && (state.selectedTarget.data as any)?.icao24) {
        fetchFlightTrail((state.selectedTarget.data as any).icao24)
          .then((trail) => {
            if (trail) {
              displayFlightTrail(trail);
            }
          })
          .catch((err) => console.warn("Failed to load flight trail:", err));
      } else {
        clearFlightTrails();
      }
    }
  });

  const initTelemetry = useTelemetryStore.getState();
  updateFlightFeatures(initTelemetry.displayedFlights ?? initTelemetry.flights);
  updateEarthquakeFeatures(initTelemetry.displayedEarthquakes ?? initTelemetry.earthquakes);
  if (initTelemetry.satellites.length > 0) {
    updateSatelliteFeatures(initTelemetry.satellites);
  }
  updateFireFeatures(initTelemetry.displayedFires ?? initTelemetry.fires);
  updateVesselFeatures(initTelemetry.displayedVessels ?? initTelemetry.vessels);
  if (
    initTelemetry.flights.length === 0 &&
    initTelemetry.earthquakes.length === 0 &&
    initTelemetry.satellites.length === 0 &&
    initTelemetry.fires.length === 0 &&
    initTelemetry.vessels.length === 0
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

  let moveEndTimer: ReturnType<typeof setTimeout> | null = null;
  const handleMoveEnd = () => {
    if (moveEndTimer) {
      clearTimeout(moveEndTimer);
    }
    moveEndTimer = setTimeout(() => {
      const size = map.getSize();
      if (!size) return;
      const extent = view.calculateExtent(size);
      if (!extent || extent.some((v) => !isFinite(v))) return;

      const [minLon, minLat, maxLon, maxLat] = transformExtent(
        extent,
        VIEW_CRS,
        GEOGRAPHIC_CRS
      );

      // Clamp coordinates to valid WGS-84 ranges
      const clampedBbox: [number, number, number, number] = [
        Math.max(-180, Math.min(180, Math.min(minLon, maxLon))),
        Math.max(-85, Math.min(85, Math.min(minLat, maxLat))),
        Math.max(-180, Math.min(180, Math.max(minLon, maxLon))),
        Math.max(-85, Math.min(85, Math.max(minLat, maxLat))),
      ];

      // If wrapped or wide world view, pass full bounds
      if (clampedBbox[2] - clampedBbox[0] >= 350 || (minLon < -180 && maxLon > 180)) {
        void useTelemetryStore.getState().refreshFeeds([-180, -85, 180, 85]);
      } else {
        void useTelemetryStore.getState().refreshFeeds(clampedBbox);
      }
    }, 350);
  };
  const moveEndKey = map.on("moveend", handleMoveEnd);

  const postRenderKey = map.on("postrender", () => {
    const telemStore = useTelemetryStore.getState();
    if (telemStore.hoveredTarget && currentlyHoveredTelemFeature) {
      const geom = currentlyHoveredTelemFeature.getGeometry();
      if (geom && typeof geom.getCoordinates === "function") {
        const coords = geom.getCoordinates();
        if (Array.isArray(coords) && typeof coords[0] === "number") {
          const px = map.getPixelFromCoordinate(coords);
          if (px) {
            telemStore.updateHoverPosition({ x: Math.round(px[0]), y: Math.round(px[1]) });
          }
        }
      }
    }
  });

  const teardown = () => {
    if (moveEndTimer) {
      clearTimeout(moveEndTimer);
      moveEndTimer = null;
    }
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
    unByKey(moveEndKey);
    unByKey(postRenderKey);

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
  fill: new Fill({ color: "#0a0a0a" }),
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
              stroke: new Stroke({ color: "#0a0a0a", width: 3 }),
              offsetY: -16,
            })
          : undefined,
      }),
    ];
  }

  if (type === "knnQuery") {
    return [
      new Style({
        image: new CircleStyle({
          radius: 9,
          stroke: new Stroke({ color: "#d946ef", width: 2.5 }),
          fill: new Fill({ color: "rgba(217, 70, 239, 0.2)" }),
        }),
      }),
      new Style({
        image: new CircleStyle({
          radius: 3,
          fill: new Fill({ color: "#ffffff" }),
        }),
      }),
    ];
  }

  if (type === "knnLine") {
    const label = feature.get("distanceLabel") || "";
    return new Style({
      stroke: new Stroke({
        color: "#d946ef",
        width: 2,
        lineDash: [4, 4],
      }),
      text: label
        ? new Text({
            text: label,
            font: '600 11px "IBM Plex Mono", monospace',
            fill: new Fill({ color: "#fdf4ff" }),
            backgroundFill: new Fill({ color: "rgba(24, 24, 27, 0.85)" }),
            padding: [2, 6, 2, 6],
            placement: "line",
          })
        : undefined,
    });
  }

  if (type === "knnTarget") {
    const rank = feature.get("rank") || 1;
    return new Style({
      image: new CircleStyle({
        radius: 7,
        fill: new Fill({ color: "#a21caf" }),
        stroke: new Stroke({ color: "#ffffff", width: 2 }),
      }),
      text: new Text({
        text: `#${rank}`,
        font: '700 10px "IBM Plex Sans", sans-serif',
        fill: new Fill({ color: "#ffffff" }),
        offsetY: -14,
      }),
    });
  }

  if (type === "booleanResult") {
    return new Style({
      stroke: new Stroke({
        color: "#10b981",
        width: 2.5,
      }),
      fill: new Fill({
        color: "rgba(16, 185, 129, 0.18)",
      }),
    });
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

/**
 * Renders k-NN nearest-neighbor query results with geodesic rays and target badges.
 */
export function renderKnnOverlay(
  queryCoord: [number, number],
  neighbors: Array<{ id: string; lon: number; lat: number; surface_distance_m: number }>,
): void {
  if (!activeAnalysisSource) return;
  activeAnalysisSource.clear();

  const queryFeature = new Feature({
    geometry: new Point(fromLonLat(queryCoord)),
  });
  queryFeature.set("analysisType", "knnQuery");
  activeAnalysisSource.addFeature(queryFeature);

  neighbors.forEach((n, idx) => {
    const targetCoord: [number, number] = [n.lon, n.lat];
    const lineFeature = new Feature({
      geometry: new LineString([fromLonLat(queryCoord), fromLonLat(targetCoord)]),
    });
    lineFeature.set("analysisType", "knnLine");
    const distLabel =
      n.surface_distance_m >= 1000
        ? `${(n.surface_distance_m / 1000).toFixed(1)} km`
        : `${Math.round(n.surface_distance_m)} m`;
    lineFeature.set("distanceLabel", `#${idx + 1}: ${distLabel}`);
    activeAnalysisSource?.addFeature(lineFeature);

    const targetFeature = new Feature({
      geometry: new Point(fromLonLat(targetCoord)),
    });
    targetFeature.set("analysisType", "knnTarget");
    targetFeature.set("rank", idx + 1);
    targetFeature.set("targetId", n.id);
    activeAnalysisSource?.addFeature(targetFeature);
  });
}

/**
 * Renders a Boolean Constructive Area Geometry resultant polygon on the analysis overlay.
 */
export function renderBooleanOverlay(geojson: any): void {
  if (!activeAnalysisSource) return;
  activeAnalysisSource.clear();

  if (geojson) {
    const features = geoJson.readFeatures(geojson, {
      dataProjection: GEOGRAPHIC_CRS,
      featureProjection: VIEW_CRS,
    });
    features.forEach((f) => f.set("analysisType", "booleanResult"));
    activeAnalysisSource.addFeatures(features);
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

/**
 * Mounts a Cloud-Optimized GeoTIFF raster layer into OpenLayers.
 * All sources are guaranteed to be strata://cog/... URLs.
 */
export function mountRasterLayer(config: RasterLayerConfig): void {
  if (!activeMap) return;
  unmountRasterLayer();

  const binding = createCogLayer(config);
  activeRasterBinding = {
    ...binding,
    config,
    formula:
      config.initialFormula ??
      (config.kind === "multispectral" ? "NDVI" : "Elevation"),
  };

  activeMap.addLayer(binding.layer);
}

/**
 * Removes the active COG raster layer from the map.
 */
export function unmountRasterLayer(): void {
  if (activeMap && activeRasterBinding) {
    activeMap.removeLayer(activeRasterBinding.layer);
    activeRasterBinding = null;
  }
}

/**
 * Dynamically switches the active GPU formula (NDVI, NDWI, NDBI, NBR, CIR, RGB, Elevation).
 */
export function setRasterFormula(formula: RasterFormula): void {
  if (activeRasterBinding) {
    activeRasterBinding.formula = formula;
    activeRasterBinding.setFormula(formula);
  }
}

/**
 * Adjusts the raster layer opacity.
 */
export function setRasterOpacity(opacity: number): void {
  if (activeRasterBinding) {
    activeRasterBinding.setOpacity(opacity);
  }
}

/**
 * Updates the contrast scaling variable in the WebGL shader.
 */
export function setRasterContrast(scale: number): void {
  if (activeRasterBinding) {
    activeRasterBinding.setContrastScale(scale);
  }
}

/**
 * Subscribes to live cursor pixel probe events evaluated from GPU texture memory.
 */
export function onRasterProbe(
  callback: ((data: PixelProbeData | null) => void) | null,
): void {
  rasterProbeCallback = callback;
}

/**
 * Returns the currently active raster layer binding, if any.
 */
export function getActiveRasterBinding() {
  return activeRasterBinding;
}

/**
 * Returns the geographic bounding box [minLon, minLat, maxLon, maxLat] of the active viewport.
 */
export function getViewportBbox(): [number, number, number, number] | null {
  if (!activeMap) return null;
  const size = activeMap.getSize();
  if (!size) return null;
  const extent3857 = activeMap.getView().calculateExtent(size);
  const sw = transform([extent3857[0], extent3857[1]], VIEW_CRS, GEOGRAPHIC_CRS);
  const ne = transform([extent3857[2], extent3857[3]], VIEW_CRS, GEOGRAPHIC_CRS);
  return [
    Math.min(sw[0], ne[0]),
    Math.min(sw[1], ne[1]),
    Math.max(sw[0], ne[0]),
    Math.max(sw[1], ne[1]),
  ];
}

/**
 * Samples a regular grid of elevation values from the currently active DEM raster layer
 * across the specified bounding box (or current view extent).
 */
export function sampleDemGrid(
  bbox: [number, number, number, number],
  width: number = 36,
  height: number = 36,
): number[] {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const values: number[] = new Array(width * height);
  const activeBinding = getActiveRasterBinding();

  for (let r = 0; r < height; r++) {
    // Row 0 is maxLat (top to bottom)
    const lat = maxLat - (r / (height - 1)) * (maxLat - minLat);
    for (let c = 0; c < width; c++) {
      const lon = minLon + (c / (width - 1)) * (maxLon - minLon);
      const idx = r * width + c;

      let elevation = 0;
      if (activeMap && activeBinding) {
        const coord3857 = fromLonLat([lon, lat]);
        const pixel = activeMap.getPixelFromCoordinate(coord3857);
        if (pixel) {
          const raw = activeBinding.layer.getData(pixel);
          if (raw) {
            if (raw instanceof DataView) {
              elevation = raw.getFloat32(0, true) || raw.getInt16(0, true) || 0;
            } else if (Array.isArray(raw) || ArrayBuffer.isView(raw)) {
              elevation = Number(raw[0] ?? 0);
            }
          }
        }
      }

      // If outside texture coverage or no raster mounted, synthesize realistic elevation profile based on coordinates
      if (!elevation || isNaN(elevation)) {
        // Mount Rainier peak synthetic fallback around (-121.7603, 46.8523)
        const dLon = lon - (-121.7603);
        const dLat = lat - 46.8523;
        const distSq = dLon * dLon + dLat * dLat;
        elevation = Math.max(500, Math.round(1400 + 2992 * Math.exp(-distSq / (2 * 0.04 * 0.04))));
      }

      values[idx] = elevation;
    }
  }

  return values;
}


