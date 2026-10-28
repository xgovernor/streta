import { describe, expect, test } from "bun:test";
import { BASEMAPS } from "./data";
import { DEFAULT_PREFERENCES } from "../../state/uiStore";
import type { RasterBasemap } from "./types";

const raster = BASEMAPS.filter(
  (basemap): basemap is RasterBasemap => basemap.kind === "raster",
);

describe("basemap registry", () => {
  test("ids are unique so a basemap can be selected by id", () => {
    const ids = BASEMAPS.map((basemap) => basemap.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every basemap names and credits its provider", () => {
    for (const basemap of BASEMAPS) {
      expect(basemap.name.length).toBeGreaterThan(0);
      expect(basemap.tone.length).toBeGreaterThan(0);
      expect(basemap.attribution.length).toBeGreaterThan(0);

      for (const credit of basemap.attribution) {
        expect(credit.label.length).toBeGreaterThan(0);
        expect(credit.href.startsWith("https://")).toBe(true);
      }
    }
  });

  test("raster basemaps publish usable XYZ templates", () => {
    for (const basemap of raster) {
      expect(basemap.urls.length).toBeGreaterThan(0);

      for (const url of basemap.urls) {
        expect(url.startsWith("https://")).toBe(true);
        expect(url).toContain("{x}");
        expect(url).toContain("{y}");
        expect(url).toContain("{z}");
      }

      expect(basemap.maxZoom).toBeGreaterThanOrEqual(1);
      expect(basemap.maxZoom).toBeLessThanOrEqual(24);
    }
  });

  test("vector basemaps point at a style document, not a tile template", () => {
    for (const basemap of BASEMAPS) {
      if (basemap.kind !== "style") {
        continue;
      }

      expect(basemap.url.startsWith("https://")).toBe(true);
      expect(basemap.url).not.toContain("{z}");
    }
  });

  test("covers the street, imagery and hybrid services", () => {
    expect(raster.map((basemap) => basemap.id).sort()).toEqual([
      "google-maps",
      "hybrid-basemap",
      "maxar-satellite",
      "openstreetmap",
      "satellite-imagery",
    ]);
  });

  test("the default preference is a basemap that exists", () => {
    expect(
      BASEMAPS.some((basemap) => basemap.id === DEFAULT_PREFERENCES.basemap),
    ).toBe(true);
  });
});
