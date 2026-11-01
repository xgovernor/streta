# Full 2D/3D parity for Strata

**Architecture and delivery memo — OpenLayers, CesiumJS, and ol-cesium**

**Date:** 31 October 2026  
**Status:** Research complete; architecture proposed; implementation not started  
**Scope:** Deliver the same basemaps, datasets, telemetry, tools, overlays, and export in 2D and 3D. OpenLayers remains the canonical 2D/data model. CesiumJS becomes the 3D renderer.

---

## Executive summary

**Short answer: the blocker is library capability and architecture, not the datasets.**

The data is not the problem:

- the view is EPSG:3857, the easiest case for Cesium;
- dataset geometry is already reprojected into 3857;
- the formats are ordinary GeoJSON, shapefile, GeoPackage, MVT, GeoTIFF/COG, and live vector telemetry;
- dataset size affects performance, not whether a layer can appear in 3D.

The problem is that `ol-cesium` (`olcs`) is a **2D↔3D synchronization bridge**, not a complete 3D implementation of every OpenLayers feature. Out of the box it synchronizes:

- raster `TileLayer` / `ImageLayer` sources;
- ordinary `VectorLayer` features with `VectorSource`;
- OpenLayers overlays;
- camera position and some selection state.

It does **not** synchronize or fully support:

- `WebGLTileLayer` — the COG and multispectral raster path;
- `WebGLVectorLayer` — all seven live-telemetry layers;
- `VectorImageLayer`;
- MVT by default — vector tiles are opt-in and explicitly experimental;
- OpenLayers interactions — OLCS pauses them in 3D;
- the app's React popups, screen-space tools, measurement input, buffer handle drag, KNN picking, and export path.

The official examples confirm this. OpenLayers core has **no first-party 3D/Cesium examples**. The official 3D examples are maintained separately under ol-cesium. They show a capable bridge for ordinary raster/vector data, plus 3D Tiles, terrain, picking, and screenshots when those are wired directly into the Cesium scene. They do not show full parity for WebGL layers, vector basemaps, or OL interactions.

Two CesiumJS capabilities added in 2026 change the 3D-side estimate. CesiumJS 1.142+ includes an experimental `MVTDataProvider` that decodes MVT directly into a 3D Tiles vector tileset, with per-feature styling and picking; it does not apply Mapbox GL style JSON, and its style path does not cover labels or sprites. CesiumJS 1.142+ also includes `GeoJsonPrimitive`, a faster path for large GeoJSON that bypasses the entity/DataSource layer. These reduce the MVT-dataset and large-vector risks, but not vector-basemap label/style parity. Separately, CesiumJS has a 2D scene mode; §11 explains why it is not a replacement for OpenLayers.

**Recommendation: build a deliberate dual-renderer architecture.**

- Keep OpenLayers as the complete 2D renderer and the canonical data/tool model.
- Add a CesiumJS 3D runtime that reads the same Zustand stores and writes to the same OL feature sources where tools are involved.
- Put every 3D capability behind an explicit adapter. Native Cesium handles what Cesium does well; OLCS helpers (`FeatureConverter`, camera mapping, screenshot helpers) are reused where they fit; custom adapters cover COG, telemetry, MVT, picking, tools, and export.
- Do not make `OLCesium` the orchestrator of the whole 3D map. Full parity requires control over layer filtering, ordering, picking, and event handling that the orchestrator does not provide. Use it as a reference and a spike, and reuse its proven utilities.

**This is not a 3–5 week feature.** Full parity is roughly **24–36 engineering weeks** for one senior engineer, or **4–6 months for a small team** working in parallel. The largest risks are vector-basemap style parity, COG shader parity, MVT styling and feature identity, and telemetry performance.

**Next step: a 2–3 week spike on the four riskiest adapters** (telemetry, COG, vector basemaps/MVT, and picking/measurement), not a full build.

---

## 1. What the official examples actually show

### 1.1 OpenLayers core

The official OpenLayers examples at <https://openlayers.org/en/latest/examples/> are 2D examples. There is no official 3D or Cesium example in the core OpenLayers example set. OpenLayers itself does not ship a 3D renderer.

### 1.2 ol-cesium

The official 3D examples live at <https://openlayers.org/ol-cesium/examples/> and are maintained in the `openlayers/ol-cesium` repository. The relevant examples and what they prove:

| Example | What it demonstrates | Consequence for Strata |
| --- | --- | --- |
| `main.js` | `OLCesium` over an OL map, `getCesiumScene()`, globe lighting, time | Basic 3D shell works; Cesium scene is accessible |
| `sidebyside.js` | Separate 2D and Cesium targets, both visible | Split-view is possible; 2D interactions stay active |
| `vectors.js` | Ordinary vector sync, `altitudeMode: 'clampToGround'`, `olcs_extruded_height`, `olcs_model` glTF, 3D rectangles | Simple vector styling and ground clamping are supported |
| `mvt.js` | `source.set('olcs_skip', false)`, `olcs_minimumLevel`, explicit extent, simple styles | MVT is opt-in and experimental; style parity is not shown |
| `3dtiles.js` | Terrain provider and `Cesium3DTileset` added directly to the scene | 3D Tiles and terrain bypass OL layer sync |
| `print.js` | `takeScreenshot`, `autoDrawMask`, `computeRectangle`, `setResolutionScale` | Official screenshot/region helpers exist |
| `overlay.js` | Cesium `ScreenSpaceEventHandler` + `scene.globe.pick()`; OL overlay position sync | Overlays need a Cesium-side pick/anchor path |
| `synthvectors.js` | Picking via `picked.primitive.olFeature` | OL feature identity is attached to Cesium primitives |
| `selection.js` | Selection is applied with OL styles on the 2D map | Selection does not automatically become a 3D highlight |
| `tracking.js` | Custom render loop for a moving feature | Moving objects need a custom update loop |
| `exports.js` | `getCamera()` exposes center, distance, heading, tilt, position, altitude | Camera state can be mapped both ways |
| `customProj.js` | `olcs_projection` allows non-3857 sources | Not needed for Strata's 3857 view, but useful for source data |
| `rastersync.js` | Raster layers and layer groups synchronize | Raster basemaps are the easy case |
| `buildings.js` | Extrusion and shadows | Simple 3D building styling is possible via feature properties |
| `groundvectors.js` | Ground-clamped vectors and text | Ground-clamped labels are supported |
| `fillstyle.js` | Style conversion examples | Style support is partial, not a full CSS/Canvas port |

The examples support three conclusions:

1. **The official bridge is real and maintained.** OLCS is the correct place to look for OL/Cesium integration.
2. **The bridge is intentionally partial.** MVT is experimental, interactions are not synchronized, and 3D content is added directly to Cesium.
3. **Full parity is an application architecture problem, not a library toggle.** The app must own the parts OLCS leaves out.

### 1.3 What OLCS does not promise

From the official documentation and source:

- "OpenLayers interactions are not supported in 3d."
- `WebGLTileLayer` / `WebGLVectorLayer` are not synchronized.
- `VectorImageLayer` is not synchronized.
- MVT requires `olcs_skip = false`, an explicit extent, and a minimum level; the provider rasterizes tiles and does not provide full Mapbox/OpenFreeMap style parity. CesiumJS 1.142+ now has a native, experimental `MVTDataProvider`; that is a Cesium path, not an OLCS path. It supports simple styling and picking, but not Mapbox GL style JSON, labels, or sprites.
- OLCS hides the OL root layer group and pauses OL interactions when 3D is enabled.
- Unmanaged Cesium layers, terrain, and 3D Tiles are outside the OL layer lifecycle.

These are capability limits, not defects. They are the reason a full-parity build needs adapters.

---

## 2. What Strata has today

Strata is an OpenLayers 10.11 / React 19 / Tauri 2 application. The map is imperative and centralised in `src/map/mapController.ts`. React owns the panels and state; it does not own scene objects.

