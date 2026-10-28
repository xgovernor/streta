# Strata

A geospatial workspace for real datasets: load them, style them, measure them,
and keep the result in a project file. Ships as a Tauri desktop app and runs in
the browser during development.

## What it does

- **Datasets** — GeoJSON (RFC 7946, including the legacy `crs` member), delimited
  text (CSV/TSV/semicolon) with a WKT geometry column or coordinate pairs,
  `.wkt` line files, Shapefiles (a zipped archive, or the loose `.shp` with its
  `.dbf` / `.prj` / `.cpg` selected alongside it) and GeoPackages. Delimiters,
  quoted fields, decimal and degrees-minutes-seconds coordinates are all
  detected or parsed; unreadable rows are skipped and reported instead of
  failing the import. A `.prj` is honoured, and a GeoPackage's declared EPSG
  code decides how its geometry is read. SQLite WASM — the engine behind
  GeoPackage support — is fetched the first time a `.gpkg` is opened, so the
  ordinary bundle carries none of it.
- **Dataset library** — products that ship with the app and load only when
  asked for: world countries (Natural Earth 50m), world states and provinces
  (Natural Earth 10m, 4,589 units), US states and counties (Census cartographic
  boundaries), Bangladesh's 64 districts, submarine cable routes with their
  landing points, OSM datacenter and dam footprints, and the named military
  areas of OpenStreetMap. They are stored as
  TopoJSON — shared borders written once, coordinates as relative integers — so
  even the world's first-level units travel in under 4 MB, and nothing is
  downloaded until its product is chosen.
- **Basemaps** — four OpenFreeMap vector styles plus five tiled services:
  Google Maps streets, Esri World Imagery, Maxar-powered Google satellite,
  Google hybrid imagery with labels, and OpenStreetMap. Each one is defined in
  `src/lib/gis/data.ts` with its own tile templates and attribution, and switching
  cartography preserves the camera and leaves overlays untouched. The rasters
  are read straight from the providers under their own terms and are credited
  on the map while shown — point the definitions at your own licensed or
  keyed endpoints before shipping commercially.
- **Datasets own their layers** — one file or library product is one dataset,
  and inside it sits its own stack of layers (a multi-layer GeoPackage, an
  archive of shapefiles, or countries and their provinces). Each layer keeps its
  own CRS, styling, visibility and opacity; datasets reorder and toggle as
  groups. Loading and composing live in one panel — the library, the open
  datasets, and inside each one its layers with reorder, opacity, visibility,
  zoom-to, attribute table, export as WGS 84 GeoJSON or CSV, and removal.
- **Attribute filters** — any layer can be narrowed by facets: pick a field
  (operator, material, plant method, county type…) and tick the values to keep.
  Facets are ANDed and values inside one facet are ORed; the map, the attribute
  table and the search index follow, while the stored features, the joins and
  the exported files stay complete. Filters travel with the layer in the
  project file.
- **Attribute joins** — a table with attributes but no geometry (a census
  table keyed on `ADM2_PCODE`, a facility list keyed on a district name) can be
  joined onto a boundary layer by a shared key. The panel previews how many
  features will receive values before anything is built, keys are compared
  ignoring case and spacing, and the result arrives as a new dataset of its own
  so the boundaries it read from stay untouched.
- **Coordinate reference systems** — 140+ registered projections (the global
  defaults, every WGS 84 UTM zone, Bangladesh's Gulshan 303, TM 90 NE and BTM,
  and the national grids most field data arrives in) on top of proj4. Coordinates are stored in the layer's own CRS and
  reprojected into the map view on the fly. Changing a layer's CRS reprojects
  its data, and points outside the target projection's domain are dropped and
  counted rather than rendered as garbage. Project files can carry their own
  proj4 definitions.
- **Analysis** — geodesic distance and area measurement drawn straight on the
  map with live per-segment labels, hit-testing across all layers, feature
  detail with geometry statistics, and a windowed attribute table with
  filtering and sorting that stays responsive on large tables.
- **Click card and online context** — clicking a feature leaves a small card at
  the point clicked: what it is, the attributes that identify it, its
  coordinates, and one button to the full panel. That panel looks up the
  surrounding place through Nominatim, the Wikipedia article when the feature
  carries a `wikipedia` or `wikidata` tag, and — only when asked — the complete
  OpenStreetMap tags through Overpass, since the packed layers keep a handful of
  tags rather than all of them. Lookups are cached per feature and throttled per
  host, because Nominatim accepts one request a second.
- **Project files** — a `.strata` file holds every dataset and layer with its
  data, styling, projection, the camera and the preferences, so it reopens
  identically; a version 1 file still opens, its flat layers becoming one
  dataset each. The session (preferences plus a workspace that fits local
  storage) is restored too, and a dataset too large to keep is listed with a
  reload button rather than silently dropped.

The map view stays in Web Mercator (`EPSG:3857`) because every basemap service
it draws — the vector styles and the raster tile services alike — is Web
Mercator.

## Stack

- React 19 + TypeScript 7 (strict), Vite 8
- OpenLayers 10 with `ol-mapbox-style` for the vector basemaps and `ol/source/XYZ`
  for the raster ones
- proj4 for projection definitions and reprojection, shpjs for Shapefiles,
  sql.js (SQLite compiled to WebAssembly) for GeoPackages
- `topojson-client` to decode bundled boundaries, with `world-atlas` and
  `us-atlas` supplying the country, state and county packs
- Zustand for UI, camera and project state
- Tailwind CSS 4 with CSS-variable design tokens (`src/index.css`)
- Tauri 2 shell (`src-tauri/`) with the dialog and fs plugins for file access

## Development

