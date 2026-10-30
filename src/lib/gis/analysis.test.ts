import { describe, expect, it } from "bun:test";
import { computeElevationProfile, measureGeodesic } from "./tiledBackend";

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
});