| Area | Current implementation | 3D implication |
| --- | --- | --- |
| View projection | EPSG:3857 (`VIEW_CRS`) | Best case for Cesium; no view-projection blocker |
| Data ingest | Most datasets reprojected to 3857 before becoming OL features | Geometry is directly consumable |
| Basemaps | 4 OpenFreeMap vector styles (`ol-mapbox-style` groups) + 5 raster XYZ providers | Raster is native; vector styles need an MVT style adapter or offscreen OL rendering |
| Dataset layers | Mostly `VectorLayer<VectorSource>`; some MVT `VectorTileLayer` | Ordinary vectors fit OLCS; MVT uses Cesium `MVTDataProvider` or a custom adapter |
| Raster analysis | COG loaded as `WebGLTileLayer` with custom shader expressions | Not supported by OLCS; custom Cesium provider needed |
| Live telemetry | 7 `WebGLVectorLayer`s: flights, ships, satellites, fires, earthquakes, routes, tracks | Not supported by OLCS; custom billboard/line adapter needed |
| Measurement | OL `Draw`/`Modify` over a `VectorSource`, Rust geodesic calculations | Tool input must be reimplemented in Cesium; data can stay in OL |
| Analysis overlays | Buffer, KNN, boolean, corridor, profile hover on a vector source | Geometry can be mirrored; pick/drag input must be reimplemented |
| Popups and context menus | React, positioned from OL screen coordinates; no OL `Overlay` instances | Need Cesium world-to-screen anchoring |
| Export | `captureMapAsPng()` and region capture read the OL canvas | Need Cesium screenshot/crop path |
| Timeline | Telemetry replay from the telemetry store | Works if the 3D adapter mirrors the same features |
| 3D Tiles | None today | New `SceneLayer` model required |
| Security | Tauri CSP is currently `null`; `strata://` serves local COG/data | Cesium workers/assets need release-build testing |
| Cesium token | `CESIUM_ION_TOKEN` already injected by `vite.config.ts`; currently unused | Ready for terrain/imagery, but scope and quota must be handled |

The heaviest bundled datasets matter for 3D performance, not compatibility:

- 36,466 named military areas, shipped as label points;
- 4,351 OSM datacenter footprints;
- 4,589 admin-1 polygons;
- 3,235 US counties.

OLCS or a custom converter turns vector features into Cesium primitives. That is not free: the 2D source remains in memory, and the 3D counterpart adds billboards, labels, polylines, or polygons. Large label layers need a 3D display policy.

### 2.1 What "full parity" includes

The current app does **not** have general dataset drawing or feature editing. Its interactive tools are measurement, buffer picking, KNN picking, elevation-profile hover, and analysis overlays. That is the parity target. If general feature editing is added later, the 3D adapter must be extended, but it is not part of today's scope.

Parity surface:

- **Basemaps:** all 9 (4 vector styles + 5 raster).
- **Datasets:** GeoJSON, CSV, WKT, sample, shapefile, GeoPackage, and MVT.
- **Raster:** COG, multispectral formulas, elevation color ramps, opacity, contrast, pixel probe.
- **Telemetry:** flights, vessels, satellites, fires, earthquakes, vessel routes, ground tracks, replay.
- **Tools:** measure distance/area, buffer center pick and radius drag, KNN center pick, elevation-profile hover, boolean/join results, camera/bookmarks/search/fit, timeline.
- **Overlays:** feature popup, hover card, measurement context menu, analysis labels.
- **Export:** full map PNG, region snip, clipboard copy.
- **Attribution:** effective basemap, terrain, 3D Tiles, and data credits.
- **3D content:** 3D Tiles, terrain, glTF models, and scene layers are new 3D-only capabilities, not existing OL layers.

### 2.2 Dataset compatibility verdict

| Question | Answer |
| --- | --- |
| Is dataset size the blocker? | No. Size changes performance and LOD policy, not basic compatibility. |
| Is dataset CRS the blocker? | No. The view is 3857 and data is reprojected into it. |
| Is dataset format the blocker? | No. MVT and COG need format-specific adapters, not different data. Cesium 1.142+ has an experimental MVT path; COG still needs a custom provider. |
| Is missing Z/altitude a blocker? | No. 3D can clamp to ground. True height/altitude enrichment is a data-quality upgrade, not a rendering blocker. |
| Are 3D Tiles a dataset issue? | No. They are a new 3D content type with no OL equivalent. They need a `SceneLayer` model. |
| Is there a version-compatibility risk? | Yes, separately. `ol@10.11.0`, `cesium@1.146.0`, and `olcs@2.23.1` are newer than the combination OLCS tests, so the spike must prove the build. This is not the fundamental blocker. |

**The missing capabilities are caused by the layer/interaction architecture, not by the data.**

---

## 3. Capability matrix

This is the full parity map. "OLCS native" means the stock synchronizer can render it without a custom adapter. "Adapter" means Strata must implement the 3D path.

| Surface | 2D implementation | 3D implementation | OLCS native? | Risk |
| --- | --- | --- | --- | --- |
| Raster basemaps (Google, Esri, Maxar, hybrid, OSM) | `TileLayer` + `XYZ` | Cesium `UrlTemplateImageryProvider` or a small multi-URL wrapper | Yes | Low |
| Vector basemaps (Positron, Atlas, Bright, Midnight) | `ol-mapbox-style` `LayerGroup` of MVT layers | MVT imagery adapter or offscreen OL tile renderer; visual parity test | Experimental only | High |
| Ordinary vector datasets (GeoJSON, CSV, WKT, sample, shapefile, GeoPackage) | `VectorLayer` + `VectorSource` | `FeatureConverter` primitives; label LOD; selection overlay | Yes | Medium |
| MVT dataset layers | `VectorTileLayer` + `MVT` | Cesium `MVTDataProvider` (experimental) -> vector 3D Tiles; simple style + picking; labels need a separate path | No (Cesium native path) | Medium-High |
| COG / multispectral / DEM | `WebGLTileLayer` + `GeoTIFF` + shader expressions | Custom `CogImageryProvider` (geotiff.js + formula shader), or offscreen OL renderer | No | High |
| Traffic flow | `TileLayer` + `XYZ` | Same imagery-provider path as raster | Yes | Low |
| Live telemetry (7 layers) | `WebGLVectorLayer` | `BillboardCollection` + `LabelCollection` + `PolylineCollection`, updated in place | No | High |
| Measure sketches | `VectorLayer` + `Draw`/`Modify` | Cesium measure controller writes the same OL source; the source is mirrored to Cesium | Geometry yes, input no | Medium |
| Buffer/KNN/boolean/profile overlays | `VectorLayer` analysis source | Mirror the analysis source; buffer handle becomes a Cesium point with drag | Geometry yes, input no | Medium |
| Graticule | `VectorLayer` | Mirror; review line density in 3D | Yes | Low |
| User location | `VectorLayer` | Mirror point/accuracy circle | Yes | Low |
| Select / hover / feature panel | `forEachFeatureAtPixel` | `scene.pick` / `drillPick`; map `picked.olFeature` or a custom feature id to the same stores | No | Medium |
| Popups / hover cards / context menus | React + OL screen coordinates | Cesium world-to-screen in `postRender`; same React components | No | Medium |
| Camera, zoom, fit, bookmarks, reset north | OL `View` | OLCS camera helper or custom mapping; `scene.camera.flyTo`; rectangle fit | Camera yes | Medium |
| Screenshot / region / clipboard | OL canvas | `takeScreenshot` / `computeRectangle`; async capture path | Helpers yes | Low |
| Attribution | Selected basemap definitions | Effective basemap + terrain + 3D Tiles credits; React credit surface | Partial | Medium |
| 3D Tiles / terrain / glTF models | None | Native Cesium scene layers; new `SceneLayer` model | Native Cesium | Medium |
| Timeline / replay | Telemetry store | Same features mirrored; no new domain state | N/A | Low |
| Offline / Tauri release | Local COG via `strata://` | Cesium assets, workers, terrain, 3D Tiles packaging and CSP | N/A | High |

---

## 4. Recommended architecture

### 4.1 Decision

**Use a shared domain model with two renderers: OpenLayers for 2D, CesiumJS for 3D.**

Do not use `OLCesium` as the top-level orchestrator. Use the CesiumJS scene directly, and reuse OLCS's proven utilities where they save work:

- `FeatureConverter` for ordinary OL vector features;
- `OLCSCamera` or its camera math for 2D↔3D view mapping;
- `takeScreenshot`, `computeRectangle`, and `autoDrawMask` for export.

Why not the orchestrator:

- it hides the OL map and pauses OL interactions, which is the opposite of a shared control model;
- it filters layers by type, so it cannot represent COG, telemetry, or MVT without workarounds;
- it owns the render loop and layer lifecycle, which makes custom ordering and picking harder;
- full parity requires custom adapters for most of the distinctive layers anyway.

This is still an OpenLayers-first architecture. OpenLayers remains the 2D map, the data model, the interaction reference, and the place where measurement/analysis features are stored. Cesium is an additional renderer over the same state.

### 4.2 Runtime shape

