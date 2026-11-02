// ./src/map/cesiumView.ts
import {
  Billboard,
  BillboardCollection,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  Color,
  ConstantPositionProperty,
  ConstantProperty,
  createGooglePhotorealistic3DTileset,
  createWorldTerrainAsync,
  CustomDataSource,
  defined,
  EllipsoidTerrainProvider,
  Entity,
  GoogleMaps,
  HeadingPitchRange,
  HeightReference,
  Ion,
  JulianDate,
  LabelStyle,
  Material,
  Math as CesiumMath,
  Matrix4,
  NearFarScalar,
  PolygonHierarchy,
  Polyline,
  PolylineCollection,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  SceneTransforms,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { BASEMAPS } from "../lib/gis/data";
import { GEOGRAPHIC_CRS, transformGeometry } from "../lib/gis/crs";
import { orderedLayers } from "../lib/gis/datasets";
import { visibleFeatures } from "../lib/gis/filter";
import { buildViewshedPolygon, offsetCoordinate } from "../lib/gis/cctv";
import { computeVoyageRoute, interpolateGreatCircleArc } from "../lib/gis/voyageRoute";
import type {
  Bookmark,
  CameraState,
  EarthquakeTarget,
  FireTarget,
  FlightTarget,
  Position,
  RasterBasemap,
  SatelliteTarget,
  VesselTarget,
} from "../lib/gis/types";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";
import { useTelemetryStore } from "../state/telemetryStore";
import { useUiStore } from "../state/uiStore";
import {
  getAircraftAltitudeColor,
  getFlightSvg,
  getSatelliteSvg,
  getVesselSvg,
  getFireSvg,
  getEarthquakeSvg,
} from "./telemetryIcons";
import type { AdditionalBufferRing, KnnOverlayNeighbor } from "./mapController";

const EARTH_CIRCUMFERENCE_M = 40075016.686;
const DEFAULT_TILE_SIZE = 256;
const DEFAULT_FOVY = Math.PI / 3;
const MAX_ZOOM = 20;
const DEFAULT_3D_PITCH_RAD = CesiumMath.toRadians(-50); // Google Maps-style oblique tilt

let activeViewer: Viewer | null = null;
let google3DTileset: Cesium3DTileset | null = null;
let activeAnalysisDataSource: CustomDataSource | null = null;
let activeKnnDataSource: CustomDataSource | null = null;
let activeProfileHoverEntity: Entity | null = null;

// Zero-allocation SVG Data URI cache for high-frequency primitive billboards
const svgUriCache = new Map<string, string>();
function getCachedSvgUri(key: string, producer: () => string): string {
  let uri = svgUriCache.get(key);
  if (!uri) {
    uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(producer())}`;
    svgUriCache.set(key, uri);
  }
  return uri;
}

function rawHeightForZoom(zoom: number, lat: number, viewportHeight: number): number {
  const metersPerPixel =
    (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) /
    (DEFAULT_TILE_SIZE * 2 ** zoom);
  return (
    (metersPerPixel * Math.max(viewportHeight, 1)) /
    (2 * Math.tan(DEFAULT_FOVY / 2))
  );
}

function heightForResolution(metersPerPixel: number, viewportHeight: number): number {
  return (
    (metersPerPixel * Math.max(viewportHeight, 1)) /
    (2 * Math.tan(DEFAULT_FOVY / 2))
  );
}

function clampCameraHeight(height: number, lat: number, viewportHeight: number): number {
  const min = rawHeightForZoom(MAX_ZOOM, lat, viewportHeight);
  return Math.max(Math.min(height, 50_000_000), min);
}

function heightForZoom(zoom: number, lat: number, viewportHeight: number): number {
  return clampCameraHeight(rawHeightForZoom(zoom, lat, viewportHeight), lat, viewportHeight);
}

function zoomForHeight(height: number, lat: number, viewportHeight: number): number {
  const metersPerPixel =
    (2 * Math.max(height, 1) * Math.tan(DEFAULT_FOVY / 2)) /
    Math.max(viewportHeight, 1);
  const zoom = Math.log2(
    (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) /
    (DEFAULT_TILE_SIZE * metersPerPixel),
  );
  return Math.max(0, Math.min(MAX_ZOOM, zoom));
}

function activeReadyViewer(): Viewer | null {
  if (!activeViewer || activeViewer.isDestroyed()) {
    return null;
  }
  return activeViewer;
}

function createImageryProvider(basemap: RasterBasemap): UrlTemplateImageryProvider {
  return new UrlTemplateImageryProvider({
    url: basemap.urls[0],
    maximumLevel: basemap.maxZoom,
    credit: basemap.attribution.map((item) => item.label).join(" · "),
  });
}

/**
 * Projects a WGS84 [lon, lat, alt] coordinate into screen pixel coordinates
 * so FeaturePopup, CameraHoverWidget and TelemetryHoverPopup anchor accurately in 3D.
 */
export function cesiumScreenPositionFor(
  lon: number,
  lat: number,
  altitudeMeters = 0,
): { x: number; y: number } | null {
  const viewer = activeReadyViewer();
  if (!viewer) return null;
  const worldPos = Cartesian3.fromDegrees(lon, lat, altitudeMeters);
  const canvasPos = SceneTransforms.worldToWindowCoordinates(viewer.scene, worldPos);
  if (!defined(canvasPos)) return null;
  return { x: Math.round(canvasPos.x), y: Math.round(canvasPos.y) };
}

/**
 * Resolves the ground point at the center of the Cesium viewport (and camera distance to it)
 * so tilting the camera in 3D does not shift the geographic center in mapStore.
 */
function getGroundTargetAndRange(viewer: Viewer): {
  lon: number;
  lat: number;
  range: number;
} {
  const canvas = viewer.scene.canvas;
  const centerPx = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const ray = viewer.camera.getPickRay(centerPx);
  if (ray) {
    const hit = viewer.scene.globe.pick(ray, viewer.scene);
    if (defined(hit)) {
      const carto = Cartographic.fromCartesian(hit);
      if (carto) {
        return {
          lon: CesiumMath.toDegrees(carto.longitude),
          lat: CesiumMath.toDegrees(carto.latitude),
          range: Cartesian3.distance(viewer.camera.positionWC, hit),
        };
      }
    }
  }
  const carto = viewer.camera.positionCartographic;
  return {
    lon: CesiumMath.toDegrees(carto.longitude),
    lat: CesiumMath.toDegrees(carto.latitude),
    range: carto.height,
  };
}

export function cesiumFlyTo(lon: number, lat: number, zoom = 8): void {
  const viewer = activeReadyViewer();
  if (!viewer) return;
  const range = heightForZoom(zoom, lat, viewer.scene.canvas.clientHeight);
  const target = Cartesian3.fromDegrees(lon, lat, 0);
  const pitch = zoom >= 13 ? DEFAULT_3D_PITCH_RAD : -Math.PI / 2;
  viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
    offset: new HeadingPitchRange(viewer.camera.heading, pitch, range),
    duration: 0.65,
  });
}

export function cesiumZoomBy(delta: number): void {
  const viewer = activeReadyViewer();
  if (!viewer) return;
  const { lon, lat, range } = getGroundTargetAndRange(viewer);
  const nextRange = clampCameraHeight(
    range / 2 ** delta,
    lat,
    viewer.scene.canvas.clientHeight,
  );
  const target = Cartesian3.fromDegrees(lon, lat, 0);
  viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
    offset: new HeadingPitchRange(viewer.camera.heading, viewer.camera.pitch, nextRange),
    duration: 0.24,
  });
}

export function cesiumResetNorth(): void {
  const viewer = activeReadyViewer();
  if (!viewer) return;
  const { lon, lat, range } = getGroundTargetAndRange(viewer);
  const target = Cartesian3.fromDegrees(lon, lat, 0);
  viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
    offset: new HeadingPitchRange(0, viewer.camera.pitch, range),
    duration: 0.32,
  });
}

export function cesiumApplyCamera(camera: CameraState): void {
  const viewer = activeReadyViewer();
  if (!viewer) return;
  const range = heightForZoom(camera.zoom, camera.lat, viewer.scene.canvas.clientHeight);
  const target = Cartesian3.fromDegrees(camera.lon, camera.lat, 0);
  const pitch = camera.zoom >= 13 ? DEFAULT_3D_PITCH_RAD : -Math.PI / 2;
  // OpenLayers rotation is counter-clockwise; Cesium heading is clockwise from North
  viewer.camera.lookAt(
    target,
    new HeadingPitchRange(-camera.rotation, pitch, range),
  );
  viewer.camera.lookAtTransform(Matrix4.IDENTITY);
}

export function cesiumFlyToBookmark(
  bookmark: { lon: number; lat: number; zoom: number; rotation?: number; pitch?: number },
  duration = 0.75,
): void {
  const viewer = activeReadyViewer();
  if (!viewer) return;
  const range = heightForZoom(bookmark.zoom, bookmark.lat, viewer.scene.canvas.clientHeight);
  const target = Cartesian3.fromDegrees(bookmark.lon, bookmark.lat, 0);
  const pitch =
    bookmark.pitch != null
      ? bookmark.pitch
      : bookmark.zoom >= 13
        ? DEFAULT_3D_PITCH_RAD
        : -Math.PI / 2;
  viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
    offset: new HeadingPitchRange(-(bookmark.rotation ?? 0), pitch, range),
    duration,
  });
}

export function cesiumFitExtent(
  extent: [number, number, number, number],
  maxZoom?: number,
): void {
  const viewer = activeReadyViewer();
  if (!viewer) return;
  const [west, south, east, north] = extent;
  const canvas = viewer.scene.canvas;
  const viewportWidth = canvas.clientWidth || 780;
  const viewportHeight = canvas.clientHeight || 437;
  const availWidth = Math.max(60, viewportWidth - 340);
  const availHeight = Math.max(60, viewportHeight - 200);
  const lat = (south + north) / 2;
  const metersPerDegree = EARTH_CIRCUMFERENCE_M / 360;
  const widthM = Math.max(
    1,
    (east - west) * metersPerDegree * Math.cos((lat * Math.PI) / 180),
  );
  const heightM = Math.max(1, (north - south) * metersPerDegree);
  const metersPerPixel = Math.max(widthM / availWidth, heightM / availHeight);
  let cameraHeight = heightForResolution(metersPerPixel, viewportHeight);
  if (maxZoom != null) {
    cameraHeight = Math.max(cameraHeight, rawHeightForZoom(maxZoom, lat, viewportHeight));
  }
  const lon = (west + east) / 2;
  const clampedRange = clampCameraHeight(cameraHeight, lat, viewportHeight);
  const target = Cartesian3.fromDegrees(lon, lat, 0);
  viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
    offset: new HeadingPitchRange(viewer.camera.heading, -Math.PI / 2, clampedRange),
    duration: 0.7,
  });
}

export function captureCesiumAsPng(rect?: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string | null {
  const viewer = activeReadyViewer();
  if (!viewer) return null;
  const canvas = viewer.scene.canvas;
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  try {
    viewer.render();
  } catch {
    // Keep previous frame readable
  }
  try {
    if (!rect) {
      return canvas.toDataURL("image/png");
    }
    const dpr = window.devicePixelRatio || 1;
    const canvasRect = canvas.getBoundingClientRect();
    const sourceX = Math.max(0, (rect.x - canvasRect.left) * dpr);
    const sourceY = Math.max(0, (rect.y - canvasRect.top) * dpr);
    const sourceW = Math.max(1, rect.width * dpr);
    const sourceH = Math.max(1, rect.height * dpr);
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = sourceW;
    cropCanvas.height = sourceH;
    const ctx = cropCanvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(canvas, sourceX, sourceY, sourceW, sourceH, 0, 0, sourceW, sourceH);
    return cropCanvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3D Analysis Overlay Helpers (Buffer, CSG Boolean, k-NN, Elevation Profile Hover)
// ─────────────────────────────────────────────────────────────────────────────

export function cesiumRenderBufferOverlay(
  bufferGeoJson: any,
  centerCoord?: [number, number],
  radiusMeters?: number,
  additionalRings?: AdditionalBufferRing[],
  spineCoords?: [number, number][],
): void {
  if (!activeAnalysisDataSource) return;
  activeAnalysisDataSource.entities.removeAll();

  // Multi-ring rendering: render outer rings first so inner rings sit on top
  if (additionalRings && additionalRings.length > 0) {
    const sorted = [...additionalRings].sort((a, b) => b.radiusMeters - a.radiusMeters);
    for (const ring of sorted) {
      if (!ring.geojson) continue;
      const coords = ring.geojson?.geometry?.coordinates?.[0];
      if (coords && coords.length >= 3) {
        const flat = coords.flatMap(([lon, lat]: [number, number]) => [lon, lat]);
        activeAnalysisDataSource.entities.add({
          id: `buffer-ring-${ring.ringIndex}`,
          polygon: {
            hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(flat)),
            material: Color.fromCssColorString("#06b6d4").withAlpha(0.18),
            outline: true,
            outlineColor: Color.fromCssColorString("#06b6d4"),
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
        });
        const apex = coords[0];
        const labelText =
          ring.label ||
          (ring.radiusMeters >= 1000
            ? `R${ring.ringIndex} = ${(ring.radiusMeters / 1000).toFixed(1)} km`
            : `R${ring.ringIndex} = ${Math.round(ring.radiusMeters)} m`);
        activeAnalysisDataSource.entities.add({
          id: `buffer-label-${ring.ringIndex}`,
          position: Cartesian3.fromDegrees(apex[0], apex[1], 5),
          label: {
            text: labelText,
            font: "bold 11px monospace",
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
    }
  } else if (bufferGeoJson) {
    const coords = bufferGeoJson?.geometry?.coordinates?.[0];
    if (coords && coords.length >= 3) {
      const flat = coords.flatMap(([lon, lat]: [number, number]) => [lon, lat]);
      activeAnalysisDataSource.entities.add({
        id: "buffer-single",
        polygon: {
          hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(flat)),
          material: Color.fromCssColorString("#06b6d4").withAlpha(0.2),
          outline: true,
          outlineColor: Color.fromCssColorString("#06b6d4"),
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
      });

      if (radiusMeters && radiusMeters > 0) {
        const apex = coords[0];
        const labelText =
          radiusMeters >= 1000
            ? `R = ${(radiusMeters / 1000).toFixed(1)} km`
            : `R = ${Math.round(radiusMeters)} m`;
        activeAnalysisDataSource.entities.add({
          id: "buffer-label",
          position: Cartesian3.fromDegrees(apex[0], apex[1], 5),
          label: {
            text: labelText,
            font: "bold 11px monospace",
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
    }
  }

  if (spineCoords && spineCoords.length >= 2) {
    const flat = spineCoords.flatMap(([lon, lat]) => [lon, lat]);
    activeAnalysisDataSource.entities.add({
      id: "corridor-spine",
      polyline: {
        positions: Cartesian3.fromDegreesArray(flat),
        width: 3,
        material: Color.fromCssColorString("#00e5ff"),
        clampToGround: true,
      },
    });
  }

  if (centerCoord) {
    activeAnalysisDataSource.entities.add({
      id: "buffer-center",
      position: Cartesian3.fromDegrees(centerCoord[0], centerCoord[1], 0),
      point: {
        pixelSize: 8,
        color: Color.fromCssColorString("#00e5ff"),
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
    });
  }

  activeViewer?.scene.requestRender();
}

export function cesiumClearBufferOverlay(): void {
  if (!activeAnalysisDataSource) return;
  activeAnalysisDataSource.entities.removeAll();
  activeViewer?.scene.requestRender();
}

export function cesiumRenderBooleanOverlay(geojson: any): void {
  if (!activeAnalysisDataSource) return;
  activeAnalysisDataSource.entities.removeAll();
  if (!geojson) return;

  const geom = geojson.geometry || geojson;
  const renderPolygonRing = (ring: [number, number][], id: string) => {
    if (ring.length < 3) return;
    const flat = ring.flatMap(([lon, lat]) => [lon, lat]);
    activeAnalysisDataSource?.entities.add({
      id,
      polygon: {
        hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(flat)),
        material: Color.fromCssColorString("#10b981").withAlpha(0.24),
        outline: true,
        outlineColor: Color.fromCssColorString("#10b981"),
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
    });
  };

  if (geom.type === "Polygon" && geom.coordinates?.[0]) {
    renderPolygonRing(geom.coordinates[0], "boolean-poly");
  } else if (geom.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
    geom.coordinates.forEach((poly: [number, number][][], idx: number) => {
      if (poly[0]) renderPolygonRing(poly[0], `boolean-poly-${idx}`);
    });
  } else if (geom.type === "FeatureCollection" && Array.isArray(geom.features)) {
    geom.features.forEach((feat: any, idx: number) => {
      const g = feat.geometry;
      if (g?.type === "Polygon" && g.coordinates?.[0]) {
        renderPolygonRing(g.coordinates[0], `boolean-poly-${idx}`);
      }
    });
  }

  activeViewer?.scene.requestRender();
}

export function cesiumRenderKnnOverlay(
  queryCoord: [number, number],
  neighbors: KnnOverlayNeighbor[],
  options?: { distanceUnit?: "km" | "m" | "NM" | "mi" },
): void {
  if (!activeKnnDataSource) return;
  activeKnnDataSource.entities.removeAll();

  // Query origin marker
  activeKnnDataSource.entities.add({
    id: "knn-query-origin",
    position: Cartesian3.fromDegrees(queryCoord[0], queryCoord[1], 0),
    point: {
      pixelSize: 10,
      color: Color.fromCssColorString("#06b6d4"),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      heightReference: HeightReference.CLAMP_TO_GROUND,
    },
  });

  const unit = options?.distanceUnit ?? "km";
  const formatDist = (meters: number) => {
    if (unit === "NM") {
      const nm = meters / 1852;
      return `${nm >= 10 ? nm.toFixed(1) : nm.toFixed(2)} NM`;
    }
    if (unit === "mi") {
      const mi = meters / 1609.344;
      return `${mi >= 10 ? mi.toFixed(1) : mi.toFixed(2)} mi`;
    }
    if (unit === "m" || meters < 1000) {
      return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
  };

  neighbors.forEach((n, idx) => {
    const segments = interpolateGreatCircleArc(queryCoord[0], queryCoord[1], n.lon, n.lat, 2);
    segments.forEach((seg: number[][], segIdx: number) => {
      const flat = seg.flatMap(([lon, lat]) => [lon, lat]);
      activeKnnDataSource?.entities.add({
        id: `knn-ray-${idx}-${segIdx}`,
        polyline: {
          positions: Cartesian3.fromDegreesArray(flat),
          width: 2,
          material: Color.fromCssColorString("#d946ef"),
          clampToGround: true,
        },
      });
    });

    const distStr = formatDist(n.surface_distance_m);
    const bearingStr =
      n.bearing_deg !== undefined
        ? ` @ ${Math.round(n.bearing_deg).toString().padStart(3, "0")}° ${n.compass_direction ?? ""}`.trimEnd()
        : "";

    activeKnnDataSource?.entities.add({
      id: `knn-target-${idx}`,
      position: Cartesian3.fromDegrees(n.lon, n.lat, 0),
      point: {
        pixelSize: 9,
        color: Color.fromCssColorString("#d946ef"),
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: `#${idx + 1}: ${distStr}${bearingStr}`,
        font: "bold 11px monospace",
        fillColor: Color.fromCssColorString("#fdf4ff"),
        outlineColor: Color.BLACK,
        outlineWidth: 2.5,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -8),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  });

  activeViewer?.scene.requestRender();
}

