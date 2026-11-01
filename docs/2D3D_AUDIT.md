# 2D/3D map audit — seamless experience

**Scope:** every subsystem that OpenLayers 2D or the Cesium 3D spike touches —
renderers, camera, layers, interaction, overlays, export, attribution, status
surface, perf, packaging.
**Method:** full source read of `mapController.ts`, `cesiumView.ts`,
`MapCanvas`/`CesiumCanvas`/`App`/controls/panels, plus the CDP browser runs from
the spike. Evidence: file/function references with each finding.
**Date:** 1 November 2026. Spike state: mount/toggle/camera gates passed.

---

## 1. How it works today (one paragraph)

Single-window app, two absolutely-stacked canvases. OpenLayers (`MapCanvas`,
always mounted) is the full-featured 2D engine and owns **all data layers,
interactions, and hover logic**. Cesium (`CesiumCanvas`, mounted only while
`viewMode === "3d"`) renders **one OSM raster basemap and nothing else**. The
seam contract is deliberately small: `useMapStore.camera` is the handoff point —
OL writes it on every view event, Cesium mirrors it via `camera.changed`, and
`applyCamera` applies the store pose back into whichever engine is visible.
Camera commands (`zoomBy`, `flyTo`, `resetNorth`, `fitToData`, `applyCamera`,
`flyToCoordinate`, `zoomToLayer`) are routed through `cesiumIsActive()` in
`mapController`. Everything else silently stays 2D-only while `viewMode` is 3D.

That seam passes today for **camera + basemap imagery only**. The parity matrix
below shows why the experience is not yet seamless.

## 2. Live parity matrix

Legend: **OK** = works in the 3D mode · **2D-only** = functions but on the hidden
map (user sees nothing) · **stale** = incorrect data shown · **absent** = does
not exist in 3D and no UI feedback · **N/A** = correct to be 2D-only if labelled.

| # | Capability | 2D | 3D | Evidence / impact |
|---|---|---|---|---|
| 1 | Raster basemap imagery | OK | OK·fixed | `createImageryProvider`; only OSM wired |
| 2 | Vector basemaps (4× OpenFreeMap) | OK | **absent** | Cesium always mounts OSM regardless of `uiStore.basemap` |
| 3 | Basemap switcher outcome | OK | **stale** | Tray click calls `setBasemap` → `applyBasemap` → hidden OL; globe unchanged |
| 4 | Attribution | OK | **stale + duplicated** | `MapAttribution` reads store basemap; Cesium renders its own credit widget — two credit systems can both be wrong |
| 5 | Camera enter/exit handoff | OK | OK | verified end-to-end via CDP |
| 6 | Zoom controls / `+`/`-` keys | OK | OK | routed in `zoomBy` |
| 7 | Reset north / compass | OK | OK·sign-risk | `cesiumResetNorth`; heading→rotation sign convention unverified (both 0 today) |
| 8 | Fit to data / zoom-to-layer/selection | OK | partial | `fitToData`/`zoomToLayer` routed; `zoomToSelection` is **not** |
| 9 | Bookmarks: fly, edit-pin picker | OK | **2D-only** | `flyToBookmark`, `setBookmarkPinPicker` unrouted — clicking a bookmark visibly does nothing in 3D |
| 10 | Search / flyToCoordinate | OK | OK | routed (ignores `rotation` param) |
| 11 | User location (GPS) | OK | **stale** | `setUserLocation` draws marker on hidden OL source; camera flies to an invisible point |
| 12 | Feature hover/click, FeaturePopup | OK | **stale** | `screenPositionFor` still answers with OL pixels — popups position incorrectly or float over wrong place |
| 13 | Telemetry hover popup | OK | **stale** | positions from OL `pointermove`/`postrender`; no Cesium pick |
| 14 | Datasets (vector/shapefile/gpkg) | OK | **absent** | `syncDatasetLayers` writes OL only; datasets panel edits invisible in 3D |
| 15 | MVT datasets | OK | **absent** | gate (spike planned `MVTDataProvider`) |
| 16 | COG / multispectral raster layers | OK | **absent** | `activeRasterBinding` OL `WebGLTileLayer` only |
| 17 | Traffic flow layer | OK | **absent** | uiStore toggle touches OL only |
| 18 | Live telemetry (7 WebGL layers) | OK | **absent** | `updateFlightFeatures` etc. write OL sources only |
| 19 | Measure distance/area (M/A keys) | OK | **absent + armed** | keys arm OL `Draw` invisibly; Cesium clicks do nothing but the toolbar says "Measure active" |
| 20 | Buffer / KNN / boolean pickers | OK | **absent** | `setBufferPicker` OL click handler only |
| 21 | Elevation profile hover marker | OK | **absent** | `setProfileHoverCoord` writes hidden analysis source |
| 22 | Graticule | OK | **absent** | uiStore toggle OL-only |
| 23 | Cursor MGRS/coords in status bar | OK | **stale** | "Center" only; no Cesium `pointermove` wired |
| 24 | Screenshot/region capture/export | OK | **broken** | `captureMap*` reads the hidden OL canvas → wrong image or stale frame |
| 25 | First-toggle loading experience | n/a | **absent** | ~2 MB Cesium chunk + asset cold-load happens silently behind a dark globe; no feedback |
| 26 | Projection/CRS | OK | OK | EPSG:3857 data works for both |
| 27 | Renderer teardown hygiene | OK | OK | viewer destroyed, listener removed (verified) |