```text
React panels / ribbons / status bar
                │
        Zustand stores (project, map, ui, telemetry)
                │
        MapFacade (mapController public API)
                │
     ┌──────────┴───────────┐
     │                      │
OpenLayers 2D backend   Cesium 3D backend
     │                      │
OL layers/interactions   SceneRuntime
                            ├─ CameraAdapter
                            ├─ LayerRegistry
                            │   ├─ native Cesium adapters
                            │   ├─ OLCS FeatureConverter adapters
                            │   └─ custom MVT / COG / telemetry adapters
                            ├─ InteractionAdapters (pick, hover, measure, buffer, KNN)
                            ├─ OverlayAdapter
                            ├─ ExportAdapter
                            └─ AttributionAdapter
```

Rules:

1. **One source of truth.** Project data, selection, camera intent, measure state, telemetry, and UI state stay in the existing stores.
2. **Adapters are projections.** A 3D adapter reads store state and renders it; it does not own a second copy of the project.
3. **Tools write to the same OL sources.** A 3D measurement click creates or updates a feature in the existing `measureSource`. The 3D renderer mirrors that source. This preserves `measureGeodesic`, measurement summaries, context menus, and panel logic.
4. **No scattered `if (is3D)` checks.** Add a `MapFacade`/`SceneBackend` boundary so components call the same API in both modes.
5. **Attach only in 3D.** Build 3D primitives when 3D is enabled, sync while active, and detach on return to 2D. Do not double-update telemetry or raster caches in 2D.

### 4.3 State additions

```ts
// UI state, not persisted with the project
type ViewMode = "2d" | "3d";

interface UiState {
  viewMode: ViewMode;
  // existing fields...
}

// 3D-only camera readout; keep CameraState for 2D
interface SceneCameraState {
  lon: number;
  lat: number;
  altitude: number;
  heading: number;
  pitch: number;
}
```

Bookmarks keep the existing 2D fields and gain an optional 3D pose:

```ts
interface Bookmark {
  id: string;
  title: string;
  lon: number;
  lat: number;
  zoom: number;
  scene?: {
    altitude: number;
    heading: number;
    pitch: number;
  };
}
```

A bookmark created in 2D opens in 3D as a top-down view at the same center and an equivalent distance. A bookmark created in 3D opens in 2D at the same center and an equivalent zoom. Neither mode loses the bookmark.

3D-only content uses a separate model:

```ts
type SceneLayer = {
  id: string;
  name: string;
  kind: "3d-tiles" | "terrain" | "model" | "czml";
  url?: string;
  ionAssetId?: number;
  visible: boolean;
  opacity?: number;
  maximumScreenSpaceError?: number;
  heightOffset?: number;
};
```

`SceneLayer` is not forced into `DatasetLayer`. 3D Tiles are not vector features and should not be smuggled through the OL vector model.

### 4.4 Proposed module layout

```text
src/map/scene/
  sceneRuntime.ts          // Cesium scene, render loop, lifecycle
  sceneBackend.ts          // MapFacade backend interface
  cameraAdapter.ts         // 2D↔3D camera, fit, bookmarks
  pickAdapter.ts           // scene.pick/drillPick, feature identity
  overlayAdapter.ts        // world→screen anchoring for React popups
  exportAdapter.ts         // screenshot, region crop, clipboard
  attributionAdapter.ts    // effective credits in 3D
  layers/
    rasterBasemap.ts
    vectorBasemap.ts
    vectorDataset.ts
    mvtDataset.ts
    cogRaster.ts
    telemetry.ts
    analysis.ts
    measure.ts
    graticule.ts
    traffic.ts
    userLocation.ts
    sceneLayer.ts
  interactions/
    select.ts
    hover.ts
    measure.ts
    buffer.ts
    knn.ts
    profile.ts
```

This is a target layout, not a requirement to create every file on day one.

### 4.5 Adapter contract

```ts
interface SceneAdapter {
  readonly id: string;
  attach(ctx: SceneContext): Promise<void>;
  sync(snapshot: SceneSnapshot): void;
  detach(): void;
  destroy(): void;
  pick?(pixel: Cesium.Cartesian2): ScenePick | null;
}
```

`SceneContext` exposes the Cesium namespace, scene, camera, render request function, OL map, and the stores. `SceneSnapshot` is a derived view of the current project/UI/telemetry state. The runtime diffs snapshots and calls each adapter's `sync`.

Adapter classes:

- **Native Cesium adapters** for raster basemaps, traffic, terrain, 3D Tiles, models.
- **OLCS-helper adapters** for ordinary vector datasets, using `FeatureConverter` to create primitives and attach `olFeature`/`olLayer` for picking.
- **Custom adapters** for MVT, COG, telemetry, selection highlights, measurement, and analysis.
- **Hybrid offscreen OL adapter** as a fallback when exact OL visual parity is required for a layer that Cesium cannot reproduce natively.

---

## 5. Layer-by-layer implementation

### 5.1 Raster basemaps and traffic

Use Cesium `UrlTemplateImageryProvider` for the five raster basemaps and the traffic layer. The URLs are already XYZ templates. For providers with multiple hosts, either:

- use `{s}` with a subdomain list, or
- implement a small `MultiUrlImageryProvider` that chooses a host per tile.

Set `maximumLevel` from `BasemapDefinition.maxZoom`, add credits from the same attribution definitions, and place the basemap at the bottom of `scene.imageryLayers`. When the basemap changes, remove the old imagery layer and add the new one. This is the lowest-risk part of the build.

### 5.2 Ordinary vector datasets

Reuse `FeatureConverter` (from `olcs`) or port its vector conversion into the 3D adapter. It supports:

- points, lines, polygons, multi-geometries;
- icon and text styles;
- `altitudeMode: 'clampToGround'`;
- `olcs_extruded_height`;
- `olcs_model` for per-feature glTF;
- `olcs_polygon_kind: 'rectangle'`.

The adapter should attach `olFeature` and `olLayer` to the created primitives so `scene.pick` can return the original feature. That is the same pattern as the official `synthvectors` example.

Do not mirror every label. Add a 3D label policy:

- show labels only above a camera-distance or zoom threshold;
- cap labels per frame or per tile;
- hide labels for the 36k military layer at global/regional scales;
- keep the geometry visible even when labels are suppressed.

Opacity and z-order need explicit handling. `VectorSynchronizer` handles visibility but not full opacity/z-order. The adapter should own the primitive collection and order it by the same dataset order used by `mapController` (`DATA_Z_BASE + index * 10`). If OLCS's synchronizer does not expose enough control, use a thin custom synchronizer around `FeatureConverter`.

### 5.3 Vector basemaps and MVT datasets

This is the hardest layer family, but the dataset case improved in CesiumJS 1.142. There are four viable strategies.

**A. OLCS `MVTImageryProvider` (official, experimental)**

Set `olcs_skip = false`, `olcs_minimumLevel`, and an explicit extent, as the official `mvt.js` does. The provider renders MVT tiles to canvases using the OL style function and drapes them as imagery.

- Pros: reuses OL styles, relatively little code, official pattern.
- Cons: rasterized output, possible label duplication/seams, sprite/font limitations, no feature picking, style parity not guaranteed.
- Use for: basemaps first; MVT datasets only if picking can be added separately.

**B. Offscreen OL tile renderer**

Render each Cesium tile request through a hidden OL map containing only the target layer, then return the canvas as an image. This uses the exact OL renderer and style, so visual parity is the best of the four.

- Pros: exact OL styling, works for MVT and COG, no style reimplementation.
- Cons: per-tile render/readback cost, async queueing, label clipping at tile edges, high memory, and OL WebGL canvas readback constraints.
- Use for: a parity reference, or as a fallback for basemaps/COG if native adapters do not meet the visual bar.

**C. Custom Cesium MVT vector renderer**

Parse MVT tiles, convert features to Cesium primitives, and implement styling, labels, sprites, and picking directly.

- Pros: best performance and interaction quality; real feature picking and highlighting.
- Cons: the most work; must reproduce enough of the Mapbox style spec; text and sprite handling are substantial.
- Use for: basemaps only if A/B/D cannot deliver label/sprite parity and the product requires it.

**D. Cesium `MVTDataProvider` (native, experimental, 1.142+)**

`MVTDataProvider.fromUrl(tileUrl, { minZoom, maxZoom, extent, featureIdProperty })` decodes MVT tiles into a Cesium 3D Tiles vector tileset. It supports:

- per-feature `Cesium3DTileStyle` for color, show, point size/outline, and line width;
- picking with metadata through `scene.pick` and `getProperty`;
- a stable `featureIdProperty` for cross-tile identity;
- optional terrain/3D Tiles clamping on CesiumJS 1.145+.

