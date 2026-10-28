import { feature } from "topojson-client";
import type {
  GeometryCollection,
  GeometryObject,
  Topology,
} from "topojson-specification";
import usStatesUrl from "us-atlas/states-10m.json?url";
import countriesUrl from "world-atlas/countries-50m.json?url";
import { GEOGRAPHIC_CRS } from "./crs";
import { DataError, type ImportResult } from "./geojson";
import type {
  Attributes,
  AttributeValue,
  FeatureRecord,
  Geometry,
  GeometryKind,
} from "./types";

/**
 * The dataset library: boundary products that ship with the app, load on
 * demand and never touch the network until they are asked for.
 *
 * Two of them come straight out of established data packages — `world-atlas`
 * and `us-atlas`, both TopoJSON — and two are the packs built by
 * `scripts/build-datasets.mjs`. TopoJSON is the format here because it stores
 * a shared border once and keeps coordinates as relative integers, so a
 * 4,589-unit admin-1 pack is smaller than a single district file was; decoding
 * it is `topojson-client`'s job, not ours.
 */

export interface LibraryLayerSpec {
  name: string;
  /** Topology asset: a URL relative to the app root. */
  url: string;
  /** The object inside that topology. */
  object: string;
  /** Namespace for the feature ids, so two layers cannot collide. */
  idPrefix: string;
  /** The attributes to keep, using the topology id where it matters. */
  properties: (source: Record<string, unknown>, id: string | null) => Attributes;
}

export interface LibraryProduct {
  id: string;
  name: string;
  detail: string;
  credit: string;
  layers: LibraryLayerSpec[];
}

/** A local asset, whatever base the app is served from. */
function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
}

const text = (value: unknown): AttributeValue =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean" ?
    value
  : null;

export const LIBRARY: LibraryProduct[] = [
  {
    id: "world",
    name: "World boundaries",
    detail: "Countries and first-level units",
    credit: "Natural Earth · public domain",
    layers: [
      {
        name: "Countries",
        url: countriesUrl,
        object: "countries",
        idPrefix: "country-",
        properties: (source, id) => ({
          name: text(source.name),
          iso_n3: id,
        }),
      },
      {
        name: "States & provinces",
        url: asset("/datasets/world-admin1.topo.json"),
        object: "areas",
        idPrefix: "admin1-",
        properties: (source) => ({
          name: text(source.name),
          country: text(source.country),
          code: text(source.code),
          type: text(source.type),
        }),
      },
    ],
  },
  {
    id: "united-states",
    name: "United States boundaries",
    detail: "States and counties",
    credit: "US Census Bureau · public domain",
    layers: [
      {
        name: "States",
        url: usStatesUrl,
        object: "states",
        idPrefix: "us-state-",
        properties: (source, id) => ({
          name: text(source.name),
          fips: id,
        }),
      },
      {
        name: "Counties",
        url: asset("/datasets/us-counties.topo.json"),
        object: "areas",
        idPrefix: "us-county-",
        // The Census pack carries the county word and its state, which is what
        // makes a county joinable to a state-level table.
        properties: (source, id) => ({
          name: text(source.name),
          full: text(source.full),
          lsad: text(source.lsad),
          state: text(source.state),
          st: text(source.st),
          geoid: text(source.geoid) ?? id,
        }),
      },
    ],
  },
  {
    id: "bangladesh",
    name: "Bangladesh districts",
    detail: "64 districts · the census join target",
    credit: "OCHA COD-AB · CC BY-IGO",
    layers: [
      {
        name: "Districts",
        url: asset("/datasets/bgd-adm2.topo.json"),
        object: "areas",
        idPrefix: "bgd-adm2-",
        // Every COD-AB attribute is kept: adm2_pcode is the join key.
        properties: (source) =>
          Object.fromEntries(
            Object.entries(source).map(([key, value]) => [key, text(value)]),
          ),
      },
    ],
  },
  {
    id: "submarine-cables",
    name: "Submarine cables",
    detail: "Cable routes and their landing points",
    // CC BY-NC-SA 3.0: attribution required, non-commercial use only.
    credit: "© TeleGeography · submarinecablemap.com · CC BY-NC-SA 3.0",
    layers: [
      {
        name: "Cable routes",
        url: asset("/datasets/submarine-cables.topo.json"),
        object: "cables",
        idPrefix: "cable-",
        properties: (source, id) => ({
          name: text(source.name),
          cable: text(source.id) ?? id,
        }),
      },
      {
        name: "Landing points",
        url: asset("/datasets/submarine-cables.topo.json"),
        object: "landings",
        idPrefix: "landing-",
        properties: (source, id) => ({
          name: text(source.name),
          landing: text(source.id) ?? id,
          status: source.planned === true ? "planned" : "active",
        }),
      },
    ],
  },
  {
    id: "datacenters",
    name: "Datacenters",
    detail: "OSM data-centre footprints",
    credit: "OpenStreetMap contributors · ODbL 1.0",
    layers: [
      {
        name: "Datacenters",
        url: asset("/datasets/datacenters.topo.json"),
        object: "areas",
        idPrefix: "datacenter-",
        properties: (source, id) => ({
          name: text(source.name),
          operator: text(source.operator),
          type: text(source.type),
          wikidata: text(source.wikidata),
          wikipedia: text(source.wikipedia),
          osm_id: text(source.osm_id) ?? id,
        }),
      },
    ],
  },
  {
    id: "dams",
    name: "Dams",
    detail: "OSM dam footprints",
    credit: "OpenStreetMap contributors · ODbL 1.0",
    layers: [
      {
        name: "Dams",
        url: asset("/datasets/dams.topo.json"),
        object: "areas",
        idPrefix: "dam-",
        properties: (source, id) => ({
          name: text(source.name),
          operator: text(source.operator),
          material: text(source.material),
          method: text(source.method),
          output: text(source.output),
          construction: text(source.construction),
          wikidata: text(source.wikidata),
          wikipedia: text(source.wikipedia),
          osm_id: text(source.osm_id) ?? id,
        }),
      },
    ],
  },
  {
    id: "military-areas",
    name: "Military areas",
    detail: "OSM named bases, ranges and training areas",
    credit: "OpenStreetMap contributors · ODbL 1.0",
    layers: [
      {
        name: "Named areas",
        url: asset("/datasets/military-areas.topo.json"),
        object: "areas",
        idPrefix: "military-",
        // The source has no usable polygon for these rows, so each one arrives
        // as a label point at the centre of the area it names.
        properties: (source, id) => ({
          name: text(source.name),
          class: text(source.class),
          area_km2: text(source.area_km2),
          osm_id: text(source.osm_id) ?? id,
        }),
      },
    ],
  },
];

