import { describe, expect, test } from "bun:test";
import {
  CrsError,
  GEOGRAPHIC_CRS,
  VIEW_CRS,
  crsInfo,
  hasCrs,
  isGeographic,
  listCrs,
  normalizeCrsCode,
  projectFeatures,
  registerCrs,
  transformGeometry,
  transformPosition,
} from "./crs";
import { eachPosition, geometryExtent } from "./geometry";
import type { FeatureRecord, Geometry } from "./types";

describe("normalizeCrsCode", () => {
  test("accepts the spellings a file may use", () => {
    expect(normalizeCrsCode("EPSG:25832")).toBe("EPSG:25832");
    expect(normalizeCrsCode("epsg: 4326")).toBe("EPSG:4326");
    expect(normalizeCrsCode("urn:ogc:def:crs:EPSG::25832")).toBe("EPSG:25832");
    expect(normalizeCrsCode("urn:ogc:def:crs:EPSG:6.6:28992")).toBe("EPSG:28992");
    expect(
      normalizeCrsCode("http://www.opengis.net/def/crs/EPSG/0/27700"),
    ).toBe("EPSG:27700");
    expect(normalizeCrsCode("3857")).toBe("EPSG:3857");
    expect(normalizeCrsCode(" 4326 ")).toBe("EPSG:4326");
  });

  test("rejects anything that is not a CRS code", () => {
    expect(normalizeCrsCode("not a crs")).toBeNull();
    expect(normalizeCrsCode("" )).toBeNull();
    expect(normalizeCrsCode(null)).toBeNull();
    expect(normalizeCrsCode(25832)).toBeNull();
  });
});

describe("registry", () => {
  test("knows the global defaults and national grids", () => {
    expect(isGeographic(GEOGRAPHIC_CRS)).toBe(true);
    expect(isGeographic(VIEW_CRS)).toBe(false);
    expect(crsInfo("EPSG:3857")?.units).toBe("metre");
    expect(hasCrs("EPSG:25832")).toBe(true);
    expect(hasCrs("EPSG:27700")).toBe(true);
    expect(listCrs().length).toBeGreaterThan(100);
  });

  test("generates UTM zones instead of listing them", () => {
    expect(crsInfo("EPSG:32633")?.name).toBe("WGS 84 / UTM zone 33N");
    expect(crsInfo("EPSG:32733")?.name).toBe("WGS 84 / UTM zone 33S");
  });

  test("knows Bangladesh's grids", () => {
    expect(crsInfo("EPSG:3106")?.name).toBe("Gulshan 303 / TM 90 NE");
    expect(crsInfo("EPSG:9678")?.name).toBe(
      "Gulshan 303 / Bangladesh Transverse Mercator",
    );
    // Bangladesh straddles UTM zones 45 and 46.
    expect(hasCrs("EPSG:32645")).toBe(true);
    expect(hasCrs("EPSG:32646")).toBe(true);
  });

  test("projects Dhaka into the local grids and back", () => {
    const dhaka: [number, number] = [90.4, 23.78];
    const tm90 = transformPosition(dhaka, GEOGRAPHIC_CRS, "EPSG:3106");
    const btm = transformPosition(dhaka, GEOGRAPHIC_CRS, "EPSG:9678");

    // BTM differs from TM 90 NE only by its false northing of 2 000 km.
    expect(tm90[0]).toBeCloseTo(btm[0], 4);
    expect(tm90[1] - btm[1]).toBeCloseTo(2_000_000, 3);

    for (const [projected, code] of [
      [tm90, "EPSG:3106"],
      [btm, "EPSG:9678"],
    ] as const) {
      const back = transformPosition(projected, code, GEOGRAPHIC_CRS);
      expect(back[0]).toBeCloseTo(dhaka[0], 6);
      expect(back[1]).toBeCloseTo(dhaka[1], 6);
    }
  });

  test("registers a proj4 definition and refuses a broken one", () => {
    expect(
      registerCrs(
        "EPSG:3995",
        "+proj=stere +lat_0=90 +lat_ts=71 +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs +type=crs",
      ),
    ).toBe(true);
    expect(hasCrs("EPSG:3995")).toBe(true);
    expect(crsInfo("EPSG:3995")?.builtin).toBe(false);
    expect(registerCrs("EPSG:9", "")).toBe(false);
  });
});

