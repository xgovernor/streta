#!/usr/bin/env node
/**
 * Build the datasets that ship inside the app. Nothing here modifies its
 * sources: `data/local/` and `scripts/source-data/` are read, and the packs are
 * written to `public/datasets/`.
 *
 *   world-admin1.topo.json   Natural Earth 10m admin-1 (downloaded, pinned)
 *   bgd-adm2.topo.json       COD-AB Bangladesh districts
 *   submarine-cables.topo.json  TeleGeography cable routes and landings
 *   datacenters.topo.json    OSM data-centre footprints
 *   dams.topo.json           OSM dam footprints
 *   military-areas.topo.json  OSM named military areas, as label points
 *   us-counties.topo.json    US Census cartographic counties
 *   cctv-cameras.topo.json   Traffic cameras and coverage viewshed wedges
 *
 * TopoJSON rather than GeoJSON because it stores shared borders once, as
 * relative integer coordinates, which is what makes a 4,596-unit boundary pack
 * smaller than a single district file. The conversion, the simplification and
 * the quantisation are `topojson-server`, `topojson-simplify` and
 * `topojson-client`, so there is no geometry code to maintain here.
 *
 * The Natural Earth download is pinned by URL and SHA-256, so a rerun produces
 * the same bytes; the archive is cached outside the repository.
 *
 * Usage:
 *   node scripts/build-datasets.mjs [--cache <dir>] [--only <name>|local]
 *
 * `--only` takes admin1, bangladesh, cables, datacenters, dams, military,
 * counties or `local` (every pack read from `data/local`). Sources and licences are
 * recorded in README.md (Data).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { quantize } from "topojson-client";
import { topology } from "topojson-server";
import { presimplify, simplify } from "topojson-simplify";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "datasets");
const LOCAL_DIR = path.join(ROOT, "data", "local");

const NATURAL_EARTH_COMMIT = "ca96624a56bd078437bca8184e78163e5039ad19";
const ADMIN1 = {
  url: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_COMMIT}/geojson/ne_10m_admin_1_states_provinces.geojson`,
  sha256: "22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5",
  /**
   * Planar triangle area, in square degrees, under which a vertex is dropped.
   * 2e-4 ≈ 0.014° (1.5 km) of tolerance: sharp enough to keep coastlines and
   * district borders legible, and it takes the 10m source from 39 MB of
   * GeoJSON to a ~4 MB pack.
   */
  minWeight: 2e-4,
  decimals: 1e5,
};

/** Bangladesh districts keep their attributes: they are a join target. */
const BANGLADESH = {
  source: path.join(ROOT, "scripts", "source-data", "bgd-adm2-districts.geojson"),
  minWeight: 5e-7,
  decimals: 1e6,
};

const args = process.argv.slice(2);
const cacheDir = path.resolve(
  args.includes("--cache")
    ? args[args.indexOf("--cache") + 1]
    : path.join(os.tmpdir(), "strata-datasets"),
);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

function report(label, text) {
  const bytes = Buffer.byteLength(text);
  console.log(`  ${label}: ${(bytes / 1e6).toFixed(2)} MB`);
}

