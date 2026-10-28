import { describe, expect, test } from "bun:test";
import { looksLikeZip, readShapefileSet, type ShapefileParts } from "./shapefile";

/** Minimal .shp writer: file header plus point records. */
const RECORD_BYTES = 28; // record header (8) + shape type (4) + x and y (16)

function writeShp(points: number[][]): Uint8Array {
  const recordBytes = points.length * RECORD_BYTES;
  const bytes = new Uint8Array(100 + recordBytes);
  const view = new DataView(bytes.buffer);

  view.setInt32(0, 9994, false);
  view.setInt32(24, (100 + recordBytes) / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 1, true);

  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);

  view.setFloat64(36, Math.min(...lons), true);
  view.setFloat64(44, Math.min(...lats), true);
  view.setFloat64(52, Math.max(...lons), true);
  view.setFloat64(60, Math.max(...lats), true);

  points.forEach((point, index) => {
    const offset = 100 + index * RECORD_BYTES;
    view.setInt32(offset, index + 1, false);
    view.setInt32(offset + 4, 10, false);
    view.setInt32(offset + 8, 1, true);
    view.setFloat64(offset + 12, point[0], true);
    view.setFloat64(offset + 20, point[1], true);
  });

  return bytes;
}

interface Field {
  name: string;
  type: "C" | "N";
  length: number;
}

/** Minimal .dbf writer, enough to prove attributes reach the layer. */
function writeDbf(fields: Field[], rows: string[][]): Uint8Array {
  const recordLength = 1 + fields.reduce((total, field) => total + field.length, 0);
  const headerLength = 32 + fields.length * 32 + 1;
  const bytes = new Uint8Array(headerLength + rows.length * recordLength);
  const view = new DataView(bytes.buffer);

  view.setUint8(0, 0x03);
  view.setInt32(4, rows.length, true);
  view.setInt16(8, headerLength, true);
  view.setInt16(10, recordLength, true);

  fields.forEach((field, index) => {
    const offset = 32 + index * 32;

    for (const [position, character] of [...field.name].entries()) {
      view.setUint8(offset + position, character.charCodeAt(0));
    }

    view.setUint8(offset + 11, field.type.charCodeAt(0));
    view.setUint8(offset + 16, field.length);
  });

  view.setUint8(headerLength - 1, 0x0d);

  rows.forEach((row, rowIndex) => {
    let offset = headerLength + rowIndex * recordLength;
    view.setUint8(offset, 0x20);
    offset += 1;

    fields.forEach((field, fieldIndex) => {
      const value = (row[fieldIndex] ?? "").slice(0, field.length);

      for (let index = 0; index < field.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index) || 0x20);
      }

      offset += field.length;
    });
  });

  return bytes;
}

describe("shapefile import", () => {
  test("reads a loose set with attributes", () => {
    const parts: ShapefileParts = {
      shp: writeShp([
        [90.4, 23.78],
        [91.8, 22.35],
      ]),
      dbf: writeDbf(
        [
          { name: "ADM2_PCODE", type: "C", length: 8 },
          { name: "POP", type: "N", length: 6 },
        ],
        [
          ["BD1004", "898288"],
          ["BD2031", "123456"],
        ],
      ),
    };

    const result = readShapefileSet({ name: "districts", parts });

    expect(result.format).toBe("shapefile");
    expect(result.features).toHaveLength(2);
    expect(result.features[0].geometry).toEqual({
      type: "Point",
      coordinates: [90.4, 23.78],
    });
    expect(result.features[0].properties).toEqual({ ADM2_PCODE: "BD1004", POP: 898288 });
    expect(result.crs).toBeNull();
    expect(result.warnings.join(" ")).toMatch(/No \.prj/);
  });

  test("keeps geometry when no .dbf was selected, and says so", () => {
    const result = readShapefileSet({
      name: "routes",
      parts: { shp: writeShp([[90.4, 23.78]]) },
    });

    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties).toEqual({});
    expect(result.warnings.join(" ")).toMatch(/No \.dbf/);
  });

  test("rejects a set without a .shp", () => {
    expect(() => readShapefileSet({ name: "empty", parts: {} })).toThrow(/\.shp/);
  });

  test("recognises a zip container", () => {
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true);
    expect(looksLikeZip(new Uint8Array([0x00, 0x00, 0x27, 0x0a]))).toBe(false);
    expect(looksLikeZip(new Uint8Array([]))).toBe(false);
  });
});