```bash
bun install
bun run dev        # web app on http://localhost:1420
bun run tauri dev  # desktop window (requires the Rust toolchain)
bun run build      # typecheck + production bundle
bun run preview    # serve the production bundle
bun test           # unit tests
node scripts/build-datasets.mjs  # rebuild the bundled TopoJSON packs
```

## Layout

```
src/
  components/   chrome: ribbons, panels, status footer, toasts
  lib/gis/      domain core: CRS registry, geometry maths, GeoJSON/CSV/WKT,
                Shapefile, GeoPackage and WKB readers, attribute join, dataset
                and layer registry, dataset library, bundled sample data
  lib/          formatting, project files, file IO, class names, links
  map/          MapCanvas and the imperative OpenLayers controller
  state/        zustand stores (uiStore, mapStore, projectStore)
scripts/
  build-datasets.mjs   packs the bundled boundary datasets into TopoJSON
  source-data/         their source geometry, kept out of the served bundle
public/datasets/       the packed TopoJSON the library fetches on demand
data/local/            the datasets this repo adds, read by the build script
```

`src/lib/gis` has no React or OpenLayers imports, so the data layer is
unit-testable on its own — `bun test` covers CRS normalisation and reprojection,
geodesic measurement, GeoJSON/CSV/WKT parsing and writing, WKB and GeoPackage
blob decoding, the shapefile reader, the attribute join, dataset grouping and
ordering, workspace migration, layer validation, project file round-trips, and
the store.

The map is mounted once by `src/map/mapController.ts` and synced with the stores
imperatively, so panels, themes, styling and layer changes never re-create the
map or its view.

File access goes through `src/lib/fileIo.ts`: the native dialog and fs plugins
inside Tauri, and the browser's own file input and download path everywhere else.

## Keyboard

| Key     | Action                          |
| ------- | ------------------------------- |
| `/`     | Search every loaded dataset     |
| `D` `L` | Datasets: open, library, layer stack |
| `T`     | Attribute table                 |
| `M`     | Measure distance                |
| `+` `-` | Zoom in / out                   |
| `0`     | Reset north                     |
| `Esc`   | Close the panel / end the tool  |

## Data

`src/lib/gis/data.ts` holds the bundled sample dataset (a station network and
its two layers), seeded into a fresh workspace so the map is not empty. It is an
ordinary dataset and can be removed.

`src/lib/gis/library.ts` lists the products the Datasets panel offers. World
countries and US states come straight from established data packages and are
decoded with `topojson-client`, from `world-atlas` (Natural Earth 1:50m) and
`us-atlas` (US Census Bureau states).

`public/datasets/` holds the packs built by `scripts/build-datasets.mjs`. The
script reads its sources — `data/local/` for the datasets added to this repo,
and a pinned Natural Earth download — and does the geometry work with
`topojson-server`, `topojson-simplify` and `topojson-client`. It never modifies
its sources: `node scripts/build-datasets.mjs --only local` repacks everything
under `data/local/`.

| Pack | Contents | Size | Source and licence |
| --- | --- | --- | --- |
| `world-admin1.topo.json` | Natural Earth 10m admin-1, 4,589 units | 3.9 MB | Natural Earth · public domain |
| `bgd-adm2.topo.json` | COD-AB ADM2, 64 districts | 0.5 MB | OCHA · CC BY-IGO |
| `us-counties.topo.json` | Census cartographic counties, 3,235 units | 1.7 MB | US Census Bureau · public domain |
| `submarine-cables.topo.json` | 712 cable routes, 1,917 landing points | 0.5 MB | © TeleGeography · CC BY-NC-SA 3.0 |
| `datacenters.topo.json` | 4,351 OSM data-centre footprints | 1.0 MB | OpenStreetMap contributors · ODbL 1.0 |
| `dams.topo.json` | 704 OSM dam footprints | 0.2 MB | OpenStreetMap contributors · ODbL 1.0 |
| `military-areas.topo.json` | 36,466 OSM named military areas, as label points | 5.8 MB | OpenStreetMap contributors · ODbL 1.0 |

**Licence note.** The submarine cable data is **CC BY-NC-SA 3.0**: attribution
is required (shown in the panel) and it may not be used commercially — remove
`data/local/telegeography_submarine_cables` and its pack before any commercial
distribution, or license the data from TeleGeography. The OSM-derived layers
carry ODbL 1.0 and the OpenStreetMap attribution.

`data/local/cctv_ground_heights` (per-camera ellipsoidal heights) is not wired:
it holds only heights keyed by camera id, so it cannot become a layer.
`data/local/osm_military_names` holds a name, a label point, bounds and an area
for 36,466 named military areas but no polygons, so it ships as a point layer —
each feature sits at the centre of the area it names, and the class (airfield,
base, range, training area…) and area in km² stay as attributes. It is the
largest pack of the set because the names themselves are most of its bytes.

The Bangladesh districts come from the Bangladesh Bureau of Statistics through
[OCHA](https://data.humdata.org/dataset/cod-ab-bgd); every COD-AB attribute is
kept because `ADM2_PCODE` is the natural key for the census and population
tables published beside it — that is what the join panel is for. Their geometry
is simplified from about 20 MB of source to 0.5 MB; `scripts/source-data/` keeps
the unmodified source out of the served bundle.

Three very small territories in the Natural Earth pack — Siachen Glacier,
Ashmore and Cartier Islands and the Indian Ocean Territories — have no
representable outline in Web Mercator at country scale; the map reports them as
undrawable instead of drawing something wrong.

Basemap tiles come from [OpenFreeMap](https://openfreemap.org) and are
attributed in-app; the attribution links open in the system browser.
