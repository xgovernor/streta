import { describe, expect, test } from "bun:test";
import { looksLikeWkt, parseWkt, serializeWkt, WktError } from "./wkt";

describe("parseWkt", () => {
  test("reads points, including Z and M dimensions", () => {
    expect(parseWkt("POINT (30 10)")).toEqual({
      type: "Point",
      coordinates: [30, 10],
    });
    expect(parseWkt("point z (1 2 3)")).toEqual({
      type: "Point",
      coordinates: [1, 2, 3],
    });
    // An M ordinate is not a Z ordinate: it is dropped.
    expect(parseWkt("POINT M (1 2 3)")).toEqual({
      type: "Point",
      coordinates: [1, 2],
    });
    expect(parseWkt("POINT ZM (1 2 3 4)")).toEqual({
      type: "Point",
      coordinates: [1, 2, 3],
    });
  });

  test("reads linestrings and polygons with holes", () => {
    expect(parseWkt("LINESTRING (0 0, 1 1, 2 2)").coordinates).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);

    const polygon = parseWkt(
      "POLYGON ((0 0, 4 0, 4 4, 0 4, 0 0), (1 1, 2 1, 2 2, 1 1))",
    );

    expect(polygon.type).toBe("Polygon");
    expect((polygon.coordinates as number[][][]).length).toBe(2);
    expect((polygon.coordinates as number[][][])[1].length).toBe(4);
  });

  test("reads both multipoint spellings", () => {
    expect(parseWkt("MULTIPOINT (10 40, 40 30)").coordinates).toEqual([
      [10, 40],
      [40, 30],
    ]);
    expect(parseWkt("MULTIPOINT ((10 40), (40 30))").coordinates).toEqual([
      [10, 40],
      [40, 30],
    ]);
  });

  test("reads multilines and multipolygons", () => {
    expect(
      parseWkt("MULTILINESTRING ((0 0, 1 1), (2 2, 3 3))").coordinates,
    ).toEqual([
      [
        [0, 0],
        [1, 1],
      ],
      [
        [2, 2],
        [3, 3],
      ],
    ]);

    const multiPolygon = parseWkt(
      "MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5), (5.2 5.2, 5.4 5.2, 5.4 5.4, 5.2 5.2)))",
    );
    const polygons = multiPolygon.coordinates as number[][][][];

    expect(multiPolygon.type).toBe("MultiPolygon");
    expect(polygons.length).toBe(2);
    expect(polygons[0].length).toBe(1);
    expect(polygons[1].length).toBe(2);
  });

  test("reads EMPTY geometry", () => {
    expect(parseWkt("POLYGON EMPTY")).toEqual({
      type: "Polygon",
      coordinates: [],
    });
    expect(parseWkt("POINT EMPTY").coordinates).toEqual([]);
  });

  test("rejects malformed input with a readable message", () => {
    expect(() => parseWkt("GEOMETRYCOLLECTION (POINT (0 0))")).toThrow(WktError);
    expect(() => parseWkt("CIRCLE (0 0 5)")).toThrow(/Unsupported WKT type/);
    expect(() => parseWkt("POINT (1 2) trailing")).toThrow(/Trailing content/);
    expect(() => parseWkt("LINESTRING (0 zero)")).toThrow(/not numeric/);
    expect(() => parseWkt("POINT (5)")).toThrow(/needs at least X and Y/);
    expect(() => parseWkt("")).toThrow(WktError);
  });

  test("detects WKT-shaped text", () => {
    expect(looksLikeWkt("POINT (1 2)")).toBe(true);
    expect(looksLikeWkt("  multipolygon z ((")).toBe(true);
    expect(looksLikeWkt("Zurich")).toBe(false);
    expect(looksLikeWkt("")).toBe(false);
  });
});

describe("serializeWkt", () => {
  test("round-trips the supported types", () => {
    const samples = [
      "POINT (30 10)",
      "LINESTRING (0 0, 1 1, 2 2)",
      "POLYGON ((0 0, 4 0, 4 4, 0 4, 0 0))",
      "MULTIPOINT ((10 40), (40 30))",
      "MULTILINESTRING ((0 0, 1 1), (2 2, 3 3))",
      "MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)))",
    ];

    for (const sample of samples) {
      expect(serializeWkt(parseWkt(sample))).toBe(sample);
    }
  });

  test("keeps fractional precision", () => {
    const text = serializeWkt({ type: "Point", coordinates: [8.5417001, 47.3769] });
    expect(text).toBe("POINT (8.5417001 47.3769)");
  });
});
