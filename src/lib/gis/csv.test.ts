import { describe, expect, test } from "bun:test";
import {
  detectDelimiter,
  parseCoordinate,
  parseCsv,
  parseDelimited,
  toCsv,
} from "./csv";
import { DataError } from "./geojson";
import type { FeatureRecord } from "./types";

const quoted = `name,lon,lat,note
"Zürich, CH",8.5417,47.3769,"He said ""hi""
and left"
`;

describe("delimiters and quoting", () => {
  test("detects comma, semicolon and tab files", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });

  test("keeps quoted delimiters, quotes and newlines intact", () => {
    const table = parseDelimited(quoted);

    expect(table.headers).toEqual(["name", "lon", "lat", "note"]);
    expect(table.rows.length).toBe(1);
    expect(table.rows[0][0]).toBe("Zürich, CH");
    expect(table.rows[0][3]).toBe('He said "hi"\nand left');
  });

  test("suffixes duplicate headers and strips a byte order mark", () => {
    const table = parseDelimited("\uFEFFname,name\n1,2");
    expect(table.headers).toEqual(["name", "name_2"]);
    expect(table.warnings.length).toBe(1);
  });

  test("rejects a file without data rows", () => {
    expect(() => parseDelimited("name,lon,lat")).toThrow(DataError);
  });
});

describe("parseCoordinate", () => {
  test("reads decimal, signed and hemisphere values", () => {
    expect(parseCoordinate("47.3769")).toBeCloseTo(47.3769, 6);
    expect(parseCoordinate("-122.4")).toBeCloseTo(-122.4, 6);
    expect(parseCoordinate("12.5W")).toBeCloseTo(-12.5, 6);
    expect(parseCoordinate("N47.5")).toBeCloseTo(47.5, 6);
    expect(parseCoordinate(8.5417)).toBeCloseTo(8.5417, 6);
  });

  test("reads degrees, minutes and seconds", () => {
    expect(parseCoordinate("47°22'37\"N")).toBeCloseTo(47.3769, 4);
    expect(parseCoordinate("8 32 30 E")).toBeCloseTo(8.5417, 4);
    expect(parseCoordinate("33°55′30″S")).toBeCloseTo(-33.925, 4);
  });

  test("returns null for anything unreadable", () => {
    expect(parseCoordinate("")).toBeNull();
    expect(parseCoordinate("east")).toBeNull();
    expect(parseCoordinate("12,5")).toBeNull();
    expect(parseCoordinate(undefined)).toBeNull();
  });
});

describe("parseCsv", () => {
  test("builds point features from lon/lat columns", () => {
    const result = parseCsv(quoted, { crs: "EPSG:4326" });

    expect(result.format).toBe("csv");
    expect(result.features.length).toBe(1);
    expect(result.features[0].geometry).toEqual({
      type: "Point",
      coordinates: [8.5417, 47.3769],
    });
    expect(result.features[0].properties).toEqual({
      name: "Zürich, CH",
      note: 'He said "hi"\nand left',
    });
  });

  test("recognises aliases, x/y pairs and value types", () => {
    const text = `latitude,longitude,status,signal,live,note
47.3769,8.5417,online,98,true,
-33.9249,18.4241,offline,0,false,"campus, north"`;

    const result = parseCsv(text, { crs: "EPSG:4326" });
    const [first, second] = result.features;

    expect(first.geometry.coordinates).toEqual([8.5417, 47.3769]);
    expect(first.properties.signal).toBe(98);
    expect(first.properties.live).toBe(true);
    expect(first.properties.note).toBeNull();
    expect(second.properties.note).toBe("campus, north");
    expect(second.geometry.coordinates).toEqual([18.4241, -33.9249]);
  });

  test("reads a semicolon file whose coordinates are DMS text", () => {
    const text = `name;lat;lon
Bern;46°57'00"N;7°26'00"E`;

    const result = parseCsv(text, { crs: "EPSG:4326" });
    const [lon, lat] = result.features[0].geometry.coordinates as number[];

    expect(lat).toBeCloseTo(46.95, 3);
    expect(lon).toBeCloseTo(7.4333, 3);
  });

  test("prefers a WKT column and drops rows it cannot read", () => {
    const text = `wkt;name
"POINT (7.44 46.95)";Bern
"not a geometry";Broken
"LINESTRING (0 0, 1 1)";Line`;

    const result = parseCsv(text, { crs: "EPSG:4326" });

    expect(result.features.length).toBe(2);
    expect(result.features[0].geometry.type).toBe("Point");
    expect(result.features[0].properties).toEqual({ name: "Bern" });
    expect(result.features[1].geometry.type).toBe("LineString");
    expect(result.warnings.join(" ")).toMatch(/had no usable geometry/);
  });

  test("explains a file without any geometry column", () => {
    expect(() =>
      parseCsv("name,value\na,1", { crs: "EPSG:4326" }),
    ).toThrow(/No geometry column found/);
  });
});

describe("toCsv", () => {
  const features: FeatureRecord[] = [
    {
      id: "a",
      geometry: { type: "Point", coordinates: [8.5417, 47.3769] },
      properties: { name: "Zürich, CH", signal: 98, note: 'said "hi"' },
    },
  ];

  test("writes WKT geometry with escaped attributes", () => {
    const text = toCsv(features, ["name", "signal", "note"], {
      crs: "EPSG:4326",
    });

    expect(text.split("\n")[0]).toBe("wkt,name,signal,note");
    expect(text).toContain("POINT (8.5417 47.3769)");
    expect(text).toContain('"Zürich, CH"');
    expect(text).toContain('"said ""hi"""');
  });

  test("can write x/y columns instead", () => {
    const text = toCsv(features, ["name"], { crs: "EPSG:4326", geometry: "xy" });
    const [, row] = text.split("\n");

    expect(text.split("\n")[0]).toBe("x,y,name");
    expect(row.startsWith("8.5417,47.3769,")).toBe(true);
  });

  test("round-trips through the reader", () => {
    const text = toCsv(features, ["name", "signal"], { crs: "EPSG:4326" });
    const parsed = parseCsv(text, { crs: "EPSG:4326" });

    expect(parsed.features.length).toBe(1);
    expect(parsed.features[0].properties.name).toBe("Zürich, CH");
    expect(parsed.features[0].properties.signal).toBe(98);
    expect(parsed.features[0].geometry.coordinates).toEqual([8.5417, 47.3769]);
  });
});
