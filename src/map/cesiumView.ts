import {
  Cartesian3,
  Color,
  Ion,
  Math as CesiumMath,
  UrlTemplateImageryProvider,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { BASEMAPS } from "../lib/gis/data";
import type { CameraState, RasterBasemap } from "../lib/gis/types";
import { useMapStore } from "../state/mapStore";
import { useUiStore } from "../state/uiStore";

const EARTH_CIRCUMFERENCE_M = 40075016.686;
const DEFAULT_TILE_SIZE = 256;
const DEFAULT_FOVY = Math.PI / 3;

/**
 * Deepest Web Mercator zoom the raster basemap sources actually reach. Clamped
 * camera heights must never undercut this, or 3D would advertise more
 * magnification than any imagery can resolve.
 */
const MAX_ZOOM = 20;

let activeViewer: Viewer | null = null;

/**
 * Rough Web Mercator zoom -> camera height. Good enough to preserve context
 * while the real camera adapter is being spiked.
 */
function rawHeightForZoom(
  zoom: number,
  lat: number,
  viewportHeight: number,
): number {
  const metersPerPixel =
    (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) /
    (DEFAULT_TILE_SIZE * 2 ** zoom);
  return (
    (metersPerPixel * Math.max(viewportHeight, 1)) /
    (2 * Math.tan(DEFAULT_FOVY / 2))
  );
}

/** Camera height for a ground resolution, matching the 2D scale semantics. */
function heightForResolution(
  metersPerPixel: number,
  viewportHeight: number,
): number {
  return (
    (metersPerPixel * Math.max(viewportHeight, 1)) /
    (2 * Math.tan(DEFAULT_FOVY / 2))
  );
}

function clampCameraHeight(
  height: number,
  lat: number,
  viewportHeight: number,
): number {
  const min = rawHeightForZoom(MAX_ZOOM, lat, viewportHeight);
  return Math.max(Math.min(height, 50_000_000), min);
}

function heightForZoom(
  zoom: number,
  lat: number,
  viewportHeight: number,
): number {
  return clampCameraHeight(rawHeightForZoom(zoom, lat, viewportHeight), lat, viewportHeight);
}

/** Inverse of heightForZoom, used to keep the shared camera store in sync. */
function zoomForHeight(
  height: number,
  lat: number,
  viewportHeight: number,
): number {
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
 * Spike camera adapter. These helpers keep the floating controls usable while
 * the real SceneRuntime/CameraAdapter is being evaluated.
 */
export function cesiumFlyTo(lon: number, lat: number, zoom = 8): void {
  const viewer = activeReadyViewer();
  if (!viewer) return;

  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(
      lon,
      lat,
      heightForZoom(zoom, lat, viewer.scene.canvas.clientHeight),
    ),
    orientation: {
      heading: viewer.camera.heading,
      pitch: -Math.PI / 2,
      roll: 0,
    },
    duration: 0.65,
  });
}

export function cesiumZoomBy(delta: number): void {
  const viewer = activeReadyViewer();
  if (!viewer) return;

  const carto = viewer.camera.positionCartographic;
  const lon = CesiumMath.toDegrees(carto.longitude);
  const lat = CesiumMath.toDegrees(carto.latitude);
  const height = clampCameraHeight(
    carto.height / 2 ** delta,
    lat,
    viewer.scene.canvas.clientHeight,
  );

  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(lon, lat, height),
    orientation: {
      heading: viewer.camera.heading,
      pitch: viewer.camera.pitch,
      roll: 0,
    },
    duration: 0.24,
  });
}

export function cesiumResetNorth(): void {
  const viewer = activeReadyViewer();
  if (!viewer) return;

  viewer.camera.flyTo({
    destination: viewer.camera.positionWC,
    orientation: {
      heading: 0,
      pitch: viewer.camera.pitch,
      roll: 0,
    },
    duration: 0.32,
  });
}

export function cesiumApplyCamera(camera: CameraState): void {
  const viewer = activeReadyViewer();
  if (!viewer) return;

  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(
      camera.lon,
      camera.lat,
      heightForZoom(camera.zoom, camera.lat, viewer.scene.canvas.clientHeight),
    ),
    orientation: {
      // Sign convention still unverified (F14): both engines are at 0
      // rotation today and the seam has never been exercised by a nonzero
      // value. Revisit before bookmarks-with-heading ship.
      heading: camera.rotation,
      pitch: -Math.PI / 2,
      roll: 0,
    },
  });
}

/**
 * Flies to a Web Mercator bookmark pose, including heading. OL rotation is
 * counter-clockwise and Cesium heading clockwise, so the sign flips — the
 * convention is provisional until a physical rotation round-trip is verified.
 */
export function cesiumFlyToBookmark(
  bookmark: { lon: number; lat: number; zoom: number; rotation?: number },
  duration = 0.75,
): void {
  const viewer = activeReadyViewer();
  if (!viewer) return;

  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(
      bookmark.lon,
      bookmark.lat,
      heightForZoom(
        bookmark.zoom,
        bookmark.lat,
        viewer.scene.canvas.clientHeight,
      ),
    ),
    orientation: {
      heading: -(bookmark.rotation ?? 0),
      pitch: -Math.PI / 2,
      roll: 0,
    },
    duration,
  });
}

