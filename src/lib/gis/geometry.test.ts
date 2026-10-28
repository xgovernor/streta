import { describe, expect, test } from "bun:test";
import {
  displayValue,
  eachPosition,
  featureExtent,
  geometryArea,
  geometryCentroid,
  geometryExtent,
  geometryKindOf,
  geometryLength,
  geometryVertexCount,
  haversineMeters,
  inferFields,
  kindCounts,
  mergeExtents,
  numericRange,
  positionsAreFinite,
  searchableText,
} from "./geometry";
import type { FeatureRecord, Geometry } from "./types";

const square: Geometry = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
};

describe("haversineMeters", () => {
  test("measures one degree of longitude at the equator", () => {
    expect(haversineMeters([0, 0], [1, 0])).toBeCloseTo(111_195, 0);
  });

  test("measures a real intercontinental pair", () => {
    // Zurich to Lisbon.
    const meters = haversineMeters([8.5417, 47.3769], [-9.1393, 38.7223]);
    expect(meters).toBeGreaterThan(1_700_000);
    expect(meters).toBeLessThan(1_750_000);
  });

  test("is zero for identical points", () => {
    expect(haversineMeters([12.5, 41.9], [12.5, 41.9])).toBe(0);
  });
});

describe("geometryLength", () => {
  test("sums a linestring", () => {
    const line: Geometry = {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    };

    expect(geometryLength(line)).toBeCloseTo(222_390, -2);
  });

  test("treats polygon rings as an outline", () => {
    expect(geometryLength(square)).toBeCloseTo(444_780, -2);
  });

  test("sums parts of a multi-geometry", () => {
    const multi: Geometry = {
      type: "MultiLineString",
      coordinates: [
        [
          [0, 0],
          [1, 0],
        ],
        [
          [10, 0],
          [11, 0],
        ],
      ],
    };

    expect(geometryLength(multi)).toBeCloseTo(222_390, -2);
  });

  test("is zero for points", () => {
    expect(geometryLength({ type: "Point", coordinates: [1, 2] })).toBe(0);
  });
});

describe("geometryArea", () => {
  test("matches the spherical area of a degree square at the equator", () => {
    const squareKilometers = geometryArea(square) / 1_000_000;
    expect(squareKilometers).toBeGreaterThan(12_240);
    expect(squareKilometers).toBeLessThan(12_490);
  });

  test("subtracts holes and ignores winding direction", () => {
    const withHole: Geometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
        [
          [0.5, 0.5],
          [1.5, 0.5],
          [1.5, 1.5],
          [0.5, 1.5],
          [0.5, 0.5],
        ],
      ],
    };

    const outerRing = (withHole.coordinates as number[][][])[0];
    const reversed: Geometry = {
      type: "Polygon",
      coordinates: [[...(square.coordinates as number[][][])[0]].reverse()],
    };

    expect(geometryArea(withHole)).toBeGreaterThan(0);
    expect(geometryArea(withHole)).toBeLessThan(
      geometryArea({ type: "Polygon", coordinates: [outerRing] }),
    );
    expect(geometryArea(reversed)).toBeCloseTo(geometryArea(square), 6);
  });

  test("sums multipolygon members and ignores linear geometry", () => {
    const multi: Geometry = {
      type: "MultiPolygon",
      coordinates: [
        square.coordinates as number[][][],
        [[[20, 0], [21, 0], [21, 1], [20, 1], [20, 0]]],
      ],
    };

    expect(geometryArea(multi)).toBeCloseTo(geometryArea(square) * 2, 0);
    expect(geometryArea({ type: "LineString", coordinates: [[0, 0], [1, 1]] })).toBe(0);
  });
});