Limits:

- it does not apply Mapbox GL style JSON; styles must be recreated with `Cesium3DTileStyle`;
- its MVT style path covers points, lines, and polygons, but not labels or sprites, so it cannot reproduce an OpenFreeMap basemap's text and icons;
- it builds the complete tile hierarchy at initialization; a global extent with a high `maxZoom` can exhaust browser memory, so `extent` and `maxZoom` must be tight;
- the API is experimental and may change.

- Pros: real vector rendering, per-feature styling, and picking without a custom parser; reuses the same MVT tile URL as 2D.
- Cons: prebuilt hierarchy, no style-JSON import, no text/sprite parity, experimental API.
- Use for: MVT datasets with simple styles and picking; possibly the geometry layer of a vector basemap, but not its full label/sprite presentation.

**Recommendation:** use D for MVT datasets that need picking and can accept simple styling. Keep A/B as the visual-parity reference for vector basemaps; use B when exact OL rendering is required, and C only if native label/sprite parity justifies the work. Do not treat D as a drop-in for OpenFreeMap: the missing style JSON, labels, and sprites are the parity gap. If D's picking or identity model proves insufficient, keep D/A for display and maintain a parallel feature index parsed from the same MVT tiles with `ol/format/MVT`; selection can then resolve by lon/lat without building a full custom renderer.

### 5.4 COG, multispectral, and DEM

Cesium has no native GeoTIFF/COG layer. There are two credible paths.

**A. Custom `CogImageryProvider` (recommended)**

Implement a Cesium `ImageryProvider` that:

1. maps Cesium tile coordinates to the COG's extent;
2. reads the required COG tile/overview with `geotiff.js`;
3. applies the same formula as `buildRasterStyle` (NDVI, elevation ramp, contrast, opacity);
4. renders the result to a canvas or texture and returns it as the tile image;
5. caches tiles and invalidates on formula/contrast/opacity change.

This gives the same formula semantics and acceptable performance if the tile cache is well designed. It also supports pixel probing: sample the COG at the picked lon/lat and apply the formula on the CPU, rather than reading back the GPU.

**B. Offscreen OL WebGL tile renderer**

Render the existing `WebGLTileLayer` into 256×256 tiles through a hidden OL map and return the canvas. This guarantees exact shader parity because it is the same OL renderer.

- Pros: no shader port; formula and contrast changes are automatically correct.
- Cons: per-tile WebGL render/readback is expensive; tile queueing is complex; canvas readback may require careful render synchronization.
- Use for: validating A, or as a fallback for a small number of COG layers.

**DEM and terrain are separate concerns.** A colorized elevation COG is an imagery overlay. True terrain requires a Cesium terrain provider (Cesium World Terrain, or local quantized-mesh/heightmap tiles). Do not assume the DEM COG automatically becomes terrain. Decide whether 3D terrain is required and package it accordingly.

### 5.5 Live telemetry

Telemetry is the most important custom adapter. The 2D implementation already caches features and updates them in place at 60 FPS; the 3D adapter should mirror the same feature objects, not create a second telemetry model.

Implementation:

- `Cesium.BillboardCollection` for flights, vessels, satellites, fires, earthquakes, and port markers.
- `Cesium.LabelCollection` for callsigns, vessel names, route labels, and selected/hovered tags.
- `Cesium.PolylineCollection` or `GroundPolylinePrimitive` for ground tracks and vessel routes.
- `billboard.id = { kind: "telemetry", feature }` so `scene.pick` returns the OL feature.
- Update positions, rotation, scale, color, and visibility in place each animation frame, reading the existing feature properties.
- Use `HeightReference.CLAMP_TO_GROUND` for parity, or `RELATIVE_TO_GROUND` with altitude for flights/satellites where altitude is meaningful. Make this a display policy, not a data change.
- Add `DistanceDisplayCondition` and label LOD so 36k labels do not all render at once.
- For very large flight counts, use point primitives at global zoom and switch to billboards/icons at closer zoom. Benchmark before choosing.
- Selection/hover: scale the billboard, add a ring, or change color; keep `telemetryStore` as the source of truth.
- Replay/timeline works automatically because the adapter reads the same replayed features.

Do not use the `WebGLVectorLayer` style functions directly in Cesium. They produce OL styles with SVG icons and labels; the adapter should consume the feature properties and the existing icon registry (`telemetryIcons.ts`) to create billboard images and labels. Reuse the icon builders, not the OL style objects.

### 5.6 Measurement

Keep measurement data in the existing `measureSource`. Implement a Cesium interaction adapter that:

1. captures `LEFT_CLICK` and `MOUSE_MOVE` on the Cesium canvas;
2. picks ground points with `scene.camera.getPickRay()` + `scene.globe.pick()`; use `scene.pickPosition()` for 3D Tiles where appropriate;
3. appends vertices to an OL `Feature` in `measureSource`;
4. calls the existing `measureGeodesic` Rust command for distance/area;
5. updates the existing measurement summary/context-menu stores;
6. mirrors the measure source to Cesium with `FeatureConverter` or a dedicated measure adapter.

This preserves all existing measurement utilities: `measureCoordinates`, `getMeasurementLines`, `summarizeAllMeasurements`, `reverseMeasurement`, `zoomToMeasurement`, `deleteMeasurementFeature`, and the context menu. The 2D and 3D measurements are the same features, so switching modes does not lose them.

Distance and area should be labeled as geodesic/ellipsoidal. If terrain-following surface distance is required, add terrain sampling as a separate feature; do not silently change the metric.

### 5.7 Analysis tools: buffer, KNN, boolean, profile

These tools already write results to the analysis vector source. The 3D adapter mirrors that source.

- **Buffer center pick:** `setBufferPicker` receives lon/lat; the 3D click handler calls it with the Cesium ground pick.
- **Buffer radius drag:** render the buffer handle as a Cesium point/billboard; on drag, compute the geodesic distance from the center to the pointer and call `setBufferRadiusDragListener(radius, isFinal)`. Reuse the same geodesic helper.
- **KNN center pick:** uses the same picker path.
- **Boolean/join results:** `renderBooleanOverlay` writes polygons to the analysis source; the adapter mirrors them.
- **Elevation profile hover:** `setProfileHoverCoord` adds a point to the analysis source; the adapter mirrors it and positions the profile marker in 3D.
- **Corridor/spine labels:** if the analysis style includes text, verify `FeatureConverter` text support; otherwise use a dedicated label collection.

### 5.8 Selection, hover, popups, and context menus

**Picking.** Build one `PickAdapter` with a single `ScreenSpaceEventHandler` per scene. It should:

1. call `scene.pick(pixel)` and, where needed, `scene.drillPick(pixel)`;
2. if the picked primitive has `olFeature`/`olLayer`, return that OL feature;
3. if the picked object has a custom `id` payload, return the adapter's feature reference;
4. if it is a `Cesium3DTileFeature`, return its metadata;
5. if the layer is rasterized MVT/COG, query the adapter's feature index by lon/lat.

**Selection.** Keep `projectStore.selection` and `telemetryStore.selectedTarget` as the only selection state. Add a `SelectionAdapter` that draws a highlight on top of the selected feature in Cesium. This avoids relying on OLCS to restyle a synchronized primitive.

**Hover.** Throttle `MOUSE_MOVE` with `requestAnimationFrame`; update the existing hover store and tooltip. Suppress hover while the camera is moving if it causes jitter.

**Popups and context menus.** The app does not use OL `Overlay`; it positions React elements from screen coordinates. Add a `worldToScreen` helper:

- convert lon/lat to `Cartesian3` at the terrain/ellipsoid height plus an offset;
- use `Cesium.SceneTransforms.worldToWindowCoordinates` (or the version-appropriate equivalent);
- hide the popup if the point is behind the globe;
- update on `scene.postRender` so the popup follows the camera.

The existing React components stay; only the coordinate source changes.

### 5.9 Camera, bookmarks, fit, and status

Add a `CameraAdapter` that maps between OL `View` and Cesium `Camera`:

- 2D→3D: center lon/lat, resolution/zoom, rotation → `destination`, `heading`, `pitch = -90°`;
- 3D→2D: camera ground center, distance → equivalent zoom/resolution, heading → rotation;
- `flyToCoordinate` → `camera.flyTo`;
- `zoomBy` → camera distance change;
- `resetNorth` → heading 0, preserve pitch;
- `fitToData` / `zoomToLayer` / `zoomToSelection` → bounding sphere or `Rectangle` fit, with padding;
- `screenPositionFor` → world-to-screen;
- `getViewportBbox` → `camera.computeViewRectangle()` or four-corner ground picks.

