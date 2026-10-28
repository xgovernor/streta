import { GEOGRAPHIC_CRS, normalizeCrsCode, transformGeometry } from "./crs";
import { dedupeIds, DataError, type ImportResult } from "./geojson";
import { parseWkt, serializeWkt, looksLikeWkt } from "./wkt";
import type {
  Attributes,
  FeatureRecord,
  Geometry,
  LayerFormat,
  Position,
} from "./types";

const X_ALIASES = [
  "x",
  "lon",
  "lng",
  "long",
  "longitude",
  "easting",
  "east",
  "xcoord",
  "x_coord",
  "x_coordinate",
  "lon_dd",
  "longitude_dd",
  "coord_x",
];

const Y_ALIASES = [
  "y",
  "lat",
  "latitude",
  "northing",
  "north",
  "ycoord",
  "y_coord",
  "y_coordinate",
  "lat_dd",
  "latitude_dd",
  "coord_y",
];

const WKT_ALIASES = ["wkt", "geom", "geometry", "the_geom", "shape", "wkb_geometry"];

export interface DelimitedTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
  warnings: string[];
}

/**
 * Splits delimited text into records of cells. A quote opens a field only at
 * the start of that field, so degree/minute/second values such as 47°22'37"N
 * survive unquoted — a lone inch mark is data, not a delimiter.
 */
function splitRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let index = 0;

  const endCell = () => {
    cells.push(cell);
    cell = "";
  };

  const endRecord = () => {
    endCell();
    records.push(cells);
    cells = [];
  };

  while (index < text.length) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }

        quoted = false;
        index += 1;
        continue;
      }

      cell += character;
      index += 1;
      continue;
    }

    if (character === '"' && cell === "") {
      quoted = true;
      index += 1;
      continue;
    }

    if (character === delimiter) {
      endCell();
      index += 1;
      continue;
    }

    if (character === "\r") {
      index += 1;
      continue;
    }

    if (character === "\n") {
      endRecord();
      index += 1;
      continue;
    }

    cell += character;
    index += 1;
  }

  if (cell !== "" || cells.length) {
    endRecord();
  }

  return records;
}

/** Picks the delimiter that yields the most columns in the header line. */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestColumns = 1;

  for (const candidate of [",", ";", "\t", "|"]) {
    const columns = splitRecords(firstLine, candidate)[0]?.length ?? 0;

    if (columns > bestColumns) {
      bestColumns = columns;
      best = candidate;
    }
  }

  return best;
}

export function parseDelimited(text: string, delimiter?: string): DelimitedTable {
  const resolved = delimiter ?? detectDelimiter(text);
  const warnings: string[] = [];
  const normalized = text.replace(/^\uFEFF/, "");
  const records = splitRecords(normalized, resolved).filter(
    (record) => record.some((cell) => cell.trim() !== ""),
  );

  if (records.length < 2) {
    throw new DataError("This file needs a header row and at least one data row");
  }

  const headers = records[0].map((cell, index) => {
    const name = cell.trim();
    return name || `field_${index + 1}`;
  });

  const seen = new Set<string>();
  let duplicates = 0;

  const uniqueHeaders = headers.map((name) => {
    let candidate = name;
    let suffix = 1;

    while (seen.has(candidate)) {
      suffix += 1;
      candidate = `${name}_${suffix}`;
    }

    if (candidate !== name) {
      duplicates += 1;
    }

    seen.add(candidate);
    return candidate;
  });

  if (duplicates > 0) {
    warnings.push(`${duplicates} duplicate column name${duplicates === 1 ? "" : "s"} were suffixed`);
  }

  return {
    headers: uniqueHeaders,
    rows: records.slice(1),
    delimiter: resolved,
    warnings,
  };
}

const DMS_PATTERN =
  /^([NSEW+-])?\s*(\d+(?:\.\d+)?)\s*(?:[°d:\s]\s*(\d+(?:\.\d+)?)\s*)?(?:['′m:\s]\s*(\d+(?:\.\d+)?)\s*)?["″s]?\s*([NSEW])?$/i;

/** Reads decimal, signed, or degrees-minutes-seconds coordinate text. */
export function parseCoordinate(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) {
    return null;
  }

  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null;
  }

  const raw = input.trim();

  if (!raw) {
    return null;
  }

  const plain = Number(raw);

  if (Number.isFinite(plain)) {
    return plain;
  }

  const match = raw.match(DMS_PATTERN);

  if (!match) {
    return null;
  }

  const [, prefix, degrees, minutes, seconds, suffix] = match;

  if (degrees === undefined) {
    return null;
  }

  const magnitude =
    Number(degrees) + Number(minutes ?? 0) / 60 + Number(seconds ?? 0) / 3600;

  if (!Number.isFinite(magnitude)) {
    return null;
  }

  const hemisphere = (suffix ?? prefix ?? "").toUpperCase();
  const negative = hemisphere === "S" || hemisphere === "W" || prefix === "-";

  return negative ? -magnitude : magnitude;
}

function findColumn(headers: string[], aliases: string[]): number {
  const normalized = headers.map((header) => header.trim().toLowerCase());

  for (const alias of aliases) {
    const index = normalized.indexOf(alias);
    if (index >= 0) {
      return index;
    }
  }

  for (const alias of aliases) {
    const index = normalized.findIndex((header) => header === alias.replace(/[_\s]/g, ""));
    if (index >= 0) {
      return index;
    }
  }

  return -1;
}

interface GeometryColumn {
  kind: "wkt";
  index: number;
}

