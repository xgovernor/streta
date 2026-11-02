# Progressive 3D ("Google Maps-style") — research & gap analysis

**Question:** In Google Maps, Ctrl+drag tilts the *2D* map into an oblique
"2.5D" view immediately, the heavy 3D engine boots silently behind it, and
photorealistic 3D only ever streams for the tiles near what is on screen. How
does that work, and what would it take for Strata?

**Date:** 2 Nov 2026. Companion to `docs/2D3D_AUDIT.md` (F-numbered findings)
and `docs/3D_MAP_RESEARCH.md` §11–12.

---

## 1. How Google actually does it (research findings)

The behaviour you observed is **not** "2D renderer + 3D engine warming up
behind it". It is two *independent products* glued at the camera:

### 1.1 The instant tilt is the *vector WebGL map*, not 3D

- Google ships two renderers for the Maps JS API: a **raster map** (image
  tiles) and a **vector map** (client-rendered WebGL vector tiles). Tilt,
  heading, and 3D buildings exist **only on the vector renderer**
  (<https://developers.google.com/maps/documentation/javascript/vector-map>).
- The vector map is the *same 2D map* you were looking at one gesture earlier:
  one WebGL context draws vector tiles, extrudes buildings in perspective, and
  pitches the camera along a nadir arc. Nothing except the camera moves — so
  the tilt is instant with zero loading.
- The old Google issue-tracker thread confirms the dependency: tilt and
  rotation were long requested "for vector maps" and are unsupported on
  raster maps (issuetracker 161501609). The consumer Maps Ctrl+drag and the
  API shift+drag map to exactly this mechanism.
- Tilt is **zoom-gated** — you cannot lean the flat map over much at small
  zoom, which keeps the trick cheap and readable:

  | Zoom | max tilt |
  |---|---|
  | ≤ 10 | 30° (from z10) |
  | 12 | 37.5° |
  | 14 | 45° |
  | 15 | 60° |
  | ≥ 15.5 | 67.5° |

  (rising "3.75°/zoom 10→14, then 15°/zoom 14→15.5", per the vector-map docs.)
- Perspective consequences Google tolerates: `getBounds()` returns a superset
  of what is visible once tilted; `fitBounds()`/`panToBounds()` **silently
  reset tilt and heading to 0**; fractional zoom + camera model
  (target/bearing/tilt/zoom).

### 1.2 "Full 3D" is the photorealistic 3D Tiles engine — streaming only

- The photorealistic mesh is a separate library, loaded on demand:
  `await google.maps.importLibrary('maps3d')` → `Map3DElement`
  (<https://developers.google.com/maps/documentation/javascript/3d/map-modes>).
  It never pre-boots; you pay for it when you actually enter 3D.
- Its imagery/mesh is Google's **Photorealistic 3D Tiles** (Map Tiles API),
  i.e. the OGC **3D Tiles** standard: an HLOD quadtree where each tile carries
  a *geometric error*, and the client streams children only while the tile's
  screen-space error (SSE) exceeds the budget
 (<https://docs.ogc.org/cs/22-025r4/22-025r4.html>;
 see Cesium's selection-algorithm doc for the exact traversal: it computes SSE
 per ViewState, refuses tiles beyond the SSE budget, and frustum + fog culls
 everything off-screen).
- So "it only renders the part the user is watching & nearby tiles" is simply
  **how 3D Tiles clients work by design** — there is no extra Google magic;
  any standards-compliant client (CesiumJS included) gets viewport-only
  streaming for free.
- The 3D map has its own basemap modes (`ROADMAP` keeps the vector-look
  labelled basemap as ground under and around the streamed mesh;
  `SATELLITE`/`HYBRID` swap imagery) — the "ground plane stays 2D-ish, the
  mesh streams in" effect you noticed comes from that layering.

**TL;DR:** the seamless-feeling pyramid is ① vector WebGL renderer with a
pitched camera (instant tilt, 2.5D buildings) → ② lazy `maps3d` imports → ③
SSE/frustum-culled 3D Tiles streaming. Tilt never waits for anything, and 3D
looping only downloads what the frustum sees.

## 2. What Strata has today (implementation check)

| Google ingredient | Strata status | Evidence |
|---|---|---|
| Instant tilt on the 2D canvas | **Not expressible in OL.** OpenLayers `View` has no pitch — only `rotation` (CCW). A 2D tilt needs a different 2D engine or a non-native transform hack (`mapController.ts` `new View({center, zoom, rotation…})`; view maxZoom 22). | `src/map/mapController.ts` |
| One renderer for 2D and 2.5D | Two renderers: OL (`MapCanvas`, always mounted) and Cesium (`CesiumCanvas`, mounted while `viewMode === "3d"`). Google keeps a single renderer and never swaps canvases. | `MapCanvas.tsx`, `CesiumCanvas.tsx` |
| 3D engine boots lazily | **Statically bundled:** `mapController` imports `cesiumView` at module scope, so Cesium already sits in the 6.2 MB main chunk. On toggle we pay WebGL boot + tile warm-up (~4.5 s to "ready" with the new loader). Pre-warm (idle prefetch of the chunk) was deferred with Batch C (F8/F9). | `docs/2D3D_AUDIT.md` F8/F9 |
| Viewport-only 3D streaming | **Already free** — Cesium streams imagery/terrain/3D Tiles with the same SSE + frustum culling design; nothing extra to build once data sources are 3D-Tiles- or tilegrid-based. | inherent in Cesium |
| Zoom-gated tilt | **Relevant immediately:** after F14 we planned to clamp pitch in Cesium (audit pending decision), and Google's schedule is a ready honest policy to copy: allow oblique views only when zoom deep enough to carry them. | `cesiumApplyCamera` currently forces `pitch: -π/2` |
| Camera model | `useMapStore.camera` has `lon/lat/zoom/rotation/resolution` — **no pitch field**. OL bookmarks carry `pitch?:`, Cesium uses fixed `-π/2` except preserved tilt in `cesiumZoomBy` — the store can't round-trip tilt yet. | `src/lib/gis/types.ts` CameraState |

So, specifically against your three observations:

1. *"2D tilts into 2.5D while 3D initializes silently"* — Google: vector map
   tilts with zero swap. Strata: cannot tilt in 2D at all; our equivalent
   would be pre-booting Cesium *before* the user toggles, so the swap-when-3D
   feels instant (fix: F8 lazy chunk + idle prefetch + keep the loader).
2. *"3D engine initializing in the background"* — true in spirit: the engine
   they init is trivially small because the vector renderer already did the
   perspective work. Our Cesium is heavyweight, so the honest answer is to
   prefetch the chunk on idle; never boot it mid-gesture (see Option ①).
3. *"Only what's on screen becomes 3D"* — Cesium does this natively. When we
   add 3D Tiles datasets (Batch D gates) this property carries over, including
   SSE-based refinement and `maximumScreenSpaceError` tuning for how
   aggressively tiles converge.

## 3. Options for bringing the "Google progression" feel to Strata

Ordered by cost; ② is the only one that *is* Google's 2.5D, the others make
the 2D→3D *succession* feel as good as it can with renderers we already have.

### Option ① — Make the handoff seamless with the current dual-renderer (recommended next, Batch C scope)

- **F8 finally in:** split Cesium into a lazy chunk (dynamic `import`),
  prefetch it on idle ~2 s after app start (a real Google touch: they
  lazy-load libraries and preload code in the background).
- Do **not** pre-mount a hidden Cesium viewer: an invisible WebGL context
  still burns GPU and consumes a GL context slot — prefetching bytes is
  cheap, pre-booting is not.
- Adopt Google's **zoom-gated tilt policy** in 3D: clamp pitch to the same
  schedule (30° @ z10 → 67.5° @ z15.5) so the globe answers Ctrl+drag with
  the same restraint users know, and replace the hard `pitch: -π/2` pins
  in `cesiumApplyCamera`/`cesiumFlyTo` with "preserve the (clamped) tilt".
- Persist pitch in `CameraState` (add `pitch?: number`) so bookmarks + store
  round-trip it; resolves F14's sign/tilt ambiguity once with one field.

### Option ② — Progressive 3D *inside* the 2D map via a WebGL vector renderer

Google's actual trick requires a 2D engine that can pitch. Candidates:

- **MapLibre GL JS** as the basemap canvas under Strata: has native `pitch`
  (0–70°), `fill-extrusion` 3D buildings, terrain, and it natively consumes
  the exact styles we already ship (OpenFreeMap styles are MapLibre styles —
  we currently rasterise them through `ol-mapbox-style` into OL tiles). A
  MapLibre basemap + OL overlays on top can look tilted only if the overlay
  canvas is transformed the same way — that is where it stops being honest;
  tilted OL vector data cannot share the projection legitimately. Full
  migration of datasets/measure/telemetry into MapLibre is a rewrite-scale
  change (our parity memo rejected switch-class churn before; same rule).
- Cesium-only single-renderer (top-down Cesium as THE map) re-opens the
  §11.1 of the memo — already ruled out due to 2D ergonomics, label quality,
  bundle.

Verdict: possible, but it is a roadmap decision (replace OL or adopt
MapLibre plus a thin data layer) — worth a spike only if "2.5D without 3D"
is a product requirement, not nice-to-have.

### Option ③ — Take the passive win: viewport streaming where it matters (Batch D gates)

- Survey meshes / COG-derived 3D Tiles: use `Cesium3DTileset` with
  `maximumScreenSpaceError` tuned; Cesium's traversal already refines only
  frustum-visible tiles — matching Google's behaviour out of the box
  (see the `Cesium3DTileset` docs).
- Keep screen-aligned loading UX: Google's ground-plane basemap under the
  streaming mesh maps to our "OSM raster in 3D loads first (already
  the case)".

## 4. Concrete next steps (fold into Batch C/D)

1. Do the **F8 lazy-chunk + idle prefetch** now — it directly grants the
   "initializing silently" perception without new architecture. (~day)
2. Add `pitch` to `CameraState`, propagate through `cesiumApplyCamera`,
   `syncCameraToStore`, bookmark round-trip; wire the Google tilt schedule
   table into `cesiumZoomBy`/manual Ctrl-drag clamps. (~day)
3. Re-verify: tilt in 3D at z10 (expect clamped ≤ 30°), z15 (≤ 60°);
   rotation sign round-trip F14 test at the same time.
4. When COG/photoreal gates start, treat "only-view-streaming" as pass-by-
   default and use `maximumScreenSpaceError`/`skipLevelOfDetail` as tuning,
   not features to build.

## 5. References

- Vector map tilt & rotation (docs): <https://developers.google.com/maps/documentation/javascript/vector-map>
- 3D map modes / `Map3DElement`: <https://developers.google.com/maps/documentation/javascript/3d/map-modes>
- WebGL overlay view & vector requirement: <https://developers.google.com/maps/documentation/javascript/webgl>
- Rendering type & feature gating: <https://developers.google.com/maps/documentation/javascript/map-rendering-type>
- Issue tracker: tilt/rotation only for vector maps: <https://issuetracker.google.com/issues/161501609>
- OGC 3D Tiles spec (HLOD + SSE): <https://docs.ogc.org/cs/22-025r4/22-025r4.html>
- Cesium tile-selection algorithm (per-ViewState SSE, culling):
  <https://cesium.com/learn/cesium-native/ref-doc/selection-algorithm-details.html>
- `Cesium3DTileset` (`maximumScreenSpaceError`, `skipLevelOfDetail`):
  <https://cesium.com/learn/cesiumjs/ref-doc/Cesium3DTileset.html>
- MapLibre pitch/3D buildings/terrain: <https://www.maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/>
