import { describe, expect, it } from "bun:test";
import { computeElevationProfile, measureGeodesic, spatialBufferQuery } from "./tiledBackend";
import type { DatasetLayer } from "./types";

describe("Phase 3 Geodesic Analysis Engine", () => {
  it("calculates distance and forward/reverse azimuth bearings between two coordinates", async () => {
    // Equator segment: (0, 0) to (1, 0) (East along equator)
    const result = await measureGeodesic([[0, 0], [1, 0]], false);

    expect(result).not.toBeNull();
    if (!result) return;

    // 1 degree of longitude at equator is ~111.32 km (111,319 m)
    expect(result.total_distance_km).toBeGreaterThan(110);
    expect(result.total_distance_km).toBeLessThan(112);

    expect(result.segments).toHaveLength(1);
    const seg = result.segments[0];

    // Due east is 90 degrees forward, 270 degrees reverse
    expect(Math.round(seg.forward_bearing_deg)).toBe(90);
    expect(Math.round(seg.reverse_bearing_deg)).toBe(270);
  });

  it("calculates multi-segment route distance and statute/nautical miles", async () => {
    // 3 points route: London (approx 0, 51.5) -> Paris (2.35, 48.85) -> Brussels (4.35, 50.85)
    const coords: [number, number][] = [
      [-0.1278, 51.5074],
      [2.3522, 48.8566],
      [4.3517, 50.8503],
    ];

    const result = await measureGeodesic(coords, false);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.segments).toHaveLength(2);
    expect(result.total_distance_km).toBeGreaterThan(500);
    expect(result.total_distance_km).toBeLessThan(700);

    // Nautical miles = km / 1.852
    expect(result.total_distance_nmi).toBeCloseTo(result.total_distance_km / 1.852, 1);
    // Statute miles = km / 1.609344
    expect(result.total_distance_miles).toBeCloseTo(result.total_distance_km / 1.609344, 1);
  });

  it("handles polygon mode with perimeter and centroid", async () => {
    // Triangular bounding polygon
    const triangle: [number, number][] = [
      [10, 50],
      [12, 50],
      [11, 52],
      [10, 50],
    ];

    const result = await measureGeodesic(triangle, true);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.perimeter_m).toBeDefined();
    expect(result.perimeter_m).toBeGreaterThan(0);
    expect(result.centroid).toBeDefined();
    if (result.centroid) {
      expect(result.centroid[0]).toBeCloseTo(10.75, 1);
      expect(result.centroid[1]).toBeCloseTo(50.5, 1);
    }
  });

  it("returns null when fewer than 2 coordinates are provided", async () => {
    const result = await measureGeodesic([[10, 20]], false);
    expect(result).toBeNull();
  });

  it("safely handles computeElevationProfile validation and edge cases", async () => {
    // Rejects paths with fewer than 2 coordinates
    expect(await computeElevationProfile([])).toBeNull();
    expect(await computeElevationProfile([[10, 20]])).toBeNull();
  });

  it("computes geodesic buffer polygon and queries features accurately with client fallback", async () => {
    const mockLayers: DatasetLayer[] = [
      {
        id: "mock_pois",
        datasetId: "ds_1",
        name: "Points of Interest",
        crs: "EPSG:4326",
        format: "geojson",
        source: null,
        geometryKind: "Point",
        fields: [],
        extent: null,
        style: { color: "#06b6d4", strokeWidth: 2, pointRadius: 4, fillOpacity: 0.2, labelField: null },
        filters: [],
        visible: true,
        opacity: 1,
        order: 0,
        createdAt: new Date().toISOString(),
        features: [
          // Near origin (approx 1.11 km north)
          {
            id: "near_pt",
            geometry: { type: "Point", coordinates: [0, 0.01] },
            properties: { name: "Near Target" },
          },
          // Far away (approx 111 km north)
          {
            id: "far_pt",
            geometry: { type: "Point", coordinates: [0, 1.0] },
            properties: { name: "Far Target" },
          },
        ],
      },
    ];

    // Query 5000m around (0, 0)
    const result = await spatialBufferQuery(0, 0, 5000, undefined, 100, mockLayers);
    expect(result).not.toBeNull();
    if (!result) return;

    // Buffer geometry should be a closed 65-coordinate polygon ring (64 segments + 1 closing)
    expect(result.buffer_geojson.geometry.type).toBe("Polygon");
    const ring = result.buffer_geojson.geometry.coordinates[0];
    expect(ring.length).toBe(65);
    expect(ring[0][0]).toBeCloseTo(ring[64][0], 5);
    expect(ring[0][1]).toBeCloseTo(ring[64][1], 5);

    // Only "near_pt" should be intercepted (within 5000m)
    expect(result.total_hits).toBe(1);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].feature_id).toBe("near_pt");
    expect(result.hits[0].distance_m).toBeGreaterThan(1000);
    expect(result.hits[0].distance_m).toBeLessThan(1200);
    // Heading north = ~0 degrees bearing
    expect(Math.round(result.hits[0].bearing_deg)).toBe(0);
    expect(result.hits[0].target_lon).toBeDefined();
    expect(result.hits[0].target_lat).toBeDefined();
  });

  it("rejects non-positive buffer radius values", async () => {
    expect(await spatialBufferQuery(0, 0, 0)).toBeNull();
    expect(await spatialBufferQuery(0, 0, -100)).toBeNull();
  });
});
