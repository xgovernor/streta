import { describe, expect, test } from "bun:test";
import {
  buildRasterStyle,
  validateStrataCogUrl,
  sampleRasterPixel,
} from "./rasterLayer";


describe("Strict strata://cog URL Enforcement", () => {
  test("allows valid strata://cog URLs", () => {
    expect(() => validateStrataCogUrl("strata://cog/sentinel2_tahoe/B04")).not.toThrow();
    expect(() => validateStrataCogUrl("strata://cog/copernicus_dem/elevation")).not.toThrow();
  });

  test("rejects direct https:// URLs to maintain WebView architecture compliance", () => {
    expect(() => validateStrataCogUrl("https://sentinel-cogs.s3.amazonaws.com/B04.tif")).toThrow(
      /Architectural Violation/,
    );
  });

  test("rejects direct http:// URLs", () => {
    expect(() => validateStrataCogUrl("http://example.com/raster.tif")).toThrow(
      /Architectural Violation/,
    );
  });
});

describe("GPU Band Formulas & 1e-6 Guards", () => {
  const bandIndices = {
    b02: 1,
    b03: 2,
    b04: 3,
    b08: 4,
    b11: 5,
    b12: 6,
    elevation: 1,
  };

  test("builds NDVI style with 1e-6 divide-by-zero guard", () => {
    const style = buildRasterStyle("NDVI", bandIndices);
    expect(style.color).toBeDefined();
    expect(style.color[0]).toBe("interpolate");
    const formulaExpr = style.color[2];
    expect(formulaExpr[0]).toBe("/");
    expect(formulaExpr[1]).toEqual(["-", ["band", 4], ["band", 3]]);
    expect(formulaExpr[2]).toEqual(["+", ["band", 4], ["band", 3], 1e-6]);
  });

  test("builds NDWI style with 1e-6 divide-by-zero guard", () => {
    const style = buildRasterStyle("NDWI", bandIndices);
    const formulaExpr = style.color[2];
    expect(formulaExpr[0]).toBe("/");
    expect(formulaExpr[1]).toEqual(["-", ["band", 2], ["band", 4]]);
    expect(formulaExpr[2]).toEqual(["+", ["band", 2], ["band", 4], 1e-6]);
  });

  test("builds NDBI style ((B11 - B08) / (B11 + B08)) with 1e-6 guard", () => {
    const style = buildRasterStyle("NDBI", bandIndices);
    const formulaExpr = style.color[2];
    expect(formulaExpr[0]).toBe("/");
    expect(formulaExpr[1]).toEqual(["-", ["band", 5], ["band", 4]]);
    expect(formulaExpr[2]).toEqual(["+", ["band", 5], ["band", 4], 1e-6]);
  });

  test("builds NBR style ((B08 - B12) / (B08 + B12)) with 1e-6 guard", () => {
    const style = buildRasterStyle("NBR", bandIndices);
    const formulaExpr = style.color[2];
    expect(formulaExpr[0]).toBe("/");
    expect(formulaExpr[1]).toEqual(["-", ["band", 4], ["band", 6]]);
    expect(formulaExpr[2]).toEqual(["+", ["band", 4], ["band", 6], 1e-6]);
  });

  test("builds CIR false color composite", () => {
    const style = buildRasterStyle("CIR", bandIndices);
    expect(style.color[0]).toBe("array");
    expect(style.color[4]).toBe(1.0);
  });

  test("builds Natural RGB composite", () => {
    const style = buildRasterStyle("RGB", bandIndices);
    expect(style.color[0]).toBe("array");
    expect(style.color[4]).toBe(1.0);
  });

  test("builds Elevation hypsometric style", () => {
    const style = buildRasterStyle("Elevation", bandIndices);
    expect(style.color[0]).toBe("interpolate");
    expect(style.color[2]).toEqual(["band", 1]);
  });
});