Do not overload the 2D `CameraState` with 3D-only fields. Use `SceneCameraState` for the status bar and a separate 3D status readout (lon, lat, altitude, heading, pitch).

### 5.10 Screenshot, region capture, and attribution

Use OLCS's `takeScreenshot(scene, options)`; it renders on demand and reads the buffer in `postRender`, so `preserveDrawingBuffer` is not required. For region capture, use `computeRectangle`/`autoDrawMask` or crop the scene canvas with the requested screen rectangle.

`captureMapAsPng()` is currently synchronous. The 3D path is asynchronous. Add `captureSceneAsPng(): Promise<string | null>` and update the callers to await it, or keep a synchronous 2D path and a separate 3D command. Do not silently return a blank image.

Attribution must use the **effective** 3D sources:

- the active raster basemap;
- terrain provider;
- every 3D Tiles/model source;
- data providers already credited by the app.

The existing `MapAttribution` component can render a 3D credit list. Verify whether Cesium's own credit display is visible and whether OLCS carries credits; if not, add a React credit surface. Treat attribution as a release gate.

### 5.11 3D Tiles, terrain, and models

Add a `SceneLayer` registry independent of the OL layer tree:

- `Cesium3DTileset.fromUrl(url, { maximumScreenSpaceError })`;
- `scene.primitives.add(tileset)`;
- `CesiumTerrainProvider.fromUrl(...)` or `Cesium.Terrain.fromWorldTerrain(...)`;
- `Cesium.Model.fromGltf` or an entity with a model graphic;
- CZML via `CzmlDataSource`.

Picking a `Cesium3DTileFeature` yields metadata directly. Show it in a 3D-specific feature panel, or adapt it to the existing feature panel with a generic property list. Do not route it through OL feature selection.

OLCS also supports per-feature `olcs_model` and `olcs_extruded_height`; these are useful for simple buildings and markers, but they are not a substitute for a real 3D Tiles layer model.

### 5.12 Performance and rendering policy

- **Render loop:** use `scene.requestRenderMode = true` and request a render on state changes; avoid a permanent 60 FPS loop when idle. Telemetry and camera motion explicitly request renders.
- **Labels:** distance/zoom gating, per-frame caps, and no labels for the 36k military layer at wide views.
- **Telemetry:** billboard/point LOD, viewport culling, in-place updates, and a benchmark at realistic counts.
- **Vector primitives:** batch where possible; avoid one entity per feature; keep the 2D source and 3D primitive collection in sync without rebuilding every frame.
- **GPU memory:** both engines retain resources. Measure the combined footprint; consider pausing OL rendering while 3D is active, but do not destroy the OL map.
- **Z-order:** basemaps as imagery layers; vectors and analysis as primitives; 3D Tiles with depth testing; billboards with `disableDepthTestDistance` where they must remain visible. Define ordering explicitly; Cesium has no single global z-index.
- **Target hardware:** state a minimum GPU/memory target. The 36k-label layer and terrain/3D Tiles are the stress cases.

### 5.13 Packaging and Tauri

- Copy Cesium's `Assets/`, `Widgets/`, `Workers/`, and `ThirdParty/` into a public `cesium/` directory at build time.
- Set `window.CESIUM_BASE_URL` relative to `document.baseURI`, not a hard-coded `/cesium`, so Tauri's custom origin and sub-path deployments work.
- Test a **release** Tauri build on each target OS. Workers, wasm MIME types, and custom-protocol loading are the likely failure points.
- The current `csp: null` avoids an immediate blocker. If the CSP is tightened, Cesium will need `worker-src blob:`, `img-src data: blob:`, and appropriate `connect-src` entries for Ion/imagery/terrain/3D Tiles. Assess `wasm-unsafe-eval` carefully rather than blanket-allowing it.
- The Ion token is embedded in the frontend by design. Restrict it to the required assets/origins, set quotas, and treat it as publicly visible.
- Offline 3D is a separate packaging problem. Cesium World Terrain requires network/Ion. If offline 3D is required, plan local terrain and imagery/3D Tiles, or ship the ellipsoid fallback.

---

## 6. The hard parts, ranked

| Rank | Problem | Why it is hard | Recommended path |
| --- | --- | --- | --- |
| 1 | Vector basemap style parity | OpenFreeMap styles rely on Mapbox style expressions, sprites, fonts, and labels; OLCS rasterizes only a subset | Spike `MVTImageryProvider`; fall back to offscreen OL tile rendering or a custom MVT renderer |
| 2 | COG shader parity and performance | Cesium has no COG layer; formulas run in OL's WebGL style system | Custom `CogImageryProvider` with geotiff.js + shader; offscreen OL renderer as reference/fallback |
| 3 | MVT styling and feature identity | `MVTDataProvider` renders vectors and picks features, but Mapbox style JSON, labels, sprites, and cross-tile identity still need work | `MVTDataProvider` for datasets; style translation and a label layer only if basemap parity requires it; `featureIdProperty` plus a tile cache |
| 4 | Telemetry at scale | 7 dynamic layers, SVG icons, labels, tracks, 60 FPS updates, replay | Billboard/label/polyline collections with in-place updates and LOD; benchmark 1k–10k targets |
| 5 | Interaction parity | OLCS pauses OL interactions; all picking/drag/measurement must be Cesium-native | One `ScreenSpaceEventHandler`, shared stores, tools write to the same OL sources |
| 6 | Z-order and picking across adapters | Imagery layers, ground primitives, billboards, 3D Tiles, and OLCS primitives coexist | Central layer registry, explicit ordering, unified pick adapter, integration tests |
| 7 | Camera round-trip and bookmarks | 2D zoom/resolution and 3D distance/pitch are not one-to-one | Camera adapter with a documented mapping; store optional 3D pose in bookmarks |
| 8 | Export and attribution | 3D capture is async; credits come from more sources | `takeScreenshot`, async API, effective-source attribution |
| 9 | Tauri release packaging | Workers/assets/custom protocol/CSP | Release-build test early; relative `CESIUM_BASE_URL` |
| 10 | Version compatibility | OL 10.11 / Cesium 1.146 / olcs 2.23.1 are newer than OLCS's tested set | Spike exact versions; direct Cesium reduces the OLCS surface; pin versions |

---

## 7. Delivery plan

### Phase 0 — Technical spike (2–3 weeks)

Purpose: prove the four riskiest adapters and the exact version combination. Do this on a throwaway branch; do not merge experimental adapters into the main controller.

1. Install `cesium@1.146.0` and `olcs@2.23.1`; add the Cesium asset copy step.
2. Lazy-load Cesium, create a bare `Cesium.Scene`/`CesiumWidget`, and toggle it from a temporary button.
3. Verify `CESIUM_BASE_URL`, workers, and assets in `vite dev` and a Tauri release build.
4. Render one raster basemap and one ordinary vector dataset.
5. Prototype a telemetry adapter with 1,000–5,000 billboards and labels; measure FPS and memory.
6. Prototype a COG adapter for one band/formula; compare against the 2D shader output.
7. Test `MVTDataProvider` on one MVT dataset with a tight extent/maxZoom; measure initialization memory, styling, and picking. Then test `MVTImageryProvider` on one OpenFreeMap style; record visual differences (labels, sprites, seams).
8. Implement one pick/hover path and one distance measurement; confirm they update the existing stores.
9. Test screenshot/region capture with `takeScreenshot`.

**Spike gates:**

| Gate | Pass condition |
| --- | --- |
| Build | Exact OL/Cesium/OLCS versions build and run without console/WebGL errors |
| Packaging | Tauri release build serves Cesium assets/workers correctly |
| Telemetry | 1k–5k billboards at ≥30 FPS on target hardware with labels capped |
| COG | One formula renders with acceptable visual parity and latency |
| Vector basemap | One style renders; differences are documented and judged acceptable or fixable |
| Picking/measure | A click selects the correct feature and a measurement updates the existing store |
| Export | Screenshot and region crop work in 3D |

If the build, packaging, or COG gates fail, do not proceed to a full build; re-scope or choose a different renderer.

### Phase 1 — Runtime foundation (2–3 weeks)

- Add `viewMode` to `uiStore`.
- Add `SceneRuntime`, `SceneBackend`, `MapFacade` delegation, and lifecycle cleanup.
- Add camera adapter, `SceneCameraState`, bookmark 3D pose, and status bar.
- Add Cesium asset packaging and Tauri release pipeline.
- Add attribution skeleton and screenshot/export adapter.
- Add a feature flag so 3D can be disabled per build.

