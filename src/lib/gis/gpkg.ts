import type { SqlJsDatabase, SqlJsStatic } from "sql.js";
import { GEOGRAPHIC_CRS, hasCrs } from "./crs";
import { DataError, importGeoJsonValue, type ImportResult } from "./geojson";
import type { Attributes, FeatureRecord, Geometry } from "./types";
import { readWkb } from "./wkb";

/**
 * GeoPackage is a SQLite database, so reading one needs a SQLite engine. The
 * WebAssembly build is loaded on first use — a `.gpkg` in the file picker is the
 * only thing that pulls it in, which keeps the ordinary app bundle as it was.
 *
 * Geometry blobs carry a GeoPackage header (magic, flags, srs id, optional
 * envelope) in front of the WKB payload, and the layer's CRS lives in
 * `gpkg_spatial_ref_sys` as an EPSG code and a WKT definition.
 */

let engine: Promise<SqlJsStatic> | null = null;

async function loadEngine(): Promise<SqlJsStatic> {
  engine ??= (async () => {
    const [sqlModule, wasm] = await Promise.all([
      import("sql.js"),
      import("sql.js/dist/sql-wasm.wasm?url"),
    ]);
    const initSqlJs = (sqlModule.default ?? sqlModule) as typeof sqlModule.default;

    return initSqlJs({ locateFile: () => wasm.default });
  })();

  return engine;
}

/** Bytes of envelope carried by each flag value in the geometry header. */
const ENVELOPE_BYTES: Record<number, number> = { 0: 0, 1: 32, 2: 48, 3: 48, 4: 64 };

interface RawGeometry {
  geometry: Geometry;
  srsId: number;
}

/**
 * Decodes one GeoPackage geometry blob: its header, then the WKB payload.
 * Exported because it is the part worth testing on its own.
 */
export function readGeoPackageGeometry(blob: Uint8Array): RawGeometry {
  if (blob.length < 8) {
    throw new DataError("A geometry blob is too short to hold a GeoPackage header");
  }

  if (blob[0] !== 0x47 || blob[1] !== 0x50) {
    throw new DataError("A geometry blob is missing the GeoPackage magic number");
  }

  const flags = blob[3];
  const little = (flags & 0x01) === 1;
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const srsId = view.getInt32(4, little);
  const headerLength = 8 + (ENVELOPE_BYTES[(flags >> 1) & 0x07] ?? 0);

  if (headerLength >= blob.length) {
    throw new DataError("A geometry blob declares an envelope it does not carry");
  }

  return { geometry: readWkb(blob, headerLength).geometry, srsId };
}

interface GeometryTable {
  table: string;
  column: string;
  srsId: number;
}

function geometryColumns(db: SqlJsDatabase): GeometryTable[] {
  const result = db.exec(
    "SELECT table_name, column_name, srs_id FROM gpkg_geometry_columns",
  );

  if (!result.length) {
    throw new DataError(
      "That GeoPackage declares no geometry columns, so it holds no vector layer",
    );
  }

  return result[0].values.map((row) => ({
    table: String(row[0]),
    column: String(row[1]),
    srsId: Number(row[2]),
  }));
}

/** The layer's CRS, as the EPSG code the rest of the app understands. */
function layerCrs(db: SqlJsDatabase, srsId: number): string | null {
  const statement = db.prepare(
    "SELECT organization, organization_coordsys_id, definition FROM gpkg_spatial_ref_sys WHERE srs_id = ?",
  );

  let organisation = "";
  let code = 0;

  try {
    statement.bind([srsId]);

    if (statement.step()) {
      const row = statement.get();
      organisation = String(row[0] ?? "");
      code = Number(row[1] ?? 0);
    }
  } finally {
    statement.free();
  }

  if (organisation.toUpperCase() === "EPSG" && Number.isFinite(code) && code > 0) {
    return `EPSG:${code}`;
  }

  // srs_id 0 and -1 mean "undefined"; the importer falls back to WGS 84 and says so.
  return null;
}