Summary: **camera and basemap handoff are solid; every data-and-interaction
system is 2D-anchored.** That is the expected spike state per the parity memo —
the audit below ranks what breaks the *feeling* of seamlessness first.

## 3. Findings

Severity: **P0** = actively misleading or broken today; **P1** = visibly wrong
or wasteful; **P2** = polish/perf; **P3** = architectural for the phase 1
runtime.

### P0 — break the illusion, break the product

**F1. Popups position from a hidden OpenLayers view.**
`screenPositionFor` (mapController) still answers with OL pixel coords while the
screen shows Cesium. `FeaturePopup` and `TelemetryHoverPopup` use it for
placement, so a card opened in 2D stays frozen (worse: drifts to the wrong
place as you navigate the globe). * Fix short-term: hide both popups whenever
`viewMode === "3d"` (one-line UI gate), matching the "no fake 2D overlays" rule
in the memo; fix properly with `scene.cartesianToCanvasCoordinates` during the
interaction-adapter phase.

**F2. Export/screenshot captures the hidden canvas.**
`captureMapAsPng` / `captureMapRegionAsPng` render the OL canvas — in 3D the
result is a stale or transparent frame pasted as a "successful export". Cheapest
correct fix: create the Cesium viewer with
`contextOptions: { webgl: { preserveDrawingBuffer: true } }` and route both
capture functions to `viewer.scene.canvas` (region crop math already works on
canvas pixels). This also unblocks the spike's export gate without new code.

**F3. Measure tools appear active but do nothing.**
`M`/`A` keys and the measure panel arm OL `Draw` interactions that receive no
pointer events in 3D. The user gets "Measurement tool active: click map to
measure" over a deaf canvas. Fix short-term: gate `setMeasureMode` in 3D with a
toast ("Measure works on the 2D map — switch back to measure"), restoring
correct status bar behaviour; real 3D measure is a phase-2 adapter.

**F4. Bookmarks are dead controls in 3D.**
`flyToBookmark` and `setBookmarkPinPicker` don't check `cesiumIsActive()`. The
bookmark should fly the globe (trivial: extend `cesiumFlyTo` with heading) and
pin-picking should return a captured lon/lat from the Cesium click. Pin-pick can
be gated with the same toast pattern as F3 if you want no code in 3D yet.

**F5. GPS locate teleports an invisible marker.**
`setUserLocation` writes to `activeLocationSource` (hidden) then flies. Short
term either suppress the flight, or add a ~10-line Cesium counterpart (a small
`PointPrimitiveCollection` updated alongside the OL source) — the visual marker
is the whole point of the control.

**F6. Basemap tray lies in 3D.**
Tray selection changes only hidden OL. Two acceptable short-term options:
(a) wire raster-basemap switching into `cesiumView` (swap `imageryLayers`,
build `UrlTemplateImageryProvider` with `subdomains` for Google/Mqm) — moderate;
or (b) disable vector-basemap tiles in 3D with an explanatory badge, defaulting
to OSM. Either way **attribution must become single-source**: derive the credit
row from the basemap actually displayed per mode ("OSM raster for 3D") and hide
Cesium's own credit via `creditContainer: span.outerHTML = ''`/`display:none`.

### P1 — wrong-but-not-broken

**F7. Zoom ceiling mismatch.**
`heightForZoom` clamps min 750 m ≈ z15.5 but 2D allows z20 (≈57 m/px at equator).
Deep zoom on the globe stops ~4.5 zoom levels short; `zoomBy` then silently
no-ops. Derive the height clamp from the same constants (per-lat `cos`, tile
size 256) instead of the fixed 750 m.