### Phase 2 — Layer parity (8–12 weeks)

- Raster basemaps and traffic.
- Ordinary vector datasets with label LOD, opacity, z-order, and picking.
- Vector basemaps/MVT adapter and visual parity pass.
- MVT dataset adapter via `MVTDataProvider` with simple style, feature ID, and selection highlight.
- COG adapter with formulas, contrast, opacity, pixel probe, and cache invalidation.
- Telemetry adapter for all seven layers, including routes, tracks, icons, labels, replay, and selection/hover.
- Analysis, graticule, user location.
- SceneLayer model for 3D Tiles/terrain/models.

### Phase 3 — Tool and interaction parity (6–9 weeks)

- Unified pick/hover/select adapter and feature panel routing.
- Measurement input, live labels, context menu, reverse/delete/zoom-to.
- Buffer center pick, radius drag, corridor/spine overlays.
- KNN center pick and result overlay.
- Elevation-profile hover marker.
- Boolean/join result overlays.
- Popups, hover cards, and context menus in 3D.
- Timeline/replay verification.
- Camera fit/zoom/bookmarks/search parity.

### Phase 4 — 3D content and export (3–5 weeks)

- 3D Tiles loading, styling, picking, and persistence.
- Terrain provider and offline/online behavior.
- glTF/CZML models.
- Screenshot, region snip, clipboard, and attribution.
- 3D layer panel and scene-layer lifecycle.

### Phase 5 — Hardening (3–4 weeks)

- Performance tuning at representative datasets and telemetry counts.
- Memory profiling with both engines alive.
- Tauri release testing on each target OS.
- Offline/air-gapped behavior.
- Accessibility, keyboard shortcuts, and tool discoverability in 3D.
- Regression tests for camera round-trip, picking, measurement, and layer parity.

### Effort estimate

| Work | Estimate |
| --- | --- |
| Spike | 2–3 weeks |
| Runtime foundation | 2–3 weeks |
| Layer parity | 8–12 weeks |
| Tool/interaction parity | 6–9 weeks |
| 3D content and export | 3–5 weeks |
| Hardening and release | 3–4 weeks |
| **Total** | **24–36 engineering weeks** |

That is roughly **6–9 months for one senior engineer**, or **4–6 months for a small team** with parallel layer/tool work. The estimate excludes content production (3D Tiles, models, terrain datasets), design work, and a general dataset-editing feature that does not exist today.

---

## 8. Risks and decision gates

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Vector basemap style parity is not achievable with MVT imagery | High | High | Spike early; keep offscreen OL renderer and custom MVT renderer as fallbacks |
| COG shader parity/performance is poor | High | High | Custom imagery provider with cache; benchmark before committing; offscreen OL fallback |
| MVT dataset styling/picking is insufficient | Medium | High | `MVTDataProvider` with `featureIdProperty`; custom style translation; fall back to parsed feature index or custom renderer |
| Telemetry performance collapses at high counts | Medium | High | Billboard/point LOD; label caps; viewport culling; benchmark 1k–10k |
| OLCS/Cesium/OL version incompatibility | Medium | High | Exact-version spike; pin; direct Cesium reduces OLCS surface |
| Z-order/picking conflicts between adapters | High | Medium | Central registry, explicit ordering, unified pick adapter, integration tests |
| Interaction parity takes longer than expected | Medium | High | Shared stores and OL sources; one handler; incremental tool rollout |
| Tauri worker/asset failures in release | Medium | High | Release-build test in phase 0; relative base URL; test all OS targets |
| Dual-engine GPU/memory cost | High | Medium | LOD, pause OL rendering, target hardware, memory profiling |
| Offline terrain conflicts with Ion | Medium | High | Decide early; local terrain pipeline or ellipsoid fallback |
| Attribution/credits omitted | Medium | High | Release gate; audit Cesium credits and all 3D sources |
| Ion token leakage/abuse | Medium | Medium | Scoped token, quotas, rotation plan |
| Maintenance burden of custom adapters | Medium | Medium | Adapter boundary, tests, pinned versions, ownership |

**Decision gates:**

1. Exact versions build and run in Tauri release.
2. Telemetry prototype holds usable frame rate at the agreed target count.
3. COG prototype matches the 2D formula visually and meets latency targets.
4. Vector basemap parity is accepted or a fallback path is chosen.
5. Picking/measurement updates the existing stores correctly.
6. 3D export and attribution pass.

---

## 9. Open product decisions

1. **Does "full parity" require pixel-identical vector basemaps, or functional parity?** Pixel parity likely needs an offscreen OL renderer or a custom MVT renderer; functional parity may accept MVT imagery.
2. **Must 3D work offline/air-gapped?** If yes, Cesium World Terrain is not enough; plan local terrain/imagery/3D Tiles.
3. **Is 3D a toggle, a split view, or both?** A split view is useful for comparison and is supported by the official `sidebyside` example. A toggle is simpler for state.
4. **What are the target GPU and maximum telemetry counts?** These determine the billboard/label strategy.
5. **Which 3D Tiles sources and models are in scope?** This is content and licensing work, not only rendering.
6. **Is general dataset editing planned?** Today the app edits measurement/analysis features, not dataset geometry. If dataset editing is added, the 3D interaction scope grows.
7. **Is the Ion token allowed in the web build?** Treat it as public and scope it; do not reuse a privileged token.
8. **Is a true flat/orthographic 3D view required?** If not, Cesium's `SCENE2D` is out of scope; a top-down Cesium camera covers most "flat 3D" needs.

---

## 10. Bottom line for the dual-renderer plan

- **The blocker is not the datasets.** It is the layer/interaction capability of the OL/Cesium bridge.
- **OLCS is the right place to learn the integration, but not the whole answer.** It synchronizes ordinary raster/vector layers and the camera; it does not synchronize COG, telemetry, MVT, or OL interactions.
- **CesiumJS is not a drop-in 2D engine either.** It has a real `SCENE2D` mode, but it is a flattened view of a 3D scene, not a replacement for OpenLayers' layer types, tools, or Web Mercator camera semantics.
- **Full parity requires a dual-renderer architecture:** shared stores and OL feature sources, OpenLayers for 2D, CesiumJS for 3D, and explicit adapters for every unsupported layer and interaction.
- **The recommended target is a Cesium-native runtime with selective OLCS helpers**, not `OLCesium` as the orchestrator.
- **The work is a multi-month program**, roughly 24–36 engineering weeks, with the vector basemap, COG, MVT styling/identity, and telemetry adapters as the main risks.
- **Start with a 2–3 week spike**, not a full implementation. If the spike clears the gates, build in phases. If it does not, re-scope 3D explicitly rather than shipping a bridge that silently drops layers.
- **Cesium can render 2D, but that is not a shortcut.** §11 covers `SCENE2D`'s limits and the shared-data/separate-renderer pattern used by ArcGIS, MapStore, QGIS, Google, and MapLibre.

---

## 11. Can Cesium render 2D? What competitors do

### 11.1 Yes, Cesium has a 2D mode — with material limits

CesiumJS exposes `SceneMode.SCENE2D` (top-down, orthographic) and `SceneMode.COLUMBUS_VIEW` (2.5D). The same `Scene`, camera, imagery layers, and most primitive types work across modes. A 2D scene can be constructed with `WebMercatorProjection` when EPSG:3857 alignment is required.

What works:

- raster imagery, billboards, labels, points, polylines, polygons, and most 2D primitives;
- Cesium camera and picking APIs;
- 3D Tiles can render flattened; set `projectTo2D: true` for accurate projection, at a memory cost;
- `MVTDataProvider` is a 3D Tiles provider, so it is a candidate in 2D, but this needs testing.

What is different or missing:

- **Terrain is 3D-only.** `sampleHeight`, `clampToHeight`, and their detailed variants throw outside 3D mode; 2D is effectively a flat map.
- **The camera is not an OpenLayers camera.** `SCENE2D` is orthographic; Web Mercator zoom levels, resolution, scale, rotation, and 2D↔3D round-tripping are not OL semantics.
- **The projection is fixed at construction.** The default 2D projection is geographic; `WebMercatorProjection` must be chosen when the scene is created. Changing it means recreating the scene.
- **3D content is flattened.** 3D Tiles can appear, but they are not true 3D; without `projectTo2D` their projected positions can be inaccurate.
- **OL's layer types do not exist.** `WebGLTileLayer` (COG), `WebGLVectorLayer` (telemetry), `VectorImageLayer`, `ol-mapbox-style` vector basemaps, and OL interactions (`Draw`, `Modify`, `forEachFeatureAtPixel`) all need Cesium equivalents.
- **Styling, labels, sprites, and picking are a port, not a toggle.** Cesium's text and billboard pipeline differs from OL, and Cesium is optimized for 3D scenes rather than dense 2D vector editing.