describe("Client-Side Pixel Probe Calculation", () => {
  const bandOrder = ["B02", "B03", "B04", "B08", "B11", "B12"];

  // Mock WebGLTileLayer with getData returning Float32Array:
  // B02: 400, B03: 600, B04: 300, B08: 3000, B11: 1000, B12: 500
  const mockLayer = {
    getData: (_pixel: any) => new Float32Array([400, 600, 300, 3000, 1000, 500]),
  } as any;

  test("computes NDVI correctly on simulated pixel probe", () => {
    const probe = sampleRasterPixel(
      mockLayer,
      [100, 100],
      [-120.0, 39.0],
      bandOrder,
      "NDVI",
    );
    expect(probe).not.toBeNull();
    // (3000 - 300) / (3000 + 300 + 1e-6) = 2700 / 3300 = 0.818
    expect(probe!.computedValue).toBeCloseTo(0.818, 2);
    expect(probe!.formattedValue).toBe("0.818");
    expect(probe!.interpretation).toContain("forest canopy");
  });

  test("computes NDWI correctly on simulated pixel probe", () => {
    const probe = sampleRasterPixel(
      mockLayer,
      [100, 100],
      [-120.0, 39.0],
      bandOrder,
      "NDWI",
    );
    expect(probe).not.toBeNull();
    // (600 - 3000) / (600 + 3000 + 1e-6) = -2400 / 3600 = -0.667
    expect(probe!.computedValue).toBeCloseTo(-0.667, 2);
    expect(probe!.interpretation).toContain("Terrestrial");
  });

  test("computes NDBI correctly on simulated pixel probe", () => {
    const probe = sampleRasterPixel(
      mockLayer,
      [100, 100],
      [-120.0, 39.0],
      bandOrder,
      "NDBI",
    );
    expect(probe).not.toBeNull();
    // (1000 - 3000) / (1000 + 3000 + 1e-6) = -2000 / 4000 = -0.500
    expect(probe!.computedValue).toBeCloseTo(-0.5, 2);
    expect(probe!.interpretation).toContain("Vegetated");
  });

  test("computes NBR correctly on simulated pixel probe", () => {
    const probe = sampleRasterPixel(
      mockLayer,
      [100, 100],
      [-120.0, 39.0],
      bandOrder,
      "NBR",
    );
    expect(probe).not.toBeNull();
    // (3000 - 500) / (3000 + 500 + 1e-6) = 2500 / 3500 = 0.714
    expect(probe!.computedValue).toBeCloseTo(0.714, 2);
    expect(probe!.interpretation).toContain("Unburned healthy forest");
  });

  test("returns null when layer getData returns null or all zeros", () => {
    const emptyLayer = { getData: () => null } as any;
    expect(sampleRasterPixel(emptyLayer, [0, 0], [0, 0], bandOrder, "NDVI")).toBeNull();

    const zeroLayer = { getData: () => new Float32Array([0, 0, 0, 0, 0, 0]) } as any;
    expect(sampleRasterPixel(zeroLayer, [0, 0], [0, 0], bandOrder, "NDVI")).toBeNull();
  });

  test("correctly parses Uint16 samples inside a DataView", () => {
    // 6 bands, 2 bytes each = 12 bytes buffer
    const buffer = new ArrayBuffer(12);
    const view = new DataView(buffer);
    // B02: 400, B03: 600, B04: 300, B08: 3000, B11: 1000, B12: 500
    view.setUint16(0, 400, true);
    view.setUint16(2, 600, true);
    view.setUint16(4, 300, true);
    view.setUint16(6, 3000, true);
    view.setUint16(8, 1000, true);
    view.setUint16(10, 500, true);

    const dataViewLayer = { getData: () => view } as any;
    const probe = sampleRasterPixel(dataViewLayer, [50, 50], [-120.0, 39.0], bandOrder, "NDVI");
    expect(probe).not.toBeNull();
    // (3000 - 300) / (3000 + 300 + 1e-6) = 2700 / 3300 = 0.818
    expect(probe!.computedValue).toBeCloseTo(0.818, 2);
    expect(probe!.interpretation).toContain("forest canopy");
  });

  test("handles elevation nodata correctly", () => {
    const demNoDataLayer = {
      getData: () => new Float32Array([-9999.0]),
    } as any;
    const probe = sampleRasterPixel(demNoDataLayer, [10, 10], [-120.0, 39.0], ["elevation"], "Elevation");
    expect(probe).not.toBeNull();
    expect(probe!.computedValue).toBeNull();
    expect(probe!.formattedValue).toBe("No Data");
    expect(probe!.interpretation).toContain("Outside terrain coverage");
  });
});