/**
 * Flies to a WGS 84 extent framed like the 2D `view.fit` with padding
 * [110, 170, 90, 170]: the rectangle is laid out inside the viewport minus
 * the panel padding, and the camera height is derived from whichever axis
 * fits worse so nothing is cropped.
 */
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
  // Same px padding OpenLayers fit uses (left/right, top/bottom).
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
    // `maxZoom` prevents fit from flying in too close, i.e. a floor on
    // camera height (height grows as zoom shrinks).
    cameraHeight = Math.max(cameraHeight, rawHeightForZoom(maxZoom, lat, viewportHeight));
  }

  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(
      (west + east) / 2,
      (south + north) / 2,
      clampCameraHeight(cameraHeight, lat, viewportHeight),
    ),
    orientation: {
      heading: viewer.camera.heading,
      pitch: -Math.PI / 2,
      roll: 0,
    },
    duration: 0.7,
  });
}

/**
 * Captures the Cesium canvas as a PNG data URL. `preserveDrawingBuffer` is
 * enabled on the viewer so the buffer survives the read. An optional rect
 * crops a client-space region, mirroring the 2D region-capture math.
 */
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
    // requestRenderMode means the last frame may be older than a camera move;
    // force a synchronous render so the buffer is current.
    viewer.render();
  } catch {
    // Render failures still leave the previous frame readable.
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

/**
 * Spike-only Cesium mount. Creates a scene with a raster basemap and copies the
 * current OL camera into a top-down Cesium view. The production runtime will
 * replace this with the full SceneRuntime from the parity memo.
 *
 * `onReady?` fires once the first frame is on screen and the imagery for the
 * initial view has drained (or after a 10 s ceiling, so a bad connection can
 * never leave the user on a loader). Safe under StrictMode double-mounting:
 * the cleanup destroys the viewer, and `finish` no-ops on destroyed viewers.
 */
export function mountCesium(target: HTMLElement, onReady?: () => void): () => void {
  const ionToken = import.meta.env.CESIUM_ION_TOKEN;
  if (ionToken) {
    Ion.defaultAccessToken = ionToken;
  }

  // App-owned attribution (MapAttribution) is the single credit line for both
  // renderers; Cesium's credit widget renders into a detached host that never
  // enters the visible DOM.
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
    shouldAnimate: false,
    contextOptions: {
      webgl: { preserveDrawingBuffer: true },
    },
    creditContainer: creditHost,
    // Render only when something changes; the biggest idle-battery win for
    // a Tauri laptop session.
    requestRenderMode: true,
    maximumRenderTimeChange: 0.2,
  });

  const openstreetmap = BASEMAPS.find((item) => item.id === "openstreetmap");

  viewer.scene.backgroundColor = Color.fromCssColorString("#070b0f");
  viewer.scene.globe.baseColor = Color.fromCssColorString("#0b1117");
  viewer.scene.globe.showGroundAtmosphere = false;
  if (viewer.scene.skyAtmosphere) {
    viewer.scene.skyAtmosphere.show = false;
  }

  const camera = useMapStore.getState().camera;
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(
      camera.lon,
      camera.lat,
      heightForZoom(camera.zoom, camera.lat, target.clientHeight),
    ),
    orientation: {
      heading: 0,
      pitch: -Math.PI / 2,
      roll: 0,
    },
  });

  // Keep the shared camera store usable as the single source of truth when
  // the user navigates the Cesium scene. This is still a coarse adapter: it
  // maps camera height to an approximate Web Mercator zoom.
  const syncCameraToStore = () => {
    if (viewer.isDestroyed()) return;
    const carto = viewer.camera.positionCartographic;
    const lon = CesiumMath.toDegrees(carto.longitude);
    const lat = CesiumMath.toDegrees(carto.latitude);
    const zoom = zoomForHeight(carto.height, lat, viewer.scene.canvas.clientHeight);
    const resolution =
      (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) /
      (DEFAULT_TILE_SIZE * 2 ** zoom);
    useMapStore.getState().setCamera({
      lon,
      lat,
      zoom,
      rotation: viewer.camera.heading,
      resolution,
    });
  };
  viewer.camera.percentageChanged = 0.01;
  viewer.camera.changed.addEventListener(syncCameraToStore);

  // 3D basemap follows the uiStore: raster styles swap imagery, vector styles
  // fall back to OSM with an honest notice until vector 3D parity lands.
  const applyBasemap3D = (id: string): void => {
    if (viewer.isDestroyed()) return;

    const meta = BASEMAPS.find((item) => item.id === id);
    if (meta?.kind === "raster") {
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.addImageryProvider(createImageryProvider(meta));
      return;
    }

    const fallback = openstreetmap?.kind === "raster" ? openstreetmap : null;
    if (!fallback) return;

    if (meta) {
      useUiStore
        .getState()
        .notify("Vector basemaps are 2D-only for now — showing OpenStreetMap");
    }
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(createImageryProvider(fallback));
  };

  // Initial state: honor the user's current 2D basemap selection.
  applyBasemap3D(useUiStore.getState().basemap);

  const uiUnsubscribe = useUiStore.subscribe((state, previous) => {
    if (state.basemap !== previous.basemap) {
      applyBasemap3D(state.basemap);
    }
  });

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

  // First render with all imagery drained; the timer above bounds the wait.
  const postRenderListener = viewer.scene.postRender.addEventListener(() => {
    if (viewer.scene.globe.tilesLoaded) {
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
    viewer.camera.changed.removeEventListener(syncCameraToStore);
    uiUnsubscribe();
    for (const off of cleanup.splice(0)) {
      off();
    }
    activeViewer = null;
    if (!viewer.isDestroyed()) {
      viewer.destroy();
    }
  };
}

export function getCesiumViewer(): Viewer | null {
  return activeViewer;
}