export function libraryProduct(id: string): LibraryProduct | undefined {
  return LIBRARY.find((product) => product.id === id);
}

const GEOMETRY_TYPES = new Set<GeometryKind>([
  "Point",
  "LineString",
  "Polygon",
  "MultiPoint",
  "MultiLineString",
  "MultiPolygon",
]);

const topologies = new Map<string, Promise<Topology>>();
const decoded = new Map<string, ImportResult>();

/**
 * Fetches a topology once. A failed load is not cached, so choosing the
 * dataset again retries instead of replaying the error forever.
 */
function loadTopology(url: string): Promise<Topology> {
  const cached = topologies.get(url);

  if (cached) {
    return cached;
  }

  const pending = fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new DataError(`Could not fetch ${url} (HTTP ${response.status})`);
      }

      return response.json() as Promise<Topology>;
    })
    .catch((error: unknown) => {
      topologies.delete(url);
      throw error;
    });

  topologies.set(url, pending);
  return pending;
}

function toRecord(
  source: { id?: string | number; geometry: { type: string; coordinates: unknown } | null; properties: unknown },
  spec: LibraryLayerSpec,
  index: number,
): FeatureRecord | null {
  const type = source.geometry?.type;

  if (!type || !GEOMETRY_TYPES.has(type as GeometryKind)) {
    return null;
  }

  const raw = (source.properties ?? {}) as Record<string, unknown>;
  const id = source.id === undefined ? null : String(source.id);

  return {
    id: `${spec.idPrefix}${id ?? index}`,
    geometry: { type: type as GeometryKind, coordinates: source.geometry?.coordinates } as Geometry,
    properties: spec.properties(raw, id),
  };
}

async function decodeLayer(spec: LibraryLayerSpec): Promise<ImportResult> {
  const key = `${spec.url}#${spec.object}`;
  const cached = decoded.get(key);

  if (cached) {
    return { ...cached, name: spec.name };
  }

  const topology = await loadTopology(spec.url);
  const object = topology.objects[spec.object] as GeometryObject | undefined;

  if (!object) {
    throw new DataError(`${spec.name} is missing from ${spec.url}`);
  }

  const collection = feature(
    topology,
    object.type === "GeometryCollection" ?
      (object as GeometryCollection)
    : object,
  );
  const items =
    collection.type === "FeatureCollection" ? collection.features : [collection];

  const features = items
    .map((item, index) =>
      toRecord(
        item as {
          id?: string | number;
          geometry: { type: string; coordinates: unknown } | null;
          properties: unknown;
        },
        spec,
        index,
      ),
    )
    .filter((record): record is FeatureRecord => record !== null);

  if (!features.length) {
    throw new DataError(`${spec.name} had no readable geometry`);
  }

  const result: ImportResult = {
    name: spec.name,
    features,
    crs: GEOGRAPHIC_CRS,
    format: "geojson",
    warnings: [],
  };

  decoded.set(key, result);
  return result;
}

/** Loads every layer of a product; one dataset is built from the results. */
export function loadLibraryProduct(product: LibraryProduct): Promise<ImportResult[]> {
  return Promise.all(product.layers.map(decodeLayer));
}
