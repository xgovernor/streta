import { parseDelimited, parseAttributeValue } from "./csv";
import { DataError } from "./geojson";
import type { Attributes, DatasetLayer, FeatureRecord } from "./types";

/**
 * Attribute join. Census and flood tables arrive as rows keyed by an
 * administrative code (`ADM2_PCODE`) or a name, with no geometry of their own;
 * boundary layers carry the geometry and the same key. Matching them produces a
 * layer whose features hold the boundary shape plus the table's columns.
 */

export interface JoinTable {
  name: string;
  headers: string[];
  rows: string[][];
  warnings: string[];
}

export interface JoinPreview {
  rows: number;
  /** Table rows whose key matches a feature. */
  matchedRows: number;
  /** Features that will receive table values. */
  matchedFeatures: number;
  features: number;
  /** Sample of keys that matched nothing, for the panel to show. */
  unmatchedSample: string[];
}

export interface JoinOutcome {
  features: FeatureRecord[];
  preview: JoinPreview;
  /** Columns where the table replaced a value the layer already had. */
  replacedColumns: string[];
  warnings: string[];
}

/** Reads a delimited file that carries attributes but no geometry. */
export function parseJoinTable(text: string, name: string): JoinTable {
  const table = parseDelimited(text);

  if (!table.rows.length) {
    throw new DataError("That table has no data rows");
  }

  if (!table.headers.length) {
    throw new DataError("That table has no header row");
  }

  return {
    name,
    headers: table.headers,
    rows: table.rows,
    warnings: table.warnings,
  };
}

/**
 * Keys are compared case-insensitively and without surrounding space, because
 * the same code is written `BD1004`, `bd1004` and ` BD1004 ` across sources.
 */
export function normalizeJoinKey(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim().toLowerCase();
}

function tableIndex(table: JoinTable, keyColumn: string): number {
  const index = table.headers.indexOf(keyColumn);

  if (index < 0) {
    throw new DataError(`“${keyColumn}” is not a column in ${table.name}`);
  }

  return index;
}

function rowValues(table: JoinTable, row: string[]): Attributes {
  const values: Attributes = {};

  for (const [index, header] of table.headers.entries()) {
    values[header] = parseAttributeValue(row[index] ?? "");
  }

  return values;
}

/** Counts the match before anything is built, so the panel can show it. */
export function previewJoin(
  layer: DatasetLayer,
  table: JoinTable,
  keyColumn: string,
  targetField: string,
): JoinPreview {
  const index = tableIndex(table, keyColumn);
  const keys = new Set<string>();
  let blank = 0;

  for (const row of table.rows) {
    const key = normalizeJoinKey(row[index]);

    if (!key) {
      blank += 1;
      continue;
    }

    keys.add(key);
  }

  const featureKeys = new Set<string>();

  for (const feature of layer.features) {
    const key = normalizeJoinKey(feature.properties[targetField]);

    if (key) {
      featureKeys.add(key);
    }
  }

  const matchedRows = [...keys].filter((key) => featureKeys.has(key)).length;
  const unmatchedSample = [...keys]
    .filter((key) => !featureKeys.has(key))
    .slice(0, 5);

  void blank;

  return {
    rows: table.rows.length,
    matchedRows,
    matchedFeatures: layer.features.filter((feature) =>
      keys.has(normalizeJoinKey(feature.properties[targetField])),
    ).length,
    features: layer.features.length,
    unmatchedSample,
  };
}

export function joinTable(
  layer: DatasetLayer,
  table: JoinTable,
  keyColumn: string,
  targetField: string,
): JoinOutcome {
  const index = tableIndex(table, keyColumn);
  const warnings: string[] = [];
  const byKey = new Map<string, string[]>();
  let blank = 0;
  let duplicates = 0;

  for (const row of table.rows) {
    const key = normalizeJoinKey(row[index]);

    if (!key) {
      blank += 1;
      continue;
    }

    if (byKey.has(key)) {
      duplicates += 1;
    }

    byKey.set(key, row);
  }

  if (blank > 0) {
    warnings.push(
      `${blank} row${blank === 1 ? "" : "s"} in ${table.name} have an empty key and were not joined`,
    );
  }

  if (duplicates > 0) {
    warnings.push(
      `${duplicates} key${duplicates === 1 ? "" : "s"} appear more than once in ${table.name}; the last row was used`,
    );
  }

  const replaced = new Set<string>();
  const features: FeatureRecord[] = [];

  for (const feature of layer.features) {
    const row = byKey.get(normalizeJoinKey(feature.properties[targetField]));

    if (!row) {
      features.push({ ...feature, properties: { ...feature.properties } });
      continue;
    }

    const values = rowValues(table, row);
    const properties: Attributes = { ...feature.properties };

    for (const [column, value] of Object.entries(values)) {
      if (column in properties && properties[column] !== null) {
        replaced.add(column);
      }

      properties[column] = value;
    }

    features.push({ ...feature, properties });
  }

  const preview = previewJoin(layer, table, keyColumn, targetField);

  if (preview.matchedFeatures === 0) {
    throw new DataError(
      `No row in ${table.name} matched “${targetField}”. Check that both sides use the same key.`,
    );
  }

  if (preview.unmatchedSample.length) {
    warnings.push(
      `Keys with no matching feature: ${preview.unmatchedSample.join(", ")}${preview.matchedRows < new Set(table.rows.map((row) => normalizeJoinKey(row[index]))).size ? " …" : ""}`,
    );
  }

  return {
    features,
    preview,
    replacedColumns: [...replaced],
    warnings,
  };
}