/** Reads a pinned URL through a disk cache, checking the SHA-256. */
async function fetchPinned(name, { url, sha256 }) {
  const file = path.join(cacheDir, path.basename(new URL(url).pathname));
  let bytes = existsSync(file) ? readFileSync(file) : null;

  if (!bytes) {
    console.log(`Downloading ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    bytes = Buffer.from(await response.arrayBuffer());
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, bytes);
  }

  const digest = createHash("sha256").update(bytes).digest("hex");

  if (digest !== sha256) {
    throw new Error(`${name}: SHA-256 ${digest} does not match the pinned ${sha256}`);
  }

  return JSON.parse(bytes.toString("utf8"));
}

/**
 * Named layers of GeoJSON features → simplified, quantised TopoJSON text. Each
 * layer becomes one object inside the topology, which is what lets one library
 * product (cables and their landings) arrive as one file with two layers.
 */
function pack(layers, { minWeight, decimals }) {
  const objects = {};

  for (const [name, features] of Object.entries(layers)) {
    objects[name] = { type: "FeatureCollection", features };
  }

  const topo = presimplify(topology(objects));
  const slim = simplify(topo, minWeight);
  const quantised = quantize(slim, decimals);

  return {
    text: JSON.stringify(quantised),
    vertices: slim.arcs.reduce((total, arc) => total + arc.length, 0),
  };
}

function readLocal(relative) {
  const file = path.join(LOCAL_DIR, relative);

  if (!existsSync(file)) {
    return null;
  }

  return JSON.parse(readFileSync(file, "utf8"));
}

/** GeoJSONL: one Feature per line, as the OSM extracts ship them. */
function readLocalLines(relative) {
  const file = path.join(LOCAL_DIR, relative);

  if (!existsSync(file)) {
    return null;
  }

  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/** Keeps only the attributes a boundary layer is worth carrying. */
function tidyProperties(properties) {
  return {
    name: properties.name ?? null,
    country: properties.admin ?? null,
    code: properties.iso_3166_2 || properties.adm1_code || null,
    type: properties.type_en ?? null,
  };
}

/** A single attribute value the workspace can hold. */
function scalar(value) {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : null;
}

function toFeature(properties, geometry) {
  return { type: "Feature", properties, geometry };
}

async function buildAdmin1() {
  console.log("Natural Earth 10m admin-1");
  const source = await fetchPinned("admin1", ADMIN1);

  const features = source.features
    .filter((feature) => feature.geometry && feature.properties.name)
    .map((feature) =>
      toFeature(tidyProperties(feature.properties), feature.geometry),
    );

  const { text, vertices } = pack({ areas: features }, ADMIN1);
  writeFileSync(path.join(OUT_DIR, "world-admin1.topo.json"), text);

  console.log(`  ${features.length} units · ${vertices} vertices`);
  report("world-admin1.topo.json", text);
}

function buildBangladesh() {
  console.log("COD-AB Bangladesh ADM2");

  if (!existsSync(BANGLADESH.source)) {
    console.log(`  skipped: ${path.relative(ROOT, BANGLADESH.source)} is missing`);
    return;
  }

  const source = JSON.parse(readFileSync(BANGLADESH.source, "utf8"));
  const features = source.features
    .filter((feature) => feature.geometry)
    .map((feature) =>
      // The census table joins on adm2_pcode, so the attributes stay as they
      // came from OCHA.
      toFeature(feature.properties, feature.geometry),
    );

  const { text, vertices } = pack({ areas: features }, BANGLADESH);
  writeFileSync(path.join(OUT_DIR, "bgd-adm2.topo.json"), text);

  console.log(`  ${features.length} districts · ${vertices} vertices`);
  report("bgd-adm2.topo.json", text);
}

/** Cable routes and their landing points, from TeleGeography's map. */
function buildCables() {
  console.log("TeleGeography submarine cables");

  const cables = readLocal("telegeography_submarine_cables/cable-geo.json");
  const landings = readLocal(
    "telegeography_submarine_cables/landing-point-geo.json",
  );

  if (!cables || !landings) {
    console.log("  skipped: data/local/telegeography_submarine_cables is missing");
    return;
  }

  const layers = {
    cables: cables.features
      .filter((feature) => feature.geometry)
      .map((feature) =>
        toFeature(
          {
            name: scalar(feature.properties.name),
            id: scalar(feature.properties.id),
          },
          feature.geometry,
        ),
      ),
    landings: landings.features
      .filter((feature) => feature.geometry)
      .map((feature) =>
        toFeature(
          {
            name: scalar(feature.properties.name),
            id: scalar(feature.properties.id),
            planned: feature.properties.is_tbd === true,
          },
          feature.geometry,
        ),
      ),
  };

  const { text, vertices } = pack(layers, { minWeight: 4e-7, decimals: 1e6 });
  writeFileSync(path.join(OUT_DIR, "submarine-cables.topo.json"), text);

  console.log(
    `  ${layers.cables.length} routes · ${layers.landings.length} landing points · ${vertices} vertices`,
  );
  report("submarine-cables.topo.json", text);
}

/**
 * OSM infrastructure footprints. Their tags object is flattened to the few
 * attributes a layer can carry, rather than shipping every OSM tag.
 */
function buildFootprints({
  label,
  file,
  pack: packFile,
  properties,
  minWeight,
  decimals,
}) {
  console.log(label);

  const features = readLocalLines(file);

  if (!features) {
    console.log(`  skipped: data/local/${file} is missing`);
    return;
  }

  const mapped = features
    .filter((feature) => feature.geometry)
    .map((feature) => {
      const tags =
        typeof feature.properties?.tags === "object" &&
        feature.properties?.tags !== null
          ? feature.properties.tags
          : {};

      return toFeature(
        properties(feature.properties ?? {}, tags),
        feature.geometry,
      );
    });

  const { text, vertices } = pack({ areas: mapped }, { minWeight, decimals });
  writeFileSync(path.join(OUT_DIR, packFile), text);

  console.log(`  ${mapped.length} footprints · ${vertices} vertices`);
  report(packFile, text);
}

function buildDatacenters() {
  buildFootprints({
    label: "OSM datacenters",
    file: "datacenters/datacenters.geojsonl",
    pack: "datacenters.topo.json",
    minWeight: 1e-9,
    // World extent: 1e6 is a ~40 m grid, which keeps a building footprint
    // recognisable without carrying every OSM node.
    decimals: 1e6,
    properties: (feature, tags) => ({
      name: scalar(tags.name),
      operator: scalar(tags.operator ?? tags["operator:short"]),
      type: scalar(feature.type),
      // The online context in the feature panel reads these two.
      wikidata: scalar(tags.wikidata),
      wikipedia: scalar(tags.wikipedia),
      osm_id: scalar(feature.osm_id),
    }),
  });
}

function buildDams() {
  buildFootprints({
    label: "OSM dams",
    file: "dams/dams.geojsonl",
    pack: "dams.topo.json",
    minWeight: 1e-9,
    decimals: 1e6,
    properties: (feature, tags) => ({
      name: scalar(feature.name ?? tags.name),
      output: scalar(feature.output),
      // `construction` is empty for every dam in this extract; the material and
      // the plant method are what the rows can actually be told apart by, so
      // both are carried as facets.
      construction: scalar(feature.construction),
      material: scalar(tags.material),
      method: scalar(tags["plant:method"]),
      operator: scalar(tags.operator),
      wikidata: scalar(tags.wikidata),
      wikipedia: scalar(tags.wikipedia),
      osm_id: scalar(feature.osm_id),
    }),
  });
}

/**
 * Named military areas, as label points. The source rows are
 * [typedOsmId, name, lon, lat, west, south, east, north, classIndex, areaM2];
 * the bounds stay in the dataset, the layer carries the point and the class.
 */
function buildMilitary() {
  console.log("OSM military areas");

  const source = readLocal("osm_military_names/names.json");

  if (!source) {
    console.log("  skipped: data/local/osm_military_names is missing");
    return;
  }

  const classes = Array.isArray(source.classes) ? source.classes : [];
  let skipped = 0;

  const features = source.records
    .map((record) => {
      const [osmId, name, lon, lat, , , , , classIndex, areaM2] = record;

      if (
        typeof lon !== "number" ||
        typeof lat !== "number" ||
        !Number.isFinite(lon) ||
        !Number.isFinite(lat)
      ) {
        skipped += 1;
        return null;
      }

      return toFeature(
        {
          name: scalar(name),
          osm_id: scalar(osmId),
          class: scalar(classes[classIndex]) ?? null,
          area_km2:
            typeof areaM2 === "number" ?
              Math.round((areaM2 / 1e6) * 100) / 100
            : null,
        },
        { type: "Point", coordinates: [lon, lat] },
      );
    })
    .filter((feature) => feature !== null);

  // Label points need no simplification; 1e5 is a ~400 m grid at world scale,
  // which is well inside what a label placement can show.
  const { text, vertices } = pack({ areas: features }, { minWeight: 0, decimals: 1e5 });
  writeFileSync(path.join(OUT_DIR, "military-areas.topo.json"), text);

  console.log(
    `  ${features.length} named areas${skipped ? ` · ${skipped} skipped` : ""} · ${vertices} vertices`,
  );
  report("military-areas.topo.json", text);
}

/**
 * The Census pack stores each ring open, as integers in 10^-d degrees where
 * every vertex after the first is a delta from the previous one. Decoding it is
 * arithmetic; the pack itself is left as it came.
 */
function decodeRing(encoded, decimals) {
  const factor = 10 ** decimals;
  let x = 0;
  let y = 0;
  const ring = [];

  for (let i = 0; i + 1 < encoded.length; i += 2) {
    x += encoded[i];
    y += encoded[i + 1];
    ring.push([x / factor, y / factor]);
  }

  if (ring.length < 3) {
    return null;
  }

  // GeoJSON rings close on their first vertex; the pack stores them open.
  const [first] = ring;
  const last = ring[ring.length - 1];

  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }

  return ring;
}

function buildCounties() {
  console.log("US Census cartographic counties");

  const source = readLocal("us_census_counties/counties.json");

  if (!source) {
    console.log("  skipped: data/local/us_census_counties is missing");
    return;
  }

  const fallback = source.meta?.decimals ?? 4;
  let skipped = 0;

  const features = source.features
    .map((feature) => {
      const decimals = feature.d ?? fallback;
      const parts = feature.polygons
        .map((part) =>
          part
            .map((ring) => decodeRing(ring, decimals))
            .filter((ring) => ring !== null),
        )
        .filter((part) => part.length > 0);

      if (!parts.length) {
        skipped += 1;
        return null;
      }

      return toFeature(
        {
          name: scalar(feature.name),
          full: scalar(feature.full),
          lsad: scalar(feature.lsad),
          state: scalar(feature.state),
          st: scalar(feature.st),
          geoid: scalar(feature.geoid),
        },
        parts.length === 1
          ? { type: "Polygon", coordinates: parts[0] }
          : { type: "MultiPolygon", coordinates: parts },
      );
    })
    .filter((feature) => feature !== null);

  const { text, vertices } = pack({ areas: features }, { minWeight: 0, decimals: 1e5 });
  writeFileSync(path.join(OUT_DIR, "us-counties.topo.json"), text);

  console.log(
    `  ${features.length} counties${skipped ? ` · ${skipped} skipped` : ""} · ${vertices} vertices`,
  );
  report("us-counties.topo.json", text);
}

/** Offset [lon, lat] along a bearing (degrees) and distance (metres). */
function offsetCoord(lon, lat, bearingDeg, distanceM) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  const theta = rad(bearingDeg);
  const delta = distanceM / R;
  const phi1 = rad(lat);
  const lambda1 = rad(lon);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const sinDelta = Math.sin(delta);
  const cosDelta = Math.cos(delta);

  const sinPhi2 = sinPhi1 * cosDelta + cosPhi1 * sinDelta * Math.cos(theta);
  const phi2 = Math.asin(sinPhi2);

  const y = Math.sin(theta) * sinDelta * cosPhi1;
  const x = cosDelta - sinPhi1 * Math.sin(phi2);
  const lambda2 = lambda1 + Math.atan2(y, x);

  const normLon = ((deg(lambda2) + 540) % 360) - 180;
  return [Number(normLon.toFixed(6)), Number(deg(phi2).toFixed(6))];
}

/** Build viewshed sector polygon for a camera. */
function buildWedge(lon, lat, headingDeg, fovDeg = 50, rangeM = 150) {
  const center = [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
  const halfFov = Math.max(2, Math.min(160, fovDeg)) / 2;
  const clampedRange = Math.max(10, Math.min(5000, rangeM));
  const startAngle = headingDeg - halfFov;
  const endAngle = headingDeg + halfFov;
  const steps = 12;

  const ring = [center];
  for (let i = 0; i <= steps; i += 1) {
    const fraction = i / steps;
    const bearing = startAngle + fraction * (endAngle - startAngle);
    ring.push(offsetCoord(lon, lat, bearing, clampedRange));
  }
  ring.push(center);
  return [ring];
}

function buildCctv() {
  console.log("Traffic CCTV cameras and ground heights");

  const cameras = readLocal("cctv-ground-heights/cameras.json");
  if (!cameras || !Array.isArray(cameras)) {
    console.log("  skipped: data/local/cctv-ground-heights/cameras.json is missing");
    return;
  }

  const cameraFeatures = [];
  const viewshedFeatures = [];

  for (const cam of cameras) {
    if (!cam || !Number.isFinite(cam.lat) || !Number.isFinite(cam.lon)) continue;

    cameraFeatures.push(
      toFeature(
        {
          name: scalar(cam.name),
          city: scalar(cam.city),
          provider: scalar(cam.provider),
          mount_ground_m: scalar(cam.mountGroundM),
          mount_height_m: scalar(cam.mountHeightM),
          total_elevation_m: scalar(cam.totalElevationM),
          heading_deg: scalar(cam.headingDeg),
          pitch_deg: scalar(cam.pitchDeg),
          fov_deg: scalar(cam.fovDeg),
          range_m: scalar(cam.rangeM),
          snapshot_url: scalar(cam.snapshotUrl),
          status: scalar(cam.status) || "ok",
          support_bl: scalar(cam.supports?.bl),
          support_bm: scalar(cam.supports?.bm),
          support_br: scalar(cam.supports?.br),
          support_ml: scalar(cam.supports?.ml),
          support_mc: scalar(cam.supports?.mc),
          support_mr: scalar(cam.supports?.mr),
          support_tl: scalar(cam.supports?.tl),
          support_tm: scalar(cam.supports?.tm),
          support_tr: scalar(cam.supports?.tr),
        },
        { type: "Point", coordinates: [cam.lon, cam.lat] },
      ),
    );

    // Only generate a viewshed wedge when camera heading is known
    if (Number.isFinite(cam.headingDeg)) {
      const wedgeCoordinates = buildWedge(
        cam.lon,
        cam.lat,
        cam.headingDeg,
        cam.fovDeg || 50,
        cam.rangeM || 150,
      );
      viewshedFeatures.push(
        toFeature(
          {
            name: scalar(cam.name),
            city: scalar(cam.city),
            provider: scalar(cam.provider),
            heading_deg: scalar(cam.headingDeg),
            range_m: scalar(cam.rangeM || 150),
            camera_id: scalar(cam.id),
          },
          { type: "Polygon", coordinates: wedgeCoordinates },
        ),
      );
    }
  }

  const { text, vertices } = pack(
    { cameras: cameraFeatures, viewsheds: viewshedFeatures },
    { minWeight: 0, decimals: 1e5 },
  );

  writeFileSync(path.join(OUT_DIR, "cctv-cameras.topo.json"), text);

  console.log(
    `  ${cameraFeatures.length} cameras · ${viewshedFeatures.length} viewsheds · ${vertices} vertices`,
  );
  report("cctv-cameras.topo.json", text);
}

const TASKS = {
  admin1: buildAdmin1,
  bangladesh: buildBangladesh,
  cables: buildCables,
  datacenters: buildDatacenters,
  dams: buildDams,
  military: buildMilitary,
  counties: buildCounties,
  cctv: buildCctv,
};

const LOCAL_PACKS = ["cables", "datacenters", "dams", "military", "counties", "cctv"];

mkdirSync(OUT_DIR, { recursive: true });

const wanted =
  only === "local" ? LOCAL_PACKS : only ? [only] : Object.keys(TASKS);

for (const name of wanted) {
  const task = TASKS[name];

  if (!task) {
    throw new Error(
      `Unknown dataset "${name}"; expected one of ${Object.keys(TASKS).join(", ")} or local`,
    );
  }

  await task();
}

console.log("Done.");
