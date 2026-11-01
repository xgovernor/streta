import { describe, expect, test } from "bun:test";
import {
  exportBookmarksToCsv,
  exportBookmarksToGeoJson,
  exportBookmarksToKml,
  importBookmarksFromCsv,
  importBookmarksFromGeoJson,
  importBookmarksFromKml,
  kmlRangeToZoom,
  zoomToKmlRange,
} from "./bookmarksIo";
import type { Bookmark } from "./types";

describe("bookmarksIo interoperability", () => {
  const sampleBookmarks: Bookmark[] = [
    {
      id: "bm_1",
      tier: "project",
      title: "Observation Post Tango",
      notes: "Forward observation post with clear line of sight",
      lon: 8.5417,
      lat: 47.3769,
      zoom: 14.5,
      rotation: 0.52, // ~30 degrees
      pitch: 0.2,
      color: "#ff0055",
      category: "Recon",
      priority: "immediate",
      status: "active",
      createdAt: 1700000000000,
      updatedAt: 1700000010000,
    },
    {
      id: "bm_2",
      tier: "user",
      title: "Logistics Hub Bravo",
      notes: "Helipad and fuel depot",
      lon: 9.1393,
      lat: 38.7223,
      zoom: 11,
      rotation: 0,
      pitch: 0,
      color: "#00e5ff",
      category: "Logistics",
      priority: "routine",
      status: "pending",
      createdAt: 1700000020000,
      updatedAt: 1700000030000,
    },
  ];

  test("zoomToKmlRange and kmlRangeToZoom approximate round-trip accurately", () => {
    const zoom = 14;
    const range = zoomToKmlRange(zoom);
    expect(range).toBeGreaterThan(0);
    const convertedBack = kmlRangeToZoom(range);
    expect(Math.abs(convertedBack - zoom)).toBeLessThanOrEqual(0.1);
  });

  test("round-trips bookmarks via GeoJSON FeatureCollection", () => {
    const geoJsonStr = exportBookmarksToGeoJson(sampleBookmarks);
    const parsed = JSON.parse(geoJsonStr);

    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.features.length).toBe(2);
    expect(parsed.features[0].geometry.coordinates).toEqual([8.5417, 47.3769]);
    expect(parsed.features[0].properties.title).toBe("Observation Post Tango");
    expect(parsed.features[0].properties.priority).toBe("immediate");

    const reimported = importBookmarksFromGeoJson(geoJsonStr, "project");
    expect(reimported.length).toBe(2);
    expect(reimported[0].title).toBe("Observation Post Tango");
    expect(reimported[0].notes).toBe("Forward observation post with clear line of sight");
    expect(reimported[0].lon).toBeCloseTo(8.5417, 4);
    expect(reimported[0].lat).toBeCloseTo(47.3769, 4);
    expect(reimported[0].zoom).toBeCloseTo(14.5, 1);
    expect(reimported[0].priority).toBe("immediate");
    expect(reimported[0].category).toBe("Recon");
  });

  test("round-trips bookmarks via OGC KML 2.2", () => {
    const kmlStr = exportBookmarksToKml(sampleBookmarks, "Mission Alpha Bookmarks");
    expect(kmlStr).toContain("<kml xmlns=\"http://www.opengis.net/kml/2.2\">");
    expect(kmlStr).toContain("<Placemark>");
    expect(kmlStr).toContain("<name>Observation Post Tango</name>");
    expect(kmlStr).toContain("<LookAt>");
    expect(kmlStr).toContain("<longitude>8.5417</longitude>");

    const reimported = importBookmarksFromKml(kmlStr, "project");
    expect(reimported.length).toBe(2);
    expect(reimported[0].title).toBe("Observation Post Tango");
    expect(reimported[0].lon).toBeCloseTo(8.5417, 4);
    expect(reimported[0].lat).toBeCloseTo(47.3769, 4);
    expect(reimported[0].zoom).toBeCloseTo(14.5, 0.5);
    expect(reimported[0].rotation).toBeCloseTo(0.52, 0.05);
  });

  test("round-trips bookmarks via CSV format", () => {
    const csvStr = exportBookmarksToCsv(sampleBookmarks);
    expect(csvStr).toContain("title,notes,longitude,latitude,zoom");
    expect(csvStr).toContain("Observation Post Tango");

    const reimported = importBookmarksFromCsv(csvStr, "user");
    expect(reimported.length).toBe(2);
    expect(reimported[0].tier).toBe("user");
    expect(reimported[0].title).toBe("Observation Post Tango");
    expect(reimported[0].lon).toBeCloseTo(8.5417, 4);
    expect(reimported[0].lat).toBeCloseTo(47.3769, 4);
    expect(reimported[0].zoom).toBeCloseTo(14.5, 1);
    expect(reimported[0].priority).toBe("immediate");
    expect(reimported[0].category).toBe("Recon");
    expect(reimported[0].notes).toBe("Forward observation post with clear line of sight");
  });

  test("importBookmarksFromCsv throws when coordinate headers are absent", () => {
    const invalidCsv = "name,description\nPoint 1,Hello world";
    expect(() => importBookmarksFromCsv(invalidCsv)).toThrow(/CSV must contain/);
  });
});