**Conclusion:** Cesium can render a 2D map, but it cannot replace Strata's 2D stack without reimplementing that stack. Using Cesium for both modes is a platform rewrite, not a shortcut.

### 11.2 What competitors actually do

| Product | 2D renderer | 3D renderer | How they handle the split | Lesson for Strata |
| --- | --- | --- | --- | --- |
| **ArcGIS Maps SDK for JavaScript** | `MapView` | `SceneView` | One `Map` data object, two views. The official switch sample overlaps both views or reassigns a container, copies the viewpoint, applies a `cos(latitude)` scale correction for Web Mercator, removes or replaces 3D-only layers in 2D, and notes that 3D symbols do not work in `MapView`. | Closest blueprint: shared data model, separate views, explicit capability differences. ArcGIS does not render its 2D `MapView` through `SceneView`. |
| **MapStore** | OpenLayers or Leaflet | CesiumJS | One map configuration with `visualizationMode: "2D" \| "3D"` and separate viewer URLs. 3D Tiles, terrain, and model layers exist only in the Cesium viewer; COG was added to the 3D viewer in 2026.01. | Shared application model and plugin surface, separate rendering engines, layer capabilities declared per mode. This is the closest open-source analogue. |
| **QGIS** | 2D map canvas | Separate 3D map view | 3D is a companion view with its own camera and rendering stack; 3D Tiles is a distinct layer type. | A separate 3D view is normal in desktop GIS. 2D and 3D do not need to be the same renderer. |
| **Mapbox GL JS / MapLibre GL JS** | GL JS | Same GL JS (globe, terrain) | One engine because the renderer owns the vector/raster pipeline end to end. COG comes from the `maplibre-cog-protocol` plugin, and 3D Tiles from custom three.js layers; neither is a full OL-style GIS. | Single-engine parity works when you own the renderer. It is not a drop-in path for OpenLayers + COG + 3D Tiles. |
| **Google Maps JavaScript API** | `Map` | `Map3DElement` | Separate 2D and 3D map APIs/elements, with separate camera and rendering models. | Even a platform vendor with a full stack separates 2D and 3D products. |
| **CesiumJS itself** | `SCENE2D` | `SCENE3D` | The same scene API can morph between 2D, 2.5D, and 3D. | The 2D mode exists, but GIS vendors still use a dedicated 2D engine for 2D editing and styling. |

The pattern is consistent: **shared data and state, separate renderers, explicit per-mode capabilities.** The products that use one engine either own the entire rendering stack (Mapbox/MapLibre) or accept a narrower 3D product (Cesium-only viewers).

### 11.3 Recommendation for Strata

1. **Keep OpenLayers as the 2D engine.** It is already the stronger 2D renderer for MVT, COG, WebGL telemetry, and OL interactions.
2. **Use CesiumJS as the 3D engine.** Do not add Cesium `SCENE2D` as a third product mode on the critical path.
3. **If a flat view is needed, prefer a top-down Cesium camera in `SCENE3D`.** It preserves terrain, 3D Tiles, and 3D picking while looking flat. Use `SCENE2D` only if true orthographic projection is a hard requirement.
4. **If true orthographic 2D is required, run a separate 1–2 day spike.** Construct a scene with `WebMercatorProjection`, set `SCENE2D`, add one raster layer, one GeoJSON layer, one `MVTDataProvider`, and one flattened 3D Tileset with `projectTo2D`. Test pan/zoom, picking, labels, and screenshot against the OL output. Keep it off the main branch until it clears the same gates as the 3D adapters.
5. **Do not use Cesium 2D to avoid building the 3D adapters.** It does not solve COG, telemetry, OL tools, popups, or export; it moves those problems into a second Cesium stack.

### 11.4 “Some features in 2D, some in 3D” is fine — if it is explicit

There are three legitimate categories:

- **Shared features.** Every existing 2D capability in the parity surface — basemaps, datasets, COG, telemetry, measure, buffer, KNN, profile, selection, popups, timeline, export, attribution — must work in 3D. This is the parity contract.
- **3D-native features.** Terrain, 3D Tiles, glTF models, CZML, lighting, sky, and scene effects have no true 2D equivalent. In 2D, show a footprint/bounding box, a static preview, or a disabled control with a reason. Do not fake them as flat OL layers.
- **2D-native features.** If Strata later adds print layouts, advanced 2D editing, or other workflows that only make sense on a plane, they can be 2D-only. They must be labelled as such and not counted as 3D parity gaps.

Encode this in a capability registry rather than scattered checks:

```ts
type ViewMode = "2d" | "3d";

interface RenderCapability {
  modes: ViewMode[];
  pick: boolean;
  styleParity: "native" | "approximate" | "rasterized";
  fallback?: {
    mode: ViewMode;
    behavior: "footprint" | "preview" | "disabled";
    reason: string;
  };
}
```

The UI reads the capability, disables or explains unsupported actions, and never silently drops a layer. A shared feature that works in only one mode is a **gap**, not parity.

### 11.5 What “robust” means here

- One domain model and one selection identity across modes.
- A `MapFacade`/backend contract; no `if (is3D)` scattered through React components.
- A capability registry that drives the UI and the layer lifecycle.
- One normalized pointer/pick path per renderer, feeding the same stores.
- Camera round-trip tests, bookmark conversion, and a documented scale mapping.
- Golden screenshots or visual-diff tests for basemaps, COG formulas, telemetry icons, and labels.
- Performance budgets for telemetry, labels, and vector primitives on named target hardware.
- Async export and effective-source attribution as release gates.
- Pinned OL/Cesium/OLCS versions and a Tauri release-build test.

---

## References

Sources checked 31 October 2026.

### OpenLayers and ol-cesium

- OpenLayers examples: <https://openlayers.org/en/latest/examples/>
- ol-cesium documentation: <https://openlayers.org/ol-cesium/doc/index.html>
- ol-cesium examples: <https://openlayers.org/ol-cesium/examples/>
- ol-cesium repository: <https://github.com/openlayers/ol-cesium>
- ol-cesium configuration properties: <https://github.com/openlayers/ol-cesium/blob/master/PROPERTIES.md>
- ol-cesium source examined at `olcs@2.23.1`: `src/olcs/OLCesium.ts`, `src/olcs/RasterSynchronizer.ts`, `src/olcs/VectorSynchronizer.ts`, `src/olcs/FeatureConverter.ts`, `src/olcs/MVTImageryProvider.ts`, `src/olcs/print/`
- Official examples referenced: `main.js`, `sidebyside.js`, `vectors.js`, `mvt.js`, `3dtiles.js`, `print.js`, `overlay.js`, `synthvectors.js`, `selection.js`, `tracking.js`, `exports.js`, `customProj.js`, `rastersync.js`, `buildings.js`, `groundvectors.js`, `fillstyle.js`

### Upstream issues

- WebGLTile/COG: <https://github.com/openlayers/ol-cesium/issues/1063>
- VectorImageLayer: <https://github.com/openlayers/ol-cesium/issues/998>
- MVT: <https://github.com/openlayers/ol-cesium/issues/728>
- Picking: <https://github.com/openlayers/ol-cesium/issues/344>, <https://github.com/openlayers/ol-cesium/issues/655>
- Vector performance: <https://github.com/openlayers/ol-cesium/issues/98>, <https://github.com/openlayers/ol-cesium/issues/477>

### Cesium and alternatives

- CesiumJS: <https://cesium.com/platform/cesiumjs/>
- CesiumJS repository: <https://github.com/CesiumGS/cesium>
- Cesium `SceneMode` (2D/2.5D/3D): <https://cesium.com/learn/cesiumjs/ref-doc/global.html#SceneMode>
- Cesium `WebMercatorProjection` (EPSG:3857): <https://cesium.com/learn/cesiumjs/ref-doc/WebMercatorProjection.html>
- Cesium `MVTDataProvider` (experimental, 1.142+): <https://cesium.com/learn/cesiumjs/ref-doc/MVTDataProvider.html>
- Cesium `GeoJsonPrimitive` (experimental, 1.142+): <https://cesium.com/learn/cesiumjs/ref-doc/GeoJsonPrimitive.html>
- `Cesium3DTileset#projectTo2D`: <https://cesium.com/learn/cesiumjs/ref-doc/Cesium3DTileset.html#projectTo2D>
- Cesium 3D Tiles: <https://cesium.com/3d-tiles/>
- Cesium ion terms/pricing: <https://cesium.com/platform/cesium-ion/>
- MapLibre GL JS: <https://maplibre.org/>
- Mapbox GL JS: <https://docs.mapbox.com/mapbox-gl-js/>
- deck.gl: <https://deck.gl/>