describe("transformPosition", () => {
  test("is the identity across the same CRS", () => {
    const position = [8.5417, 47.3769];
    expect(transformPosition(position, GEOGRAPHIC_CRS, GEOGRAPHIC_CRS)).toBe(
      position,
    );
  });

  test("maps degree extremes to the Web Mercator square", () => {
    const [x, y] = transformPosition([180, 0], GEOGRAPHIC_CRS, VIEW_CRS);
    expect(Math.abs(Math.abs(x) - 20037508.34)).toBeLessThan(0.05);
    expect(y).toBeCloseTo(0, 6);
    const [originX, originY] = transformPosition([0, 0], GEOGRAPHIC_CRS, VIEW_CRS);
    expect(originX).toBeCloseTo(0, 6);
    expect(originY).toBeCloseTo(0, 6);
  });

  test("round-trips every corner of a lon/lat box", () => {
    const corners: [number, number][] = [
      [-180, -85],
      [-91.25, -12.5],
      [0, 0],
      [13.405, 52.52],
      [179.999, 85],
    ];

    for (const corner of corners) {
      const projected = transformPosition(corner, GEOGRAPHIC_CRS, VIEW_CRS);
      const back = transformPosition(projected, VIEW_CRS, GEOGRAPHIC_CRS);
      expect(back[0]).toBeCloseTo(corner[0], 8);
      expect(back[1]).toBeCloseTo(corner[1], 8);
    }
  });

  test("places Zurich in UTM 32N near its true easting and northing", () => {
    const [easting, northing] = transformPosition(
      [8.5417, 47.3769],
      GEOGRAPHIC_CRS,
      "EPSG:25832",
    );

    expect(easting).toBeGreaterThan(455_000);
    expect(easting).toBeLessThan(470_000);
    expect(northing).toBeGreaterThan(5_240_000);
    expect(northing).toBeLessThan(5_260_000);
  });

  test("throws a named error for an unknown CRS", () => {
    expect(() =>
      transformPosition([0, 0], "EPSG:999999", GEOGRAPHIC_CRS),
    ).toThrow(CrsError);
  });
});

describe("transformGeometry", () => {
  test("reprojects nested rings and keeps the Z ordinate", () => {
    const polygon: Geometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0, 10],
          [1, 0, 11],
          [1, 1, 12],
          [0, 0, 10],
        ],
        [
          [0.2, 0.2, 5],
          [0.4, 0.2, 5],
          [0.4, 0.4, 5],
          [0.2, 0.2, 5],
        ],
      ],
    };

    const projected = transformGeometry(polygon, GEOGRAPHIC_CRS, VIEW_CRS);
    const rings = projected.coordinates as number[][][];

    expect(rings.length).toBe(2);
    expect(rings[0].length).toBe(4);
    expect(rings[1][0][2]).toBe(5);
    expect(rings[0][1][0]).toBeCloseTo(111319.49, 1);

    const extent = geometryExtent(projected);
    expect(extent?.[0]).toBeCloseTo(0, 6);
    expect(extent?.[2]).toBeCloseTo(111319.49, 1);
  });

  test("returns the same object when the CRS does not change", () => {
    const geometry: Geometry = { type: "Point", coordinates: [1, 2] };
    expect(transformGeometry(geometry, GEOGRAPHIC_CRS, GEOGRAPHIC_CRS)).toBe(
      geometry,
    );
  });
});

describe("projectFeatures", () => {
  const feature = (
    id: string,
    coordinates: number[],
  ): FeatureRecord => ({
    id,
    geometry: { type: "Point", coordinates },
    properties: {},
  });

  test("projects every feature and reports the unprojectable ones", () => {
    const features = [
      feature("a", [8.5417, 47.3769]),
      feature("b", [0, Number.NaN]),
      feature("c", [103.8198, 1.3521]),
    ];

    const { projected, failures } = projectFeatures(features, GEOGRAPHIC_CRS);

    expect(projected.length).toBe(2);
    expect(projected.map((item) => item.id)).toEqual(["a", "c"]);
    expect(failures.length).toBe(1);
    expect(failures[0].featureIndex).toBe(1);

    for (const item of projected) {
      eachPosition(item.geometry, (position) => {
        expect(Number.isFinite(position[0])).toBe(true);
        expect(Number.isFinite(position[1])).toBe(true);
      });
    }
  });
});
