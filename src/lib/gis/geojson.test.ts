import { describe, expect, test } from "bun:test";
import { GEOGRAPHIC_CRS, transformPosition } from "./crs";
import {
  DataError,
  guessFormat,
  layerNameFromFile,
  parseGeoJson,
  readGeoJsonCrs,
  toGeoJson,
} from "./geojson";
import type { FeatureRecord } from "./types";

const collection = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "zrh",
        geometry: { type: "Point", coordinates: [8.5417, 47.3769] },
        properties: { name: "Zurich", signal: 98, live: true, note: null },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        properties: { name: "Corridor" },
      },
    ],
    ...extra,
  });

describe("readGeoJsonCrs", () => {
  test("understands the legacy crs member", () => {
    expect(
      readGeoJsonCrs({
        type: "name",
        properties: { name: "urn:ogc:def:crs:EPSG::25832" },
      }),
    ).toBe("EPSG:25832");
    expect(
      readGeoJsonCrs({ type: "name", properties: { name: "EPSG:27700" } }),
    ).toBe("EPSG:27700");
  });

  test("treats CRS84 as WGS 84 and ignores junk", () => {
    expect(
      readGeoJsonCrs({
        type: "name",
        properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" },
      }),
    ).toBe(GEOGRAPHIC_CRS);
    expect(readGeoJsonCrs({ type: "name", properties: { name: "local grid" } })).toBeNull();
    expect(readGeoJsonCrs(undefined)).toBeNull();
    expect(readGeoJsonCrs("EPSG:4326")).toBeNull();
  });
});

describe("parseGeoJson", () => {
  test("reads a feature collection with attributes and ids", () => {
    const result = parseGeoJson(collection());

    expect(result.format).toBe("geojson");
    expect(result.crs).toBeNull();
    expect(result.features.length).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.features[0].id).toBe("zrh");
    expect(result.features[0].properties).toEqual({
      name: "Zurich",
      signal: 98,
      live: true,
      note: null,
    });
  });

  test("picks up a declared CRS and the collection name", () => {
    const result = parseGeoJson(
      collection({
        name: "Field survey",
        crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::25832" } },
      }),
    );

    expect(result.crs).toBe("EPSG:25832");
    expect(result.name).toBe("Field survey");
  });

  test("accepts a bare geometry and drops broken members with warnings", () => {
    expect(parseGeoJson('{"type":"Point","coordinates":[1,2]}').features.length).toBe(1);

    const result = parseGeoJson(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: null, properties: {} },
          { type: "Feature", geometry: { type: "Circle", coordinates: [] }, properties: {} },
          {
            type: "Feature",
            id: "ok",
            geometry: { type: "Point", coordinates: [1, 2] },
            properties: {},
          },
        ],
      }),
    );

    expect(result.features.length).toBe(1);
    expect(result.warnings.length).toBe(2);
    expect(result.warnings[0]).toMatch(/no geometry/);
  });

  test("renumbers duplicate ids", () => {
    const result = parseGeoJson(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          { type: "Feature", id: "same", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} },
          { type: "Feature", id: "same", geometry: { type: "Point", coordinates: [1, 1] }, properties: {} },
        ],
      }),
    );

    expect(result.features.map((feature) => feature.id)).toEqual(["same", "same-2"]);
    expect(result.warnings[0]).toMatch(/duplicate feature id/);
  });

  test("reports unusable documents", () => {
    expect(() => parseGeoJson("not json at all")).toThrow(DataError);
    expect(() => parseGeoJson("[]")).toThrow(/must be an object/);
    expect(() => parseGeoJson('{"type":"Topology"}')).toThrow(/Unsupported GeoJSON type/);
    expect(() =>
      parseGeoJson('{"type":"FeatureCollection","features":[]}'),
    ).toThrow(/No usable features/);
    expect(() =>
      parseGeoJson('{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[1,"x"]},"properties":{}}]}'),
    ).toThrow(/No usable features/);
  });
});

describe("toGeoJson", () => {
  test("always writes WGS 84 coordinates, whatever the layer CRS", () => {
    const source = [8.5417, 47.3769];
    const projected = transformPosition(source, GEOGRAPHIC_CRS, "EPSG:25832");

    const features: FeatureRecord[] = [
      {
        id: "zrh",
        geometry: { type: "Point", coordinates: projected },
        properties: { name: "Zurich" },
      },
    ];

    const text = toGeoJson(features, { crs: "EPSG:25832", name: "Stations" });
    const parsed = JSON.parse(text) as {
      features: { geometry: { coordinates: number[] }; id: string }[];
      name: string;
    };

    expect(parsed.name).toBe("Stations");
    expect(parsed.features[0].id).toBe("zrh");
    expect(parsed.features[0].geometry.coordinates[0]).toBeCloseTo(source[0], 6);
    expect(parsed.features[0].geometry.coordinates[1]).toBeCloseTo(source[1], 6);
  });
});

describe("file helpers", () => {
  test("guesses the format from the name and the content", () => {
    expect(guessFormat("stations.geojson", "")).toBe("geojson");
    expect(guessFormat("unknown", '{"type":"Point","coordinates":[0,0]}')).toBe("geojson");
    expect(guessFormat("stations.csv", "lon,lat")).toBe("csv");
    expect(guessFormat("anything", "lon,lat")).toBe("csv");
  });

  test("turns a file name into a layer name", () => {
    expect(layerNameFromFile("/data/field-survey_2024.geojson")).toBe("field survey 2024");
    expect(layerNameFromFile("stations.CSV")).toBe("stations");
  });
});