### Competitor architectures

- ArcGIS Maps SDK for JavaScript, switch view from 2D to 3D: <https://developers.arcgis.com/javascript/latest/sample-code/views-switch-2d-3d/>
- ArcGIS Maps SDK for JavaScript (MapView/SceneView): <https://developers.arcgis.com/javascript/latest/>
- MapStore map configuration (`visualizationMode`): <https://docs.mapstore.geosolutionsgroup.com/en/latest/developer-guide/maps-configuration>
- MapStore 2026.01 COG-in-3D release notes: <https://www.geosolutionsgroup.com/blog/mapstore-2026-01-release/>
- MapStore project: <https://mapstore.geo-solutions.it/>
- QGIS 3D Tiles: <https://docs.qgis.org/3.40/en/docs/user_manual/working_with_3d_tiles/3d_tiles.html>
- QGIS 3D map view: <https://docs.qgis.org/latest/en/docs/user_manual/map_views/3d_map_view.html>
- MapLibre COG raster source: <https://www.maplibre.org/maplibre-gl-js/docs/examples/add-a-cog-raster-source>
- MapLibre 3D Tiles with three.js: <https://www.maplibre.org/maplibre-gl-js/docs/add-3d-tiles-3d-objects-and-models-using-threejs/>
- Google Maps JavaScript API 3D Maps (`Map3DElement`): <https://developers.google.com/maps/documentation/javascript/reference/3d-map>
- Google 3D Maps overview: <https://developers.google.com/maps/documentation/javascript/3d/overview>

### Strata code references

- `src/map/mapController.ts`
- `src/map/webglTelemetry.ts`
- `src/map/telemetryIcons.ts`
- `src/map/rasterLayer.ts`
- `src/lib/gis/data.ts`
- `src/lib/gis/types.ts`
- `src/state/uiStore.ts`
- `src/state/mapStore.ts`
- `src/state/projectStore.ts`
- `src/state/telemetryStore.ts`
- `src/map/MapCanvas.tsx`
- `src/map/cesiumView.ts` (spike)
- `src/map/CesiumCanvas.tsx` (spike)
- `vite.config.ts`
- `src-tauri/tauri.conf.json`

---

## 12. Adapter spike log

**Status: in progress; screens 1–3 cleared, later gates not yet run.**
Everything below was verified in a real browser (Chromium headless, WebGL,
31 Oct–1 Nov 2026) against the dev server and a production `vite build`.

### 12.1 Verified so far

| Check | Result | Notes |
| --- | --- | --- |
| Build: `ol@10.11.0` + `cesium@1.146.0` (`tsc && vite build`) | PASS | Main chunk 6,201 kB / 1,716 kB gzip; Cesium roughly doubles JS weight. Lazy-loading Cesium is worth chasing before release, not blocking the spike. |
| Cesium static assets in Vite dev + production build | PASS | `vite-plugin-static-copy` needs `rename: { stripBase: 4 }` per target, otherwise `dist/cesium/node_modules/...` nested paths are produced; workers, widgets, and JSON assets then serve at `/cesium/...`. |
| Toggle 2D→3D mounts Cesium into the existing app shell | PASS | OSM raster basemap renders in the globe; renderer stops cleanly with an "Illegal..." error class only in our test harness, not the app. Cesium's default widget CSS conflicts needed no fixes yet. |
| Camera pick-up on entering 3D | PASS | Cesium starts at the 2D camera pose (height mapping zoom 5.5 → 2.18 Mm is coarse but recognizable). |
| Floating controls (zoom) act on the visible renderer | PASS | `zoomBy` routed to Cesium; scale bar tracked 500 km → 100 km in sync with target height 2.18 Mm → 0.54 Mm (4×, as expected for 2 steps). |
| 3D camera updates shared camera store | PASS | `viewer.camera.changed` (percentageChanged 0.01) writes to `useMapStore.camera`; moving the globe moved the status bar 47.5/13.5 → 40.25/10.5 and scale 100 → 200 km. |
| Returning to 2D restores the 3D pose into OpenLayers | PASS | `applyCamera` (view.animate duration 0) returned OL to 40.25/10.5 at matching zoom; basemap tiles render again; Cesium viewer destroyed on unmount; no leaks observed in short runs. |
| `bun test` after camera routing | PASS | 278 tests, 29 files. |

### 12.2 Fixed on the way

1. `viewer.scene.skyAtmosphere` is optional in Cesium's type defs — guard before `show`.
2. `vite-plugin-static-copy` `dest` semantics: `src: node_modules/cesium/Build/Cesium/Assets` + `dest: "cesium"` copies to `cesium/node_modules/…` because the matcher preserves the whole source path; one of either an absolute `src` glob ending in `Assets/**` or `rename: { stripBase: 4 }` is required.
3. The 2D basemap going black after toggling 3D back: `MapCanvas` subscribes to `viewMode`, so React re-writes `className` on every toggle and wipes the imperative `is-ready` class that `mountMap` had added — the div silently sat at `opacity: 0`. Readiness now comes from `useMapStore.ready` and is combined with `viewMode` when computing the className, so React fully owns fade-in/out. This only mattered because a renderer-visible element previously had zero re-render triggers.

### 12.3 Still open (spike gates)

- Telemetry: ≥1k billboards through a Cesium adapter (seven `WebGLVectorLayer`s await).
- One COG formula end to end (`CogImageryProvider` or offscreen-OL tile).
- One OpenFreeMap vector basemap parity check.
- One MVT dataset with identity/picking.
- One pick + measure path feeding the existing stores.
- Screenshot/export in 3D (needs `preserveDrawingBuffer` or post-render capture).
- Tauri release packaging incl. `Assets`, `Workers`, `Widgets`, `ThirdParty` in the bundle and CSP review.
- A real `setData`-style route from the stores into the Cesium scene (the runtime adapter's first real test beyond basemap).

### 12.4 Batch A+B fixes (1 Nov 2026)

Implemented after the audit in `docs/2D3D_AUDIT.md`; all verified in headless
Chromium, zero console errors across three CDP rounds; `bun test` 278 pass.

- Export works in 3D: viewer now mounts with
  `contextOptions.webgl.preserveDrawingBuffer`, `captureCesiumAsPng(rect?)`
  (forces a synchronous `viewer.render()` first because of
  `requestRenderMode`), and the OL-region crop math reuses the rect.
- Honest gates: `gate3D(feature)` helper in `mapController` flashes
  "…works on the 2D map — switch back to 2D" for pin-picking and
  `zoomToSelection`; the four measure entry points (`M`/`A` keys must read
  `useUiStore.getState()` inside the handler — the effect has `[]` deps)
  never arm the OL `Draw` in 3D.
- Bookmarks fly the globe, `heading = -rotation` (CCW/CW sign flip,
  provisional until a physical round-trip test).
- Basemap tray is truthful in 3D: `uiStore.basemap` subscription swaps raster
  imagery in place; vector styles fall back to OSM with a flash notice.
  Initial mount honors the current selection.
- Single attribution: app `MapAttribution` derives credit from the basemap
  actually painted per mode; Cesium's credit widget goes to a detached
  `creditContainer` div.
- Zoom parity: `heightForZoom`/`cesiumZoomBy` clamp at the zoom-20 camera
  height (par-lat, no fixed 750 m); floor measured 38 m ≈ z19.99.
- `cesiumFitExtent(extent, maxZoom?)` computes center+height with the 2D
  `[110,170,90,170]` padding semantics and a maxZoom height floor.
- Loading UX: `mountCesium(target, onReady?)` fires on the first postRender
  with `globe.tilesLoaded` (10 s ceiling, StrictMode-safe), CesiumCanvas
  shows a pointer-events-none "Loading 3D globe…" card (~4.5 s wait).
- Idle render: `requestRenderMode: true, maximumRenderTimeChange: 0.2`.

Gotchas confirmed along the way:
- `RasterMapLayer.url` is not exposed on the imagery layer/accessor chain —
  use `imageryLayers.get(0).imageryProvider.url` in test scripts.
- Re-selecting the already-active basemap is a no-op (store equality), so
  vector-fallback toasts only fire on a real change.
