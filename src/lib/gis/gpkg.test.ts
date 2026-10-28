import { describe, expect, test } from "bun:test";
import initSqlJs from "sql.js";
import { parseGeoPackage, readGeoPackageGeometry } from "./gpkg";

/** GeoPackage header (magic, version, flags, srs id) plus a WKB point. */
function geometryBlob(srsId: number, x: number, y: number, flags = 0x01): Uint8Array {
  const bytes = new Uint8Array(8 + 21);
  const view = new DataView(bytes.buffer);

  view.setUint8(0, 0x47);
  view.setUint8(1, 0x50);
  view.setUint8(2, 0);
  view.setUint8(3, flags);
  view.setInt32(4, srsId, true);
  view.setUint8(8, 1);
  view.setUint32(9, 1, true);
  view.setFloat64(13, x, true);
  view.setFloat64(21, y, true);

  return bytes;
}

describe("readGeoPackageGeometry", () => {
  test("skips the header and reads the WKB payload", () => {
    const decoded = readGeoPackageGeometry(geometryBlob(4326, 90.4, 23.78));

    expect(decoded.srsId).toBe(4326);
    expect(decoded.geometry).toEqual({ type: "Point", coordinates: [90.4, 23.78] });
  });

  test("skips an XY envelope when the flags declare one", () => {
    const withEnvelope = new Uint8Array(8 + 32 + 21);
    withEnvelope.set(geometryBlob(4326, 90.4, 23.78), 0);
    withEnvelope.set(geometryBlob(4326, 90.4, 23.78).subarray(8, 29), 8 + 32);

    // flags: little endian, envelope code 1 (XY), so 32 bytes of envelope.
    new DataView(withEnvelope.buffer).setUint8(3, 0x01 | 0x02);

    expect(readGeoPackageGeometry(withEnvelope).geometry).toEqual({
      type: "Point",
      coordinates: [90.4, 23.78],
    });
  });

  test("rejects a blob without the magic number", () => {
    expect(() => readGeoPackageGeometry(new Uint8Array(16))).toThrow(/magic/);
  });

  test("rejects a blob that declares an envelope it does not carry", () => {
    const bytes = new Uint8Array(12);
    bytes.set([0x47, 0x50, 0, 0x03]);
    new DataView(bytes.buffer).setInt32(4, 4326, true);

    expect(() => readGeoPackageGeometry(bytes)).toThrow(/envelope/);
  });
});

/**
 * Builds a real GeoPackage in memory with SQLite, then reads it back through the
 * app's reader. This is the only way to exercise the SQLite path without
 * shipping a fixture.
 */
async function buildFixture(): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT, srs_id INTEGER PRIMARY KEY, organization TEXT, organization_coordsys_id INTEGER, definition TEXT, description TEXT);
    CREATE TABLE gpkg_geometry_columns (table_name TEXT, column_name TEXT, geometry_type_name TEXT, srs_id INTEGER, z INTEGER, m INTEGER);
    CREATE TABLE gpkg_contents (table_name TEXT, data_type TEXT, identifier TEXT, srs_id INTEGER);
    CREATE TABLE districts (fid INTEGER PRIMARY KEY, geom BLOB, ADM2_PCODE TEXT, ADM2_NAME TEXT);
    CREATE TABLE places (fid INTEGER PRIMARY KEY, geom BLOB);
  `);

  db.run(
    "INSERT INTO gpkg_spatial_ref_sys VALUES ('WGS 84', 4326, 'EPSG', 4326, 'GEOGCS[...]', '')",
  );
  db.run("INSERT INTO gpkg_geometry_columns VALUES ('districts', 'geom', 'POINT', 4326, 0, 0)");
  db.run("INSERT INTO gpkg_geometry_columns VALUES ('places', 'geom', 'POINT', 4326, 0, 0)");

  db.run("INSERT INTO districts VALUES (1, ?, 'BD1004', 'Barguna')", [
    geometryBlob(4326, 90.4, 23.78),
  ]);
  db.run("INSERT INTO districts VALUES (2, ?, 'BD1009', 'Bhola')", [
    geometryBlob(4326, 90.65, 22.69),
  ]);
  // A row with no geometry has to be skipped rather than crash the import.
  db.run("INSERT INTO districts VALUES (3, NULL, 'BD9999', 'Nowhere')");

  return db.export();
}

describe("parseGeoPackage", () => {
  test("reads the layer, its CRS and its attributes", async () => {
    const result = await parseGeoPackage(await buildFixture());

    expect(result.format).toBe("gpkg");
    expect(result.crs).toBe("EPSG:4326");
    expect(result.name).toBe("districts");
    expect(result.features).toHaveLength(2);
    expect(result.features[0].id).toBe("1");
    expect(result.features[0].properties.ADM2_NAME).toBe("Barguna");
    expect(result.warnings.join(" ")).toMatch(/no geometry/);
    expect(result.warnings.join(" ")).toMatch(/2 layers/);
  });

  test("refuses a database with no geometry columns", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();

    db.run(
      "CREATE TABLE gpkg_geometry_columns (table_name TEXT, column_name TEXT, geometry_type_name TEXT, srs_id INTEGER, z INTEGER, m INTEGER)",
    );

    await expect(parseGeoPackage(db.export())).rejects.toThrow(/no geometry/);
  });
});