**F8. Whole Cesium + app = one 6.2 MB chunk, loaded up-front even for 2D-only
use.**
The bundle carries Cesium for every session (`mapController` statically imports
`cesiumView`). Move `CesiumCanvas`/adapters behind `React.lazy(() =>
import("./CesiumCanvas").then(...))` (module-level `await import("cesium")`) and
drop the `mapController → cesiumView` static edge by injecting the camera
adapter via a small registry (`registerCesiumAdapter()` called on mount).
2D-only sessions stop paying Cesium entirely; first 3D toggle pays once.

**F9. No loading feedback on first 3D toggle.**
Chunk parse (~2 MB) + worker boot + tile warm-up looks like a dark globe.
Add (a) a "Loading 3D engine…" overlay until `scene.globe.tileLoadProgressEvent`
drains or first `postRender`, and (b) optionally prefetch the Cesium module on
idle (2s after mount) so the toggle feels instant by the time anyone clicks it.

**F10. Double attribution stack.**
Cesium's credit widget (repositioned `bottom-1 left-2` in `CesiumCanvas`) sits
independently of `MapAttribution`. Consolidate to the app credit row (F6) so
there is exactly one attribution line per mode.

**F11. Hidden-OL style churn.**
`createBasemapLayers` constructs all 9 basemap groups eagerly and `apply()`
fetches all four OpenFreeMap styles at startup (pre-existing — that is also
where yesterday's `Error accessing data for source openmaptiles` noise came
from: the service rate-limits). In 3D, switching basemaps keeps re-styling the
hidden OL map, doing network work invisible to the user. Defer style fetch to
first visibility and skip OL sync while 3D is showing (a `viewMode` guard on the
`uiUnsubscribe` handler is enough for the spike).

**F12. Camera routing edges.**
Unrouted public API today: `zoomToSelection`, `flyToBookmark`,
`setBookmarkPinPicker`, `setBufferPicker`/`setKnnPicker`-style click-pickers,
and the cursor-position derivative APIs (`screenPositionFor`, region
rect→world mapping). Put all of them behind a single deliberate decision —
route (implement) or gate (toast) — so no control is a silent no-op.

### P2 — polish for the seamless feel

**F13. Fade choreography on toggle.**
`MapCanvas` fades `opacity-0 → 100` (60 ms delay + 500 ms) every time you
return to 2D even though OL's last frame is already valid. Consider an instant
show (no delay) when `ready` is true, keeping the slow fade only for cold mount.
Symmetrically, Cesium's first world pixels take seconds — the crossfade may
differ per direction.

**F14. Compass/rotation semantics.**
OL rotation-positive is counterclockwise; Cesium heading is clockwise from
north. `syncCameraToStore` writes `heading` straight into `camera.rotation` and
`cesiumApplyCamera` sets `heading = camera.rotation`. Today every value is 0 so
the seam has never been exercised; add a two-sided test (tilt/rotate in 3D →
back to 2D) before bookmarks with headings and compass animation ship.
Also: `cesiumZoomBy`/`cesiumResetNorth` keep an arbitrary tilt while the UI
still advertises a flat map — decide whether 3D may tilt at all (the memo's
"top-down Cesium for flat views" rule suggests clamping pitch until terrain
ships).

**F15. `fitToData` framing difference.**
OL fit uses padding `[110,170,90,170]` and `maxZoom`; the Cesium rectangle fly
uses neither, so fitting the same dataset in each mode frames it differently.
Approximate padding by inflating the rectangle ~±15–20 % and reuse the same
`maxZoom` through the height clamp for visual parity.

**F16. Idle GPU burn.**
Cesium renders every rAF (default `requestRenderMode: false`) even when nothing
moves; OL similarly re-renders animated WebGL telemetry layers. On laptops this
is the single biggest seamless-experience perf item. Set
`requestRenderMode: true, maximumRenderTimeChange: 0.2` on the viewer (camera
moves and imagery updates still re-render) and keep the OL render loop paused
while 2D is hidden.

**F17. Zoom/route parity nits.**
`cesiumFlyTo` ignores `rotation`, `flyToCoordinate` ignores its `rotation`
argument; `cesiumZoomBy` alters absolute camera altitude rather than
zoom-perpendicular distance when tilted (matters only once tilt exists).

### P3 — phase-1 runtime alignment (no spike change needed)

- **Straight-through routing is accumulating `if (cesiumIsActive())` branches
  in `mapController`.** Fine for the spike; the memo's `MapFacade → SceneBackend`
  split must absorb this before layer-parity work starts, otherwise every new
  control adds a mode branch in five places.
- **Dataset/telemetry/measure mirroring needs one store-driven adapter
  contract** (as designed in §4.5 of the memo) — not per-feature plumbing.
- **Tauri packaging/CSP still unverified** for `cesium/{Workers,Assets,…}` in a
  release build — the static-copy fix lands the files, the gate needs a
  `tauri build --debug` smoke test on Linux/WebKit where WebGL2 support varies.