export function cesiumClearKnnOverlay(): void {
  if (!activeKnnDataSource) return;
  activeKnnDataSource.entities.removeAll();
  activeViewer?.scene.requestRender();
}

export function cesiumSetProfileHoverCoord(
  coord: [number, number] | null,
  elevationM?: number,
  slopePct?: number,
): void {
  if (!activeProfileHoverEntity) return;

  if (!coord) {
    activeProfileHoverEntity.show = false;
    activeViewer?.scene.requestRender();
    return;
  }

  const alt = Math.max(0, elevationM || 0);
  activeProfileHoverEntity.show = true;
  activeProfileHoverEntity.position = new ConstantPositionProperty(
    Cartesian3.fromDegrees(coord[0], coord[1], alt),
  );

  const text = `${elevationM !== undefined ? Math.round(elevationM) + "m" : ""}${slopePct !== undefined ? " (" + slopePct.toFixed(1) + "%)" : ""}`.trim();
  if (activeProfileHoverEntity.label) {
    activeProfileHoverEntity.label.text = new ConstantProperty(text);
  }

  activeViewer?.scene.requestRender();
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Strata Object Pick Extractor (Handles Entities and Primitive Billboards)
// ─────────────────────────────────────────────────────────────────────────────

function getStrataTarget(picked: any, time: JulianDate): any {
  if (!defined(picked) || !picked.id) return null;
  if (picked.id instanceof Entity) {
    return picked.id.properties ? picked.id.properties.getValue(time) : null;
  }
  if (typeof picked.id === "object") {
    return picked.id;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Cesium 3D Mount Function
// ─────────────────────────────────────────────────────────────────────────────

export function mountCesium(target: HTMLElement, onReady?: () => void): () => void {
  const ionToken = import.meta.env.CESIUM_ION_TOKEN;
  if (ionToken) {
    Ion.defaultAccessToken = ionToken;
  }
  const googleApiKey = import.meta.env.GOOGLE_MAPS_API_KEY;
  if (googleApiKey) {
    GoogleMaps.defaultApiKey = googleApiKey;
  }

  const creditHost = document.createElement("div");
  creditHost.style.display = "none";

  const viewer = new Viewer(target, {
    baseLayer: false,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: true,
    contextOptions: {
      webgl: { preserveDrawingBuffer: true },
    },
    creditContainer: creditHost,
    requestRenderMode: true,
    maximumRenderTimeChange: 0.2,
  });

  const openstreetmap = BASEMAPS.find((item) => item.id === "openstreetmap");
  viewer.scene.backgroundColor = Color.fromCssColorString("#070b0f");
  viewer.scene.globe.baseColor = Color.fromCssColorString("#0b1117");
  viewer.scene.globe.depthTestAgainstTerrain = true;

  // Enable Cesium World Terrain if Ion Token is configured
  if (ionToken) {
    createWorldTerrainAsync({ requestWaterMask: true, requestVertexNormals: true })
      .then((terrain) => {
        if (!viewer.isDestroyed()) {
          viewer.terrainProvider = terrain;
          viewer.scene.requestRender();
        }
      })
      .catch(() => {
        if (!viewer.isDestroyed()) {
          viewer.terrainProvider = new EllipsoidTerrainProvider();
        }
      });
  }

  // Initial Camera Sync from mapStore (with automatic oblique tilt when zoomed in)
  const initialCam = useMapStore.getState().camera;
  const initialRange = heightForZoom(initialCam.zoom, initialCam.lat, target.clientHeight);
  const initialTarget = Cartesian3.fromDegrees(initialCam.lon, initialCam.lat, 0);
  const initialPitch = initialCam.zoom >= 12 ? DEFAULT_3D_PITCH_RAD : -Math.PI / 2;
  viewer.camera.lookAt(
    initialTarget,
    new HeadingPitchRange(-initialCam.rotation, initialPitch, initialRange),
  );
  viewer.camera.lookAtTransform(Matrix4.IDENTITY);

  // Sync Cesium camera back to mapStore (preserving true ground center & negating heading)
  const syncCameraToStore = () => {
    if (viewer.isDestroyed()) return;
    const { lon, lat, range } = getGroundTargetAndRange(viewer);
    const zoom = zoomForHeight(range, lat, viewer.scene.canvas.clientHeight);
    const resolution =
      (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) /
      (DEFAULT_TILE_SIZE * 2 ** zoom);
    useMapStore.getState().setCamera({
      lon,
      lat,
      zoom,
      rotation: -viewer.camera.heading, // Negate clockwise Cesium heading -> CCW OpenLayers rotation
      resolution,
    });
  };
  viewer.camera.percentageChanged = 0.01;
  viewer.camera.changed.addEventListener(syncCameraToStore);

  // Basemap + Google Photorealistic 3D Tiles Manager
  const applyBasemap3D = async (id: string): Promise<void> => {
    if (viewer.isDestroyed()) return;
    const isSatelliteMode =
      id === "hybrid-basemap" || id === "maxar-satellite" || id === "satellite-imagery";

    // Mount Google Maps Photorealistic 3D Tiles when satellite/hybrid + Google API Key are active
    if (isSatelliteMode && googleApiKey) {
      if (!google3DTileset) {
        try {
          google3DTileset = await createGooglePhotorealistic3DTileset({
            onlyUsingWithGoogleGeocoder: true,
          });
          if (!viewer.isDestroyed()) {
            viewer.scene.primitives.add(google3DTileset);
          }
        } catch (err) {
          console.warn("Google Photorealistic 3D Tiles fallback to standard globe:", err);
        }
      }
      if (google3DTileset) {
        google3DTileset.show = true;
        viewer.scene.globe.show = false;
        viewer.scene.requestRender();
        return;
      }
    } else if (google3DTileset) {
      google3DTileset.show = false;
      viewer.scene.globe.show = true;
    }

    const meta = BASEMAPS.find((item) => item.id === id);
    if (meta?.kind === "raster") {
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.addImageryProvider(createImageryProvider(meta));
      viewer.scene.requestRender();
      return;
    }
    const fallback = openstreetmap?.kind === "raster" ? openstreetmap : null;
    if (!fallback) return;
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(createImageryProvider(fallback));
    viewer.scene.requestRender();
  };

  void applyBasemap3D(useUiStore.getState().basemap);

  // ───────────────────────────────────────────────────────────────────────────
  // GPU Primitive Collections (60 FPS zero-allocation telemetry & bookmarks)
  // ───────────────────────────────────────────────────────────────────────────
  const telemetryBillboards = viewer.scene.primitives.add(
    new BillboardCollection({ scene: viewer.scene }),
  );
  const telemetryPolylines = viewer.scene.primitives.add(
    new PolylineCollection(),
  );
  const bookmarkBillboards = viewer.scene.primitives.add(
    new BillboardCollection({ scene: viewer.scene }),
  );

  // Low-level primitive pools mutating in-place across kinematic frames
  const flightBillboards = new Map<string, Billboard>();
  const flightStems = new Map<string, Polyline>();
  const satelliteBillboards = new Map<string, Billboard>();
  const satelliteOrbits = new Map<string, Polyline>();
  const vesselBillboards = new Map<string, Billboard>();
  const vesselRoutes = new Map<string, Polyline[]>();
  const earthquakeBillboards = new Map<string, Billboard>();
  const fireBillboards = new Map<string, Billboard>();
  const bookmarkBillboardMap = new Map<string, Billboard>();

  // Dedicated DataSources for Vector Layers, Viewport BBox Streaming, and Analysis
  const datasetDataSource = new CustomDataSource("strata-datasets");
  const viewportDataSource = new CustomDataSource("strata-viewport-stream");
  const analysisDataSource = new CustomDataSource("strata-analysis");
  const knnDataSource = new CustomDataSource("strata-knn");

  void viewer.dataSources.add(datasetDataSource);
  void viewer.dataSources.add(viewportDataSource);
  void viewer.dataSources.add(analysisDataSource);
  void viewer.dataSources.add(knnDataSource);

  activeAnalysisDataSource = analysisDataSource;
  activeKnnDataSource = knnDataSource;

  // Single synchronized 3D elevation profile hover scrubber pin
  activeProfileHoverEntity = viewer.entities.add({
    id: "strata::profile-hover",
    show: false,
    point: {
      pixelSize: 10,
      color: Color.fromCssColorString("#38bdf8"),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      font: "bold 11px monospace",
      fillColor: Color.WHITE,
      outlineColor: Color.BLACK,
      outlineWidth: 2,
      style: LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -12),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Sync Project Datasets & True 3D CCTV Camera Frustums
  // ───────────────────────────────────────────────────────────────────────────
  const syncDatasets3D = () => {
    if (viewer.isDestroyed()) return;
    datasetDataSource.entities.removeAll();
    const { datasets, layers, selection } = useProjectStore.getState();
    const ordered = orderedLayers(datasets, layers);

    for (const layer of ordered) {
      if (!layer.visible) continue;
      const features = visibleFeatures(layer);

      // Datasets exceeding 2,500 features or MVT tiles stream on-demand via strata://bbox/
      if (features.length > 2500 || layer.format === "mvt") {
        continue;
      }

      const color = Color.fromCssColorString(layer.style.color).withAlpha(layer.opacity);
      const fillColor = Color.fromCssColorString(layer.style.color).withAlpha(
        layer.style.fillOpacity * layer.opacity,
      );

      for (const feat of features) {
        const geo =
          layer.crs === GEOGRAPHIC_CRS
            ? feat.geometry
            : transformGeometry(feat.geometry, layer.crs, GEOGRAPHIC_CRS);
        const isSelected =
          selection?.layerId === layer.id && selection?.featureId === feat.id;
        const props = feat.properties;

        if (geo.type === "Point") {
          const [lon, lat] = geo.coordinates as Position;
          const isCctvCamera =
            /camera|cctv/i.test(layer.name) ||
            (typeof layer.source === "string" && /cctv/i.test(layer.source)) ||
            String(feat.id).startsWith("cctv-cam-") ||
            props.heading_deg !== undefined ||
            props.mount_height_m !== undefined ||
            props.snapshot_url !== undefined;

          if (isCctvCamera) {
            // True 3D CCTV Camera Sensor Volume (god's-eye-view)
            const mountHeight =
              typeof props.mount_height_m === "number"
                ? props.mount_height_m
                : (typeof props.total_elevation_m === "number"
                  ? props.total_elevation_m
                  : 15);
            const apexAlt = Math.max(mountHeight, 12);
            const apexPos = Cartesian3.fromDegrees(lon, lat, apexAlt);
            const groundPos = Cartesian3.fromDegrees(lon, lat, 0);

            // Camera Mast Pole
            datasetDataSource.entities.add({
              id: `${layer.id}::${feat.id}::mast`,
              polyline: {
                positions: [groundPos, apexPos],
                width: 2,
                material: Color.fromCssColorString(layer.style.color || "#06b6d4").withAlpha(0.85),
              },
              properties: {
                strataType: "dataset-feature",
                layerId: layer.id,
                featureId: feat.id,
                lon,
                lat,
                rawProps: props,
              },
            });

            // Camera Apex Node
            datasetDataSource.entities.add({
              id: `${layer.id}::${feat.id}`,
              position: apexPos,
              point: {
                pixelSize: (layer.style.pointRadius + (isSelected ? 3 : 0)) * 2,
                color: isSelected ? Color.WHITE : color,
                outlineColor: Color.BLACK,
                outlineWidth: 1.5,
              },
              properties: {
                strataType: "dataset-feature",
                layerId: layer.id,
                featureId: feat.id,
                lon,
                lat,
                rawProps: props,
              },
            });

            // 3D Viewshed Frustum Base Arc & Pyramid Rays
            if (props.heading_deg !== undefined && props.heading_deg !== null) {
              const heading = Number(props.heading_deg);
              const fov = typeof props.fov_deg === "number" ? props.fov_deg : 50;
              const range =
                typeof props.range_m === "number"
                  ? props.range_m
                  : (typeof props.range_meters === "number"
                    ? props.range_meters
                    : 150);

              const viewshedRings = buildViewshedPolygon(lon, lat, heading, fov, range, 16);
              const arcRing = viewshedRings[0];
              if (arcRing && arcRing.length >= 3) {
                const flatGround = arcRing.flatMap(([x, y]) => [x, y]);
                // Ground wedge fan draped over terrain
                datasetDataSource.entities.add({
                  id: `${layer.id}::${feat.id}::frustum-fan`,
                  polygon: {
                    hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(flatGround)),
                    material: Color.fromCssColorString(layer.style.color || "#06b6d4").withAlpha(0.2),
                    outline: true,
                    outlineColor: Color.fromCssColorString(layer.style.color || "#06b6d4").withAlpha(0.7),
                    heightReference: HeightReference.CLAMP_TO_GROUND,
                  },
                  properties: {
                    strataType: "dataset-feature",
                    layerId: layer.id,
                    featureId: feat.id,
                    lon,
                    lat,
                    rawProps: props,
                  },
                });

                // Frustum pyramid rays from apex to left, right, and center arc points
                const leftCorner = offsetCoordinate(lon, lat, heading - fov / 2, range);
                const rightCorner = offsetCoordinate(lon, lat, heading + fov / 2, range);
                const centerTarget = offsetCoordinate(lon, lat, heading, range);

                const frustumRays = [
                  [apexPos, Cartesian3.fromDegrees(leftCorner[0], leftCorner[1], 0)],
                  [apexPos, Cartesian3.fromDegrees(rightCorner[0], rightCorner[1], 0)],
                  [apexPos, Cartesian3.fromDegrees(centerTarget[0], centerTarget[1], 0)],
                ];

                for (let rIdx = 0; rIdx < frustumRays.length; rIdx++) {
                  datasetDataSource.entities.add({
                    id: `${layer.id}::${feat.id}::frustum-ray-${rIdx}`,
                    polyline: {
                      positions: frustumRays[rIdx],
                      width: 1.2,
                      material: Color.fromCssColorString(layer.style.color || "#06b6d4").withAlpha(0.55),
                    },
                    properties: {
                      strataType: "dataset-feature",
                      layerId: layer.id,
                      featureId: feat.id,
                      lon,
                      lat,
                      rawProps: props,
                    },
                  });
                }
              }
            }
          } else {
            // Standard Point Feature
            const mountHeight =
              typeof props.mount_height_m === "number" ? props.mount_height_m : 0;
            datasetDataSource.entities.add({
              id: `${layer.id}::${feat.id}`,
              position: Cartesian3.fromDegrees(lon, lat, mountHeight),
              point: {
                pixelSize: (layer.style.pointRadius + (isSelected ? 3 : 0)) * 2,
                color: isSelected ? Color.WHITE : color,
                outlineColor: Color.BLACK,
                outlineWidth: 1.5,
                heightReference:
                  mountHeight > 0
                    ? HeightReference.RELATIVE_TO_GROUND
                    : HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                strataType: "dataset-feature",
                layerId: layer.id,
                featureId: feat.id,
                lon,
                lat,
                rawProps: props,
              },
            });
          }
        } else if (geo.type === "LineString") {
          const coords = (geo.coordinates as Position[]).flatMap(([lon, lat]) => [lon, lat]);
          if (coords.length >= 4) {
            datasetDataSource.entities.add({
              id: `${layer.id}::${feat.id}`,
              polyline: {
                positions: Cartesian3.fromDegreesArray(coords),
                width: layer.style.strokeWidth + (isSelected ? 1.5 : 0),
                material: isSelected ? Color.WHITE : color,
                clampToGround: true,
              },
              properties: {
                strataType: "dataset-feature",
                layerId: layer.id,
                featureId: feat.id,
                lon: (geo.coordinates as Position[])[0][0],
                lat: (geo.coordinates as Position[])[0][1],
                rawProps: props,
              },
            });
          }
        } else if (geo.type === "Polygon") {
          const rings = geo.coordinates as Position[][];
          if (rings[0] && rings[0].length >= 3) {
            const flat = rings[0].flatMap(([lon, lat]) => [lon, lat]);
            const isCctvCone = String(feat.id).startsWith("cctv-cone-");
            datasetDataSource.entities.add({
              id: `${layer.id}::${feat.id}`,
              polygon: {
                hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(flat)),
                material: fillColor,
                outline: true,
                outlineColor: isSelected ? Color.WHITE : color,
                extrudedHeight: isCctvCone ? 12 : undefined,
                heightReference: HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                strataType: "dataset-feature",
                layerId: layer.id,
                featureId: feat.id,
                lon: rings[0][0][0],
                lat: rings[0][0][1],
                rawProps: props,
              },
            });
          }
        }
      }
    }
    viewer.scene.requestRender();
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Viewport-Bound Vector Streaming for Large Datasets (>2,500 Features / MVT)
  // ───────────────────────────────────────────────────────────────────────────
  const scratchRect = new Rectangle();
  let activeStreamAbortController: AbortController | null = null;

  const syncViewportStream3D = async () => {
    if (viewer.isDestroyed()) return;
    const { datasets, layers } = useProjectStore.getState();
    const ordered = orderedLayers(datasets, layers);
    const largeLayers = ordered.filter(
      (l) => l.visible && (l.format === "mvt" || (l.features && l.features.length > 2500)),
    );
    if (largeLayers.length === 0) {
      viewportDataSource.entities.removeAll();
      return;
    }

    const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid, scratchRect);
    if (!rect) return;

    const west = CesiumMath.toDegrees(rect.west);
    const south = CesiumMath.toDegrees(rect.south);
    const east = CesiumMath.toDegrees(rect.east);
    const north = CesiumMath.toDegrees(rect.north);

    activeStreamAbortController?.abort();
    const ac = new AbortController();
    activeStreamAbortController = ac;

    viewportDataSource.entities.removeAll();

    for (const layer of largeLayers) {
      try {
        const url = `strata://bbox/${layer.id}?bbox=${west.toFixed(4)},${south.toFixed(4)},${east.toFixed(4)},${north.toFixed(4)}&limit=2500`;
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) continue;
        const geojson = await res.json();
        if (ac.signal.aborted || viewer.isDestroyed()) return;

        const color = Color.fromCssColorString(layer.style.color).withAlpha(layer.opacity);
        const fillColor = Color.fromCssColorString(layer.style.color).withAlpha(
          layer.style.fillOpacity * layer.opacity,
        );

        for (const feat of geojson.features || []) {
          const geo = feat.geometry;
          if (!geo) continue;
          if (geo.type === "Point") {
            const [lon, lat] = geo.coordinates;
            viewportDataSource.entities.add({
              id: `viewport::${layer.id}::${feat.id}`,
              position: Cartesian3.fromDegrees(lon, lat, 0),
              point: {
                pixelSize: layer.style.pointRadius * 2,
                color,
                outlineColor: Color.BLACK,
                outlineWidth: 1,
                heightReference: HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                strataType: "dataset-feature",
                layerId: layer.id,
                featureId: feat.id,
                lon,
                lat,
                rawProps: feat.properties,
              },
            });
          } else if (geo.type === "LineString" && geo.coordinates?.length >= 2) {
            const flat = geo.coordinates.flatMap(([lon, lat]: [number, number]) => [lon, lat]);
            viewportDataSource.entities.add({
              id: `viewport::${layer.id}::${feat.id}`,
              polyline: {
                positions: Cartesian3.fromDegreesArray(flat),
                width: layer.style.strokeWidth,
                material: color,
                clampToGround: true,
              },
              properties: {
                strataType: "dataset-feature",
                layerId: layer.id,
                featureId: feat.id,
                lon: geo.coordinates[0][0],
                lat: geo.coordinates[0][1],
                rawProps: feat.properties,
              },
            });
          } else if (geo.type === "Polygon" && geo.coordinates?.[0]?.length >= 3) {
            const flat = geo.coordinates[0].flatMap(([lon, lat]: [number, number]) => [lon, lat]);
            viewportDataSource.entities.add({
              id: `viewport::${layer.id}::${feat.id}`,
              polygon: {
                hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(flat)),
                material: fillColor,
                outline: true,
                outlineColor: color,
                heightReference: HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                strataType: "dataset-feature",
                layerId: layer.id,
                featureId: feat.id,
                lon: geo.coordinates[0][0][0],
                lat: geo.coordinates[0][0][1],
                rawProps: feat.properties,
              },
            });
          }
        }
        viewer.scene.requestRender();
      } catch {
        // Aborted or non-Tauri mock environment
      }
    }
  };
  viewer.camera.moveEnd.addEventListener(syncViewportStream3D);

  // ───────────────────────────────────────────────────────────────────────────
  // 60 FPS Low-Level Primitive Telemetry Sync (Mutating In-Place, Zero GC)
  // ───────────────────────────────────────────────────────────────────────────
  const syncTelemetry3D = () => {
    if (viewer.isDestroyed()) return;
    const state = useTelemetryStore.getState();

    // 1. Flights + 3D Vertical Altitude Stems
    const seenFlights = new Set<string>();
    if (state.flightsEnabled) {
      const flights: FlightTarget[] = state.displayedFlights ?? state.flights;
      for (const f of flights) {
        if (!Number.isFinite(f.longitude) || !Number.isFinite(f.latitude)) continue;
        seenFlights.add(f.icao24);

        const alt = Math.max(15, f.altitudeMeters || 0);
        const pos = Cartesian3.fromDegrees(f.longitude, f.latitude, alt);
        const hexColor = f.emergency ? "#ef4444" : getAircraftAltitudeColor(alt);
        const rotationRad = -CesiumMath.toRadians(f.headingDeg || 0);
        const iconUri = getCachedSvgUri(
          `flight:${f.category || 0}:${hexColor}:${!!f.emergency}`,
          () => getFlightSvg(f.category || 0, hexColor, !!f.emergency),
        );

        let bb = flightBillboards.get(f.icao24);
        if (bb) {
          bb.show = true;
          bb.position = pos;
          bb.rotation = rotationRad;
          bb.image = iconUri;
          bb.id = {
            strataType: "telemetry",
            telemetryType: "flight",
            raw: f,
            lon: f.longitude,
            lat: f.latitude,
            alt,
          };
        } else {
          bb = telemetryBillboards.add({
            position: pos,
            image: iconUri,
            width: f.emergency ? 24 : 18,
            height: f.emergency ? 24 : 18,
            rotation: rotationRad,
            alignedAxis: Cartesian3.UNIT_Z,
            scaleByDistance: new NearFarScalar(5_000, 1.2, 8_000_000, 0.45),
            id: {
              strataType: "telemetry",
              telemetryType: "flight",
              raw: f,
              lon: f.longitude,
              lat: f.latitude,
              alt,
            },
          });
          flightBillboards.set(f.icao24, bb);
        }

        // Vertical altitude drop-line to ground
        const groundPos = Cartesian3.fromDegrees(f.longitude, f.latitude, 0);
        let stem = flightStems.get(f.icao24);
        if (stem) {
          stem.show = true;
          stem.positions = [groundPos, pos];
        } else {
          stem = telemetryPolylines.add({
            positions: [groundPos, pos],
            width: 1,
            material: Material.fromType("Color", {
              color: Color.fromCssColorString(hexColor).withAlpha(0.35),
            }),
          });
          flightStems.set(f.icao24, stem);
        }
      }
    }
    for (const [id, bb] of flightBillboards.entries()) {
      if (!seenFlights.has(id)) {
        bb.show = false;
        const stem = flightStems.get(id);
        if (stem) stem.show = false;
      }
    }

    // 2. Satellites + SGP4 Orbit Polylines
    const seenSats = new Set<string>();
    if (state.satellitesEnabled) {
      const satIconUri = getCachedSvgUri("satellite", () => getSatelliteSvg());
      for (const s of state.satellites as SatelliteTarget[]) {
        if (!Number.isFinite(s.longitude) || !Number.isFinite(s.latitude)) continue;
        const noradKey = String(s.noradId);
        seenSats.add(noradKey);

        const altM = Math.max(100_000, (s.altitudeKm || 400) * 1000);
        const pos = Cartesian3.fromDegrees(s.longitude, s.latitude, altM);

        let bb = satelliteBillboards.get(noradKey);
        if (bb) {
          bb.show = true;
          bb.position = pos;
          bb.id = {
            strataType: "telemetry",
            telemetryType: "satellite",
            raw: s,
            lon: s.longitude,
            lat: s.latitude,
            alt: altM,
          };
        } else {
          bb = telemetryBillboards.add({
            position: pos,
            image: satIconUri,
            width: 18,
            height: 18,
            scaleByDistance: new NearFarScalar(100_000, 1.2, 50_000_000, 0.4),
            id: {
              strataType: "telemetry",
              telemetryType: "satellite",
              raw: s,
              lon: s.longitude,
              lat: s.latitude,
              alt: altM,
            },
          });
          satelliteBillboards.set(noradKey, bb);
        }

        if (s.groundTrack && s.groundTrack.length > 1) {
          const orbitPositions = s.groundTrack.map(([lon, lat]) =>
            Cartesian3.fromDegrees(lon, lat, altM),
          );
          let orbit = satelliteOrbits.get(noradKey);
          if (orbit) {
            orbit.show = true;
            orbit.positions = orbitPositions;
          } else {
            orbit = telemetryPolylines.add({
              positions: orbitPositions,
              width: 1.5,
              material: Material.fromType("PolylineDash", {
                color: Color.fromCssColorString("#c084fc").withAlpha(0.65),
              }),
            });
            satelliteOrbits.set(noradKey, orbit);
          }
        } else {
          const orbit = satelliteOrbits.get(noradKey);
          if (orbit) orbit.show = false;
        }
      }
    }
    for (const [id, bb] of satelliteBillboards.entries()) {
      if (!seenSats.has(id)) {
        bb.show = false;
        const orbit = satelliteOrbits.get(id);
        if (orbit) orbit.show = false;
      }
    }

    // 3. AIS Vessels + Great-Circle Voyage Routes
    const seenVessels = new Set<string>();
    if (state.vesselsEnabled) {
      const vessels: VesselTarget[] = state.displayedVessels ?? state.vessels;
      for (const v of vessels) {
        if (!Number.isFinite(v.lon) || !Number.isFinite(v.lat)) continue;
        const mmsiKey = String(v.mmsi);
        seenVessels.add(mmsiKey);

        const pos = Cartesian3.fromDegrees(v.lon, v.lat, 5);
        const rotationRad = -CesiumMath.toRadians(v.headingDeg || 0);
        const shipTypeNum =
          typeof v.shipType === "number"
            ? v.shipType
            : parseInt(String(v.shipType ?? "0"), 10) || 0;
        const speedNum = Number(v.speedKnots) || 0;
        const vesselIconUri = getCachedSvgUri(
          `vessel:${shipTypeNum}:${speedNum}`,
          () => getVesselSvg(shipTypeNum, speedNum, "#06b6d4"),
        );

        let bb = vesselBillboards.get(mmsiKey);
        if (bb) {
          bb.show = true;
          bb.position = pos;
          bb.rotation = rotationRad;
          bb.image = vesselIconUri;
          bb.id = {
            strataType: "telemetry",
            telemetryType: "vessel",
            raw: v,
            lon: v.lon,
            lat: v.lat,
            alt: 5,
          };
        } else {
          bb = telemetryBillboards.add({
            position: pos,
            image: vesselIconUri,
            width: 16,
            height: 16,
            rotation: rotationRad,
            alignedAxis: Cartesian3.UNIT_Z,
            scaleByDistance: new NearFarScalar(2_000, 1.1, 5_000_000, 0.4),
            id: {
              strataType: "telemetry",
              telemetryType: "vessel",
              raw: v,
              lon: v.lon,
              lat: v.lat,
              alt: 5,
            },
          });
          vesselBillboards.set(mmsiKey, bb);
        }

        const route = computeVoyageRoute(v.lon, v.lat, v.destination, v.speedKnots);
        let routeLines = vesselRoutes.get(mmsiKey);
        if (route && route.segments.length > 0) {
          if (!routeLines) {
            routeLines = [];
            vesselRoutes.set(mmsiKey, routeLines);
          }
          for (let idx = 0; idx < route.segments.length; idx++) {
            const seg = route.segments[idx];
            const flat = seg.flatMap(([lon, lat]) => [lon, lat]);
            const cartPositions = Cartesian3.fromDegreesArray(flat);
            if (idx < routeLines.length) {
              routeLines[idx].show = true;
              routeLines[idx].positions = cartPositions;
            } else {
              const pl = telemetryPolylines.add({
                positions: cartPositions,
                width: 1.5,
                material: Material.fromType("PolylineDash", {
                  color: Color.WHITE.withAlpha(0.45),
                }),
              });
              routeLines.push(pl);
            }
          }
          for (let idx = route.segments.length; idx < routeLines.length; idx++) {
            routeLines[idx].show = false;
          }
        } else if (routeLines) {
          for (const pl of routeLines) {
            pl.show = false;
          }
        }
      }
    }
    for (const [id, bb] of vesselBillboards.entries()) {
      if (!seenVessels.has(id)) {
        bb.show = false;
        const rLines = vesselRoutes.get(id);
        if (rLines) {
          for (const pl of rLines) pl.show = false;
        }
      }
    }

    // 4. Seismic Earthquakes
    const seenQuakes = new Set<string>();
    if (state.earthquakesEnabled) {
      const quakes: EarthquakeTarget[] = state.displayedEarthquakes ?? state.earthquakes;
      for (const q of quakes) {
        if (!Number.isFinite(q.longitude) || !Number.isFinite(q.latitude)) continue;
        seenQuakes.add(q.id);

        const pos = Cartesian3.fromDegrees(q.longitude, q.latitude, 0);
        const colHex =
          q.magnitude >= 6.0 ? "#ef4444" : q.magnitude >= 4.5 ? "#f59e0b" : "#06b6d4";
        const quakeIconUri = getCachedSvgUri(
          `quake:${Math.round(q.magnitude * 10)}:${colHex}`,
          () => getEarthquakeSvg(q.magnitude, colHex),
        );
        const size = Math.max(16, Math.min(32, Math.round(q.magnitude * 4.5)));

        let bb = earthquakeBillboards.get(q.id);
        if (bb) {
          bb.show = true;
          bb.position = pos;
          bb.image = quakeIconUri;
          bb.width = size;
          bb.height = size;
          bb.id = {
            strataType: "telemetry",
            telemetryType: "earthquake",
            raw: q,
            lon: q.longitude,
            lat: q.latitude,
            alt: 0,
          };
        } else {
          bb = telemetryBillboards.add({
            position: pos,
            image: quakeIconUri,
            width: size,
            height: size,
            scaleByDistance: new NearFarScalar(5_000, 1.2, 10_000_000, 0.4),
            id: {
              strataType: "telemetry",
              telemetryType: "earthquake",
              raw: q,
              lon: q.longitude,
              lat: q.latitude,
              alt: 0,
            },
          });
          earthquakeBillboards.set(q.id, bb);
        }
      }
    }
    for (const [id, bb] of earthquakeBillboards.entries()) {
      if (!seenQuakes.has(id)) {
        bb.show = false;
      }
    }

    // 5. Thermal Fires
    const seenFires = new Set<string>();
    if (state.firesEnabled) {
      const fires: FireTarget[] = state.displayedFires ?? state.fires;
      const fireIconUri = getCachedSvgUri("fire", () => getFireSvg("#f97316"));
      for (const fire of fires) {
        if (!Number.isFinite(fire.lon) || !Number.isFinite(fire.lat)) continue;
        seenFires.add(fire.id);

        const pos = Cartesian3.fromDegrees(fire.lon, fire.lat, 0);
        let bb = fireBillboards.get(fire.id);
        if (bb) {
          bb.show = true;
          bb.position = pos;
          bb.id = {
            strataType: "telemetry",
            telemetryType: "fire",
            raw: fire,
            lon: fire.lon,
            lat: fire.lat,
            alt: 0,
          };
        } else {
          bb = telemetryBillboards.add({
            position: pos,
            image: fireIconUri,
            width: 16,
            height: 16,
            scaleByDistance: new NearFarScalar(5_000, 1.1, 8_000_000, 0.35),
            id: {
              strataType: "telemetry",
              telemetryType: "fire",
              raw: fire,
              lon: fire.lon,
              lat: fire.lat,
              alt: 0,
            },
          });
          fireBillboards.set(fire.id, bb);
        }
      }
    }
    for (const [id, bb] of fireBillboards.entries()) {
      if (!seenFires.has(id)) {
        bb.show = false;
      }
    }

    viewer.scene.requestRender();
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Sync Bookmarks with Low-Level Billboard GPU Collection
  // ───────────────────────────────────────────────────────────────────────────
  const bookmarkIconUri = getCachedSvgUri(
    "bookmark",
    () =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#ffffff" stroke="#111827" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>`,
  );

  const syncBookmarks3D = (bookmarks: Bookmark[]) => {
    if (viewer.isDestroyed()) return;
    const seenBookmarks = new Set<string>();

    for (const b of bookmarks) {
      if (!Number.isFinite(b.lon) || !Number.isFinite(b.lat)) continue;
      seenBookmarks.add(b.id);
      const pos = Cartesian3.fromDegrees(b.lon, b.lat, 15);
      const col = Color.fromCssColorString(b.color || "#00e5ff");

      let bb = bookmarkBillboardMap.get(b.id);
      if (bb) {
        bb.show = true;
        bb.position = pos;
        bb.color = col;
        bb.id = {
          strataType: "bookmark",
          bookmarkId: b.id,
          title: b.title,
          lon: b.lon,
          lat: b.lat,
        };
      } else {
        bb = bookmarkBillboards.add({
          position: pos,
          image: bookmarkIconUri,
          color: col,
          width: 18,
          height: 18,
          scaleByDistance: new NearFarScalar(2_000, 1.2, 5_000_000, 0.5),
          id: {
            strataType: "bookmark",
            bookmarkId: b.id,
            title: b.title,
            lon: b.lon,
            lat: b.lat,
          },
        });
        bookmarkBillboardMap.set(b.id, bb);
      }
    }

    for (const [id, bb] of bookmarkBillboardMap.entries()) {
      if (!seenBookmarks.has(id)) {
        bb.show = false;
      }
    }

    viewer.scene.requestRender();
  };

  // Initial Data Sync
  syncDatasets3D();
  syncTelemetry3D();
  syncBookmarks3D(useProjectStore.getState().bookmarks);
  void syncViewportStream3D();

  // Store Subscriptions
  const uiUnsubscribe = useUiStore.subscribe((state, previous) => {
    if (state.basemap !== previous.basemap) {
      void applyBasemap3D(state.basemap);
    }
  });
  const projectUnsubscribe = useProjectStore.subscribe((state, previous) => {
    if (
      state.layers !== previous.layers ||
      state.datasets !== previous.datasets ||
      state.selection !== previous.selection
    ) {
      syncDatasets3D();
      void syncViewportStream3D();
    }
    if (state.bookmarks !== previous.bookmarks) {
      syncBookmarks3D(state.bookmarks);
    }
  });
  const telemetryUnsubscribe = useTelemetryStore.subscribe(() => {
    syncTelemetry3D();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Unified 3D ScreenSpaceEventHandler (Feature Details, Popups & CCTV Feeds)
  // ───────────────────────────────────────────────────────────────────────────
  const eventHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);

  eventHandler.setInputAction((movement: { endPosition: Cartesian2 }) => {
    const picked = viewer.scene.pick(movement.endPosition);
    const ray = viewer.camera.getPickRay(movement.endPosition);
    if (ray) {
      const groundPt = viewer.scene.globe.pick(ray, viewer.scene);
      if (defined(groundPt)) {
        const carto = Cartographic.fromCartesian(groundPt);
        useMapStore.getState().setPointer({
          lon: CesiumMath.toDegrees(carto.longitude),
          lat: CesiumMath.toDegrees(carto.latitude),
        });
      }
    }

    const props = getStrataTarget(picked, viewer.clock.currentTime);
    if (props) {
      if (props.strataType === "telemetry") {
        useTelemetryStore.getState().setHoveredTarget(
          { type: props.telemetryType, data: props.raw },
          { x: Math.round(movement.endPosition.x), y: Math.round(movement.endPosition.y) },
          [props.lon, props.lat],
        );
        return;
      }
      if (props.strataType === "dataset-feature") {
        useTelemetryStore.getState().setHoveredTarget(null, null, null);
        useMapStore.getState().setActiveFeature({
          layerId: props.layerId,
          featureId: props.featureId,
          lon: props.lon,
          lat: props.lat,
          properties: props.rawProps,
        });
        return;
      }
    }

    useTelemetryStore.getState().setHoveredTarget(null, null, null);
    useMapStore.getState().setActiveFeature(null);
  }, ScreenSpaceEventType.MOUSE_MOVE);

  eventHandler.setInputAction((click: { position: Cartesian2 }) => {
    const picked = viewer.scene.pick(click.position);
    const props = getStrataTarget(picked, viewer.clock.currentTime);

    if (props) {
      if (props.strataType === "telemetry") {
        useTelemetryStore.getState().setSelectedTarget({
          type: props.telemetryType,
          data: props.raw,
        });
        useUiStore.getState().openPanel("telemetry");
        return;
      }
      if (props.strataType === "dataset-feature") {
        useProjectStore.getState().select({
          layerId: props.layerId,
          featureId: props.featureId,
        });
        useUiStore.getState().openPanel("feature");
        return;
      }
      if (props.strataType === "bookmark") {
        useUiStore.getState().openPanel("bookmarks");
        return;
      }
    }
  }, ScreenSpaceEventType.LEFT_CLICK);

  eventHandler.setInputAction((click: { position: Cartesian2 }) => {
    const picked = viewer.scene.pick(click.position);
    const props = getStrataTarget(picked, viewer.clock.currentTime);

    if (props && props.strataType === "bookmark") {
      const rect = viewer.scene.canvas.getBoundingClientRect();
      useMapStore.getState().setBookmarkContextMenu({
        x: Math.round(rect.left + click.position.x),
        y: Math.round(rect.top + click.position.y),
        bookmarkId: props.bookmarkId,
      });
    }
  }, ScreenSpaceEventType.RIGHT_CLICK);

  const cleanup: Array<() => void> = [];
  let settled = false;
  const finish = () => {
    if (settled || viewer.isDestroyed()) return;
    settled = true;
    for (const off of cleanup.splice(0)) {
      off();
    }
    onReady?.();
  };
  const fallbackTimer = window.setTimeout(finish, 10_000);
  cleanup.push(() => window.clearTimeout(fallbackTimer));
  const postRenderListener = viewer.scene.postRender.addEventListener(() => {
    if (viewer.scene.globe.tilesLoaded || (google3DTileset && google3DTileset.show)) {
      finish();
    }
  });
  cleanup.push(() => postRenderListener());

  const resize = () => viewer.resize();
  const observer = new ResizeObserver(resize);
  observer.observe(target);

  activeViewer = viewer;
  if (import.meta.env.DEV) {
    (window as unknown as { __strataCesium?: Viewer }).__strataCesium = viewer;
  }

  return () => {
    observer.disconnect();
    eventHandler.destroy();
    viewer.camera.changed.removeEventListener(syncCameraToStore);
    viewer.camera.moveEnd.removeEventListener(syncViewportStream3D);
    activeStreamAbortController?.abort();
    uiUnsubscribe();
    projectUnsubscribe();
    telemetryUnsubscribe();
    for (const off of cleanup.splice(0)) {
      off();
    }

    telemetryBillboards.removeAll();
    telemetryPolylines.removeAll();
    bookmarkBillboards.removeAll();
    viewer.scene.primitives.remove(telemetryBillboards);
    viewer.scene.primitives.remove(telemetryPolylines);
    viewer.scene.primitives.remove(bookmarkBillboards);

    flightBillboards.clear();
    flightStems.clear();
    satelliteBillboards.clear();
    satelliteOrbits.clear();
    vesselBillboards.clear();
    vesselRoutes.clear();
    earthquakeBillboards.clear();
    fireBillboards.clear();
    bookmarkBillboardMap.clear();

    activeAnalysisDataSource = null;
    activeKnnDataSource = null;
    activeProfileHoverEntity = null;
    google3DTileset = null;
    activeViewer = null;

    if (!viewer.isDestroyed()) {
      viewer.destroy();
    }
  };
}

export function getCesiumViewer(): Viewer | null {
  return activeViewer;
}