interface CoordinateColumns {
  kind: "coordinates";
  x: number;
  y: number;
}

export type GeometrySource = GeometryColumn | CoordinateColumns;

/** Detects a WKT column first, then a coordinate pair, by header and content. */
export function detectGeometryColumns(table: DelimitedTable): GeometrySource | null {
  const wktIndex = findColumn(table.headers, WKT_ALIASES);

  if (wktIndex >= 0) {
    const sample = table.rows.find((row) => (row[wktIndex] ?? "").trim());

    if (sample && looksLikeWkt(sample[wktIndex])) {
      return { kind: "wkt", index: wktIndex };
    }
  }

  const x = findColumn(table.headers, X_ALIASES);
  const y = findColumn(table.headers, Y_ALIASES);

  if (x >= 0 && y >= 0) {
    return { kind: "coordinates", x, y };
  }

  return null;
}

const NUMERIC = /^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;

/** Reads one cell the way the CSV importer does: number, boolean, or text. */
export function parseAttributeValue(raw: string): Attributes[string] {
  const value = raw.trim();

  if (!value) {
    return null;
  }

  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;

  if (NUMERIC.test(value)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }

  return value;
}

export interface CsvImportOptions {
  /** CRS assumed when the file does not declare one. */
  crs: string;
  delimiter?: string;
  /** Forces the geometry source, used when detection picks the wrong pair. */
  geometry?: GeometrySource;
}

export function parseCsv(text: string, options: CsvImportOptions): ImportResult {
  const table = parseDelimited(text, options.delimiter);
  const source = options.geometry ?? detectGeometryColumns(table);
  const warnings = [...table.warnings];

  if (!source) {
    throw new DataError(
      "No geometry column found. Add a WKT column, or columns named x and y (lon/lat also work).",
    );
  }

  const geometryIndexes = new Set<number>(
    source.kind === "wkt" ? [source.index] : [source.x, source.y],
  );

  const features: FeatureRecord[] = [];
  let dropped = 0;

  table.rows.forEach((row, index) => {
    let geometry: Geometry | null = null;

    if (source.kind === "wkt") {
      const value = (row[source.index] ?? "").trim();

      if (!value || !looksLikeWkt(value)) {
        dropped += 1;
        return;
      }

      try {
        geometry = parseWkt(value);
      } catch (error) {
        dropped += 1;
        warnings.push(
          `Row ${index + 2}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
    } else {
      const x = parseCoordinate(row[source.x]);
      const y = parseCoordinate(row[source.y]);

      if (x === null || y === null) {
        dropped += 1;
        return;
      }

      geometry = { type: "Point" as const, coordinates: [x, y] as Position };
    }

    const properties: Attributes = {};

    table.headers.forEach((header, column) => {
      if (geometryIndexes.has(column)) {
        return;
      }

      properties[header] = parseAttributeValue(row[column] ?? "");
    });

    features.push({ id: `r${index + 1}`, geometry, properties });
  });

  if (dropped > 0) {
    warnings.push(
      `${dropped} row${dropped === 1 ? "" : "s"} had no usable geometry and were skipped`,
    );
  }

  if (!features.length) {
    throw new DataError("No row in this file held a usable geometry");
  }

  dedupeIds(features, warnings);

  return {
    features,
    crs: null,
    format: "csv",
    name: null,
    warnings,
  };
}

export interface CsvExportOptions {
  crs: string;
  delimiter?: string;
  /** Writes geometry as WKT (default) or as x/y columns. */
  geometry?: "wkt" | "xy";
  /** Fields to write; defaults to every field found in the data. */
  fields?: string[];
}

function cell(value: unknown, delimiter: string): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "number"
        ? String(Number(value.toFixed(9)))
        : String(value);

  if (text.includes(delimiter) || text.includes('"') || /[\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function toCsv(
  features: FeatureRecord[],
  fields: string[],
  options: CsvExportOptions,
): string {
  const delimiter = options.delimiter ?? ",";
  const crs = normalizeCrsCode(options.crs) ?? GEOGRAPHIC_CRS;
  const geometryColumn = options.geometry ?? "wkt";
  const headers =
    geometryColumn === "wkt" ? ["wkt", ...fields] : ["x", "y", ...fields];

  const lines = [headers.map((header) => cell(header, delimiter)).join(delimiter)];

  for (const feature of features) {
    const geometry =
      crs === GEOGRAPHIC_CRS
        ? feature.geometry
        : transformGeometry(feature.geometry, crs, GEOGRAPHIC_CRS);

    const values = fields.map((field) => feature.properties[field]);

    if (geometryColumn === "wkt") {
      values.unshift(serializeWkt(geometry));
    } else {
      const position = firstPosition(geometry);
      values.unshift(position ? position[1] ?? "" : "");
      values.unshift(position ? position[0] : "");
    }

    lines.push(values.map((value) => cell(value, delimiter)).join(delimiter));
  }

  return lines.join("\n");
}

function firstPosition(geometry: { coordinates: unknown }): Position | null {
  let found: Position | null = null;

  const walk = (value: unknown) => {
    if (found || !Array.isArray(value)) {
      return;
    }

    if (value.length > 0 && typeof value[0] === "number") {
      found = value as Position;
      return;
    }

    value.find((child) => {
      walk(child);
      return Boolean(found);
    });
  };

  walk(geometry.coordinates);
  return found;
}

export function layerFormatForFile(fileName: string): LayerFormat {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
    return "csv";
  }

  if (lower.endsWith(".wkt")) {
    return "wkt";
  }

  return "geojson";
}