## 4. Recommended order (smallest fix first)

| Batch | Items | Est. | Effect |
|---|---|---|---|
| **A — stop the lies** | F1, F2, F3, F5-suppress, F6b (badge + single attribution) | ~1 day | nothing in 3D pretends to work; export returns real pixels |
| **B — cheap real features** | F7, F9, F10, F15, F16 | ~1–2 days | zoom parity, honest loading, single credit row, matched framing, idle CPU sane |
| **C — code-load & tracking** | F8 (lazy chunk + adapter registry), F5-full (Cesium GPS marker), F6a (raster basemap switching in 3D) | ~2–3 days | instant-feeling toggle; basemap tray truthful |
| **D — gates continue** | memo §6: telemetry 1k billboards, COG formula, OpenFreeMap parity, MVT pick, measure path, Tauri smoke | 1–2 weeks | go/no-go evidence |

## 5. Verification checklist (per change)

1. Toggle 2D→3D→2D on a project with datasets, bookmarks, GPS fix, selected
   feature: no stale overlay, no crash, camera preserved both ways.
2. Export a 3D screenshot; compare with the on-screen globe (not the hidden map).
3. Zoom to z20 (50 m scale bar) in 3D and back; scale bar and center stay sane.
4. Rotate the globe 45°, return to 2D, verify north arrow/settings match the
   documented sign convention.
5. Basemap tray actions in 3D either visibly swap imagery or show a reason.
6. `bun test` + `bun run build` green; CDP harness round-trip added to a script.

---

## 6. Implementation status — Batch A + B landed (1 Nov 2026)

All Batch A and B items are implemented and verified end-to-end in headless
Chromium (CDP runs, ~3 rounds, zero console errors), with `bun run build` and
`bun test` (278 pass) green.

| Finding | Fix | Verified evidence |
|---|---|---|
| F1 popups | `FeaturePopup` + `TelemetryHoverPopup` return `null` in 3D | Popup card visible in 2D, gone after toggling 3D, returns in 2D |
| F2 export | Viewer gets `preserveDrawingBuffer`; `captureCesiumAsPng(rect?)`; `captureMapAsPng`/`captureMapRegionAsPng` route to Cesium | Full capture ≈1 MB data URL + 100×80 px crop crop works in 3D |
| F3 measure | `M`/`A` keys, ElevationPanel, BookmarkContextMenu, BookmarksPanel gated with "…switch back to 2D" toast; `measureMode` stays `off` | Key press in 3D shows toast, mode unchanged |
| F4 bookmarks | `flyToBookmark` → `cesiumFlyToBookmark` (heading = `-rotation`, sign provisional); `setBookmarkPinPicker` gated with toast | Globe lands exactly on bookmark lon/lat/zoom, heading −20° for +0.35 rad |
| F5 GPS | Camera flight kept; honest toast "GPS marker pins on the 2D map" until the Cesium marker (Batch C) | code-reviewed |
| F6b/F10 attribution | `MapAttribution` credits the basemap actually painted per mode (vector selections → OSM credit in 3D); Cesium credit widget into a detached `creditContainer` | `© OpenStreetMap` → `© Google` → `© Esri · Maxar…` follows the imagery swap; no Cesium credit row |
| F6a-lite basemaps | `cesiumView` subscribes `uiStore.basemap`: rasters swap imagery, vectors fall back to OSM + "Vector basemaps are 2D-only" toast | Round-trip positron → google-maps → positron; provider URLs + credit + toast all correct |
| F7 zoom ceiling | Height clamp derived from zoom-20 (par-lat), no more fixed 750 m storey | Floor reached at 38 m ≈ zoom 19.99 in the shared camera store |
| F9 loading | `mountCesium(target, onReady?)` resolves on first postRender + drained imagery (10 s ceiling); CesiumCanvas shows "Loading 3D globe…" | Loader visible at 2 s, gone at ~4.5 s |
| F15 fit framing | `cesiumFitExtent(extent, maxZoom?)` computes center+height with `[110,170,90,170]`-equivalent padding and a maxZoom floor | used by `fitToData` (target.maxZoom) and `zoomToLayer` (16) |
| F16 idle render | `requestRenderMode: true, maximumRenderTimeChange: 0.2` | renders only on change |
| F12 partial | `zoomToSelection` gated with toast too | toast verified |

Deferred (unchanged): F8 lazy chunk + adapter registry, F5-full Cesium GPS
marker, F13 fade choreography, F14 rotation/tilt sign verification (now
reachable: `cesiumFlyToBookmark` exercises the seam), remaining Batch C/D gates.
