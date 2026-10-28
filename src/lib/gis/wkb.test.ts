import { describe, expect, test } from "bun:test";
import { readWkb, WkbError } from "./wkb";

/** Little-endian writer, mirroring how GeoPackage blobs are laid out. */
function build(write: (view: DataView, bytes: Uint8Array) => void, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  write(new DataView(bytes.buffer), bytes);
  return bytes;
}

describe("readWkb", () => {
  test("reads a little-endian point", () => {
    const buffer = build((view) => {
      view.setUint8(0, 1);
      view.setUint32(1, 1, true);
      view.setFloat64(5, 90.4, true);
      view.setFloat64(13, 23.78, true);
    }, 21);

    expect(readWkb(buffer).geometry).toEqual({
      type: "Point",
      coordinates: [90.4, 23.78],
    });
  });

  test("reads a big-endian point", () => {
    const buffer = build((view) => {
      view.setUint8(0, 0);
      view.setUint32(1, 1, false);
      view.setFloat64(5, 90.4, false);
      view.setFloat64(13, 23.78, false);
    }, 21);

    expect(readWkb(buffer).geometry).toEqual({
      type: "Point",
      coordinates: [90.4, 23.78],
    });
  });

  test("keeps Z and drops M", () => {
    const z = build((view) => {
      view.setUint8(0, 1);
      view.setUint32(1, 1001, true);
      view.setFloat64(5, 1, true);
      view.setFloat64(13, 2, true);
      view.setFloat64(21, 3, true);
    }, 29);

    const zm = build((view) => {
      view.setUint8(0, 1);
      view.setUint32(1, 3001, true);
      view.setFloat64(5, 1, true);
      view.setFloat64(13, 2, true);
      view.setFloat64(21, 3, true);
      view.setFloat64(29, 4, true);
    }, 37);

    expect(readWkb(z).geometry.coordinates).toEqual([1, 2, 3]);
    expect(readWkb(zm).geometry.coordinates).toEqual([1, 2, 3]);
  });

  test("reads a polygon with a ring", () => {
    const buffer = build((view) => {
      let offset = 0;
      view.setUint8(offset, 1);
      offset += 1;
      view.setUint32(offset, 3, true);
      offset += 4;
      view.setUint32(offset, 1, true);
      offset += 4;
      view.setUint32(offset, 4, true);
      offset += 4;

      for (const [x, y] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ]) {
        view.setFloat64(offset, x, true);
        view.setFloat64(offset + 8, y, true);
        offset += 16;
      }
    }, 9 + 4 + 64);

    expect(readWkb(buffer).geometry).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    });
  });

  test("reads nested multi geometries, as OGC WKB nests them", () => {
    const buffer = build((view) => {
      let offset = 0;
      const u32 = (value: number) => {
        view.setUint32(offset, value, true);
        offset += 4;
      };
      const point = (x: number, y: number) => {
        view.setUint8(offset, 1);
        offset += 1;
        u32(1);
        view.setFloat64(offset, x, true);
        view.setFloat64(offset + 8, y, true);
        offset += 16;
      };

      view.setUint8(offset, 1);
      offset += 1;
      u32(4);
      u32(2);
      point(1, 1);
      point(2, 2);
    }, 9 + 4 + 42);

    expect(readWkb(buffer).geometry).toEqual({
      type: "MultiPoint",
      coordinates: [
        [1, 1],
        [2, 2],
      ],
    });
  });

  test("reads flat multi geometries, as some writers emit them", () => {
    const buffer = build((view) => {
      let offset = 0;
      view.setUint8(offset, 1);
      offset += 1;
      view.setUint32(offset, 4, true);
      offset += 4;
      view.setUint32(offset, 2, true);
      offset += 4;

      for (const [x, y] of [
        [1, 1],
        [2, 2],
      ]) {
        view.setFloat64(offset, x, true);
        view.setFloat64(offset + 8, y, true);
        offset += 16;
      }
    }, 9 + 32);

    expect(readWkb(buffer).geometry).toEqual({
      type: "MultiPoint",
      coordinates: [
        [1, 1],
        [2, 2],
      ],
    });
  });

  test("reports an unsupported geometry type", () => {
    const buffer = build((view) => {
      view.setUint8(0, 1);
      view.setUint32(1, 17, true);
    }, 5);

    expect(() => readWkb(buffer)).toThrow(WkbError);
  });

  test("reports an unknown byte order", () => {
    const buffer = build((view) => {
      view.setUint8(0, 7);
      view.setUint32(1, 1, true);
    }, 5);

    expect(() => readWkb(buffer)).toThrow(/byte order/);
  });
});