describe("extents and positions", () => {
  test("merges extents and reads them back", () => {
    const merged = mergeExtents([0, 0, 1, 1], [-2, -3, 0.5, 0.5]);
    expect(merged).toEqual([-2, -3, 1, 1]);
    expect(mergeExtents(null, null)).toBeNull();
    expect(mergeExtents([0, 0, 1, 1], null)).toEqual([0, 0, 1, 1]);
  });

  test("computes layer extents, vertex counts and centroids", () => {
    const features: FeatureRecord[] = [
      {
        id: "a",
        geometry: { type: "Point", coordinates: [0, 0] },
        properties: {},
      },
      {
        id: "b",
        geometry: { type: "Point", coordinates: [2, 4] },
        properties: {},
      },
    ];

    expect(featureExtent(features)).toEqual([0, 0, 2, 4]);
    expect(geometryVertexCount(square)).toBe(5);
    expect(geometryCentroid(square)).toEqual([0.4, 0.4]);
    expect(geometryCentroid({ type: "Point", coordinates: [] })).toBeNull();
    expect(geometryExtent({ type: "Point", coordinates: [] })).toBeNull();
  });

  test("rejects non-finite coordinates", () => {
    expect(
      positionsAreFinite({ type: "Point", coordinates: [1, Number.NaN] }),
    ).toBe(false);
    expect(positionsAreFinite(square)).toBe(true);

    let visited = 0;
    eachPosition(square, () => {
      visited += 1;
    });
    expect(visited).toBe(5);
  });
});

describe("geometryKindOf", () => {
  const polygon: FeatureRecord = { id: "p", geometry: square, properties: {} };
  const multiPolygon: FeatureRecord = {
    id: "m",
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 0]]],
        [[[2, 2], [3, 2], [3, 3], [2, 2]]],
      ],
    },
    properties: {},
  };

  test("keeps the exact type when every feature agrees", () => {
    expect(geometryKindOf([multiPolygon, multiPolygon])).toBe("MultiPolygon");
    expect(geometryKindOf([polygon])).toBe("Polygon");
  });

  test("treats single and multi geometry of one family as the same layer", () => {
    // A shapefile of districts is all polygons even when a few of them are
    // written as multipolygons to hold their islands.
    expect(geometryKindOf([polygon, multiPolygon])).toBe("Polygon");
  });

  test("still reports Mixed across families", () => {
    const line: FeatureRecord = {
      id: "l",
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
      properties: {},
    };

    expect(geometryKindOf([polygon, line])).toBe("Mixed");
  });
});

describe("layer summaries", () => {
  const features: FeatureRecord[] = [
    {
      id: "a",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { name: "Alpha", signal: 91, live: true, note: null },
    },
    {
      id: "b",
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
      properties: { name: "Bravo", signal: 0, live: false, note: "ok" },
    },
    {
      id: "c",
      geometry: square,
      properties: { name: "Charlie", signal: 12, live: true, note: "" },
    },
  ];

  test("counts geometry families", () => {
    expect(kindCounts(features)).toEqual({ point: 1, line: 1, polygon: 1 });
    expect(geometryKindOf(features)).toBe("Mixed");
    expect(geometryKindOf([features[0]])).toBe("Point");
  });

  test("infers field types and fill ratios", () => {
    const fields = inferFields(features);

    expect(fields.map((field) => field.name)).toEqual([
      "name",
      "signal",
      "live",
      "note",
    ]);

    const signal = fields.find((field) => field.name === "signal");
    const note = fields.find((field) => field.name === "note");

    expect(signal?.type).toBe("number");
    expect(signal?.fill).toBe(1);
    expect(note?.type).toBe("text");
    expect(note?.fill).toBeCloseTo(1 / 3, 5);
  });

  test("reads numeric ranges and display strings", () => {
    expect(numericRange(features, "signal")).toEqual({ min: 0, max: 91 });
    expect(numericRange(features, "name")).toBeNull();
    expect(displayValue(null)).toBe("—");
    expect(displayValue(true)).toBe("yes");
    expect(displayValue(1234)).toBe("1,234");
    expect(searchableText(features[0].properties, ["name", "signal"])).toContain(
      "alpha",
    );
  });
});