function toAttributeValue(value: unknown): Attributes[string] {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return `<${value.length} bytes>`;
  }

  return String(value);
}

/**
 * GeoPackage tables key their rows on an integer primary key. The conventional
 * names cover the writers this app is likely to meet; anything else falls back
 * to the row number.
 */
function idColumn(columns: string[]): string | null {
  for (const candidate of ["fid", "id", "ogc_fid", "objectid"]) {
    const match = columns.find((column) => column.toLowerCase() === candidate);

    if (match) {
      return match;
    }
  }

  // "fid" is the SQLite-ism GPKG mandates; otherwise take the first integer key.
  return null;
}

export async function parseGeoPackage(bytes: Uint8Array): Promise<ImportResult> {
  if (bytes.length < 16) {
    throw new DataError("That file is too small to be a GeoPackage");
  }

  const SQL = await loadEngine();
  const db = new SQL.Database(bytes);

  try {
    const tables = geometryColumns(db);
    const [table, ...others] = tables;
    const warnings: string[] = [];

    if (others.length) {
      warnings.push(
        `That GeoPackage holds ${tables.length} layers; imported “${table.table}” — the others are ${others.map((item) => `“${item.table}”`).join(", ")}`,
      );
    }

    const statement = db.prepare(`SELECT * FROM "${table.table.replace(/"/g, '""')}"`);
    const features: FeatureRecord[] = [];
    let skipped = 0;

    try {
      const columns = statement.getColumnNames();
      const geometryIndex = columns.indexOf(table.column);
      const idIndex = (() => {
        const name = idColumn(columns);
        return name ? columns.indexOf(name) : -1;
      })();
      const srsSeen = new Set<number>();

      while (statement.step()) {
        const row = statement.get();
        const blob = geometryIndex >= 0 ? row[geometryIndex] : null;

        if (!(blob instanceof Uint8Array) || blob.length === 0) {
          skipped += 1;
          continue;
        }

        let parsed: RawGeometry;

        try {
          parsed = readGeoPackageGeometry(blob);
        } catch {
          skipped += 1;
          continue;
        }

        srsSeen.add(parsed.srsId);

        const properties: Attributes = {};

        for (const [index, column] of columns.entries()) {
          if (index === geometryIndex) {
            continue;
          }

          properties[column] = toAttributeValue(row[index]);
        }

        const rawId = idIndex >= 0 ? row[idIndex] : null;
        const id =
          typeof rawId === "number" || typeof rawId === "string"
            ? String(rawId)
            : `r${features.length + 1}`;

        features.push({ id, geometry: parsed.geometry, properties });
      }
    } finally {
      statement.free();
    }

    if (!features.length) {
      throw new DataError(`“${table.table}” holds no geometry this reader understands`);
    }

    if (skipped > 0) {
      warnings.push(`${skipped} row${skipped === 1 ? "" : "s"} had no geometry and were skipped`);
    }

    const declared = layerCrs(db, table.srsId);
    const crs = declared && hasCrs(declared) ? declared : GEOGRAPHIC_CRS;

    if (!declared) {
      warnings.push(
        `The GeoPackage does not name a known projection for “${table.table}”, so it was read as ${GEOGRAPHIC_CRS}. Set the layer projection if it is projected.`,
      );
    } else if (!hasCrs(declared)) {
      warnings.push(
        `The GeoPackage declares ${declared}, which is not in the projection registry, so it was read as ${GEOGRAPHIC_CRS}.`,
      );
    }

    const result = importGeoJsonValue(
      {
        type: "FeatureCollection",
        name: table.table,
        features: features.map((feature) => ({
          type: "Feature",
          id: feature.id,
          geometry: feature.geometry,
          properties: feature.properties,
        })),
      },
      { format: "gpkg", fallbackName: table.table },
    );

    return { ...result, crs, warnings: [...warnings, ...result.warnings] };
  } finally {
    db.close();
  }
}
