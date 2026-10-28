import { GEOGRAPHIC_CRS, normalizeCrsCode, transformGeometry } from "./crs";
import { positionsAreFinite } from "./geometry";
import type { Attributes, FeatureRecord, Geometry, LayerFormat } from "./types";

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}

export interface ImportResult {
  features: FeatureRecord[];
  /** CRS declared by the file itself, when it carries one. */
  crs: string | null;
  format: LayerFormat;
  /** Suggested layer name, from the file's `name` member or the source name. */
  name: string | null;
  warnings: string[];
}

const CRS_MEMBER_MISSING = [
  "urn:ogc:def:crs:OGC:1.3:CRS84",
  "urn:ogc:def:crs:OGC::CRS84",
  "CRS84",
  "OGC:CRS84",
];

export function readGeoJsonCrs(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const member = value as Record<string, unknown>;

  if (member.type === "name" || member.type === undefined) {
    const properties = member.properties as Record<string, unknown> | undefined;
    const name = properties?.name ?? member.name ?? member.code;

    if (typeof name === "string") {
      if (CRS_MEMBER_MISSING.includes(name.trim())) {
        return GEOGRAPHIC_CRS;
      }

      return normalizeCrsCode(name);
    }
  }

  return null;
}

function toAttributes(value: unknown): Attributes {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const attributes: Attributes = {};

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === null || raw === undefined) {
      attributes[key] = null;
    } else if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
    ) {
      attributes[key] = raw;
    } else {
      attributes[key] = JSON.stringify(raw);
    }
  }

  return attributes;
}

const KNOWN_GEOMETRY_TYPES = new Set([
  "Point",
  "LineString",
  "Polygon",
  "MultiPoint",
  "MultiLineString",
  "MultiPolygon",
]);

function toGeometry(value: unknown): Geometry | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as { type?: unknown; coordinates?: unknown };

  if (typeof candidate.type !== "string" || !KNOWN_GEOMETRY_TYPES.has(candidate.type)) {
    return null;
  }

  const geometry = { type: candidate.type, coordinates: candidate.coordinates } as Geometry;

  return positionsAreFinite(geometry) ? geometry : null;
}

/**
 * Parses GeoJSON (RFC 7946) into features, tolerating the older `crs` member
 * and bare geometry objects. Broken members are dropped with a warning rather
 * than failing the whole import.
 */
export function parseGeoJson(text: string): ImportResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new DataError(
      `This file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return importGeoJsonValue(parsed);
}

/**
 * Reads an already-parsed document. Shapefiles and GeoPackages produce the same
 * shape as GeoJSON, so they come through here too: one code path owns geometry
 * validation, feature ids and attribute coercion for every vector source.
 */
export function importGeoJsonValue(
  parsed: unknown,
  options: { format?: LayerFormat; fallbackName?: string | null } = {},
): ImportResult {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DataError("GeoJSON must be an object, not an array");
  }

  const document = parsed as Record<string, unknown>;
  const warnings: string[] = [];
  const features: FeatureRecord[] = [];
  let crs: string | null = readGeoJsonCrs(document.crs);

  const push = (value: unknown, index: number): void => {
    if (typeof value !== "object" || value === null) {
      warnings.push(`Feature ${index + 1} is not an object and was skipped`);
      return;
    }

    const member = value as Record<string, unknown>;
    const geometry = toGeometry(member.geometry);

    if (!geometry) {
      warnings.push(
        member.geometry
          ? `Feature ${index + 1} has a geometry this reader does not support and was skipped`
          : `Feature ${index + 1} has no geometry and was skipped`,
      );
      return;
    }

    const rawId = member.id ?? (member.properties as Record<string, unknown>)?.id;
    const id =
      typeof rawId === "string" || typeof rawId === "number"
        ? String(rawId)
        : `f${index + 1}`;

    features.push({
      id,
      geometry,
      properties: toAttributes(member.properties),
    });
  };

  if (document.type === "FeatureCollection") {
    const collection = document.features;

    if (!Array.isArray(collection)) {
      throw new DataError("FeatureCollection has no features array");
    }

    collection.forEach(push);
  } else if (document.type === "Feature") {
    push(document, 0);
  } else if (typeof document.type === "string" && KNOWN_GEOMETRY_TYPES.has(document.type)) {
    // A bare geometry is accepted and wrapped into a single feature.
    const geometry = toGeometry(document);

    if (!geometry) {
      throw new DataError("The geometry has non-numeric coordinates");
    }

    features.push({ id: "f1", geometry, properties: {} });
  } else {
    throw new DataError(
      `Unsupported GeoJSON type "${String(document.type ?? "unknown")}"`,
    );
  }

  if (!features.length) {
    throw new DataError("No usable features were found in this file");
  }

  dedupeIds(features, warnings);

  return {
    features,
    crs,
    format: options.format ?? "geojson",
    name: readTitle(document) ?? options.fallbackName ?? null,
    warnings,
  };
}

function readTitle(document: Record<string, unknown>): string | null {
  const name = document.name ?? document.title ?? document.id;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/** Feature ids must be unique inside a layer: the map and table key off them. */
export function dedupeIds(features: FeatureRecord[], warnings: string[]): void {
  const seen = new Set<string>();
  let renamed = 0;

  for (const [index, feature] of features.entries()) {
    if (!seen.has(feature.id)) {
      seen.add(feature.id);
      continue;
    }

    let candidate = `${feature.id}-${index + 1}`;
    let suffix = 1;

    while (seen.has(candidate)) {
      suffix += 1;
      candidate = `${feature.id}-${index + 1}-${suffix}`;
    }

    feature.id = candidate;
    seen.add(candidate);
    renamed += 1;
  }

  if (renamed > 0) {
    warnings.push(`${renamed} duplicate feature id${renamed === 1 ? "" : "s"} were renumbered`);
  }
}

export interface GeoJsonOptions {
  /** CRS the features are stored in; output is reprojected to this CRS. */
  crs: string;
  name: string;
}

/**
 * Writes RFC 7946 GeoJSON. The spec fixes the CRS at WGS 84, so coordinates are
 * always reprojected to EPSG:4326 on the way out.
 */
export function toGeoJson(
  features: FeatureRecord[],
  options: GeoJsonOptions,
): string {
  const crs = normalizeCrsCode(options.crs) ?? GEOGRAPHIC_CRS;

  return JSON.stringify(
    {
      type: "FeatureCollection",
      name: options.name,
      features: features.map((feature) => ({
        type: "Feature",
        id: feature.id,
        geometry:
          crs === GEOGRAPHIC_CRS
            ? feature.geometry
            : transformGeometry(feature.geometry, crs, GEOGRAPHIC_CRS),
        properties: feature.properties,
      })),
    },
    null,
    2,
  );
}

export function guessFormat(fileName: string, text: string): LayerFormat {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".json") || lower.endsWith(".geojson")) {
    return "geojson";
  }

  const head = text.slice(0, 400).trimStart();

  if (head.startsWith("{") || head.startsWith("[")) {
    return "geojson";
  }

  return "csv";
}

export function layerNameFromFile(fileName: string): string {
  return fileName
    .replace(/^.*[\\/]/, "")
    .replace(/\.(geojson|json|csv|tsv|txt|wkt)$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
}
