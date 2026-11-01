import { describe, expect, it } from "bun:test";
import {
  bearingToCompassDirection,
  computeElevationProfile,
  createGeodesicLineBuffer,
  createGeodesicPointBuffer,
  createGeodesicPolygonBuffer,
  createGeodesicSectorBuffer,
  distanceToLineString,
  extractFeatureCentroid,
  isBearingInSector,
  measureGeodesic,
  normalizeAntimeridianPolygon,
  spatialBufferQuery,
  spatialKnnQuery,
} from "./tiledBackend";
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

  it("creates a geodesic corridor buffer polygon around a multi-segment route", async () => {
    const route: [number, number][] = [
      [0, 0],
      [1, 0], // 1 degree East along equator (~111 km)
    ];

    const corridor = createGeodesicLineBuffer(route, 5000);
    expect(corridor).not.toBeNull();
    expect(corridor.geometry.type).toBe("Polygon");
    const ring = corridor.geometry.coordinates[0];
    expect(ring.length).toBeGreaterThan(20);
    // Closed polygon
    expect(ring[0][0]).toBeCloseTo(ring[ring.length - 1][0], 5);
    expect(ring[0][1]).toBeCloseTo(ring[ring.length - 1][1], 5);

    // Test distance to line corridor: point (0.5, 0.01) is ~1.11 km North of the middle of the segment
    const distRes = distanceToLineString([0.5, 0.01], route);
    expect(distRes.minDistanceM).toBeGreaterThan(1000);
    expect(distRes.minDistanceM).toBeLessThan(1200);
    expect(distRes.targetCoord[0]).toBeCloseTo(0.5, 2);
    expect(distRes.targetCoord[1]).toBeCloseTo(0, 2);
  });

  it("classifies multi-ring buffer hits into concentric bands", async () => {
    const mockLayers: DatasetLayer[] = [
      {
        id: "mock_targets",
        datasetId: "ds_1",
        name: "Targets",
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
          // Target 1: ~1.11 km away (Band 1: <= 2000m)
          { id: "t1", geometry: { type: "Point", coordinates: [0, 0.01] }, properties: {} },
          // Target 2: ~3.33 km away (Band 2: 2000m - 5000m)
          { id: "t2", geometry: { type: "Point", coordinates: [0, 0.03] }, properties: {} },
          // Target 3: ~8.89 km away (Band 3: 5000m - 10000m)
          { id: "t3", geometry: { type: "Point", coordinates: [0, 0.08] }, properties: {} },
        ],
      },
    ];

    const ringThresholds = [2000, 5000, 10000];
    const result = await spatialBufferQuery(0, 0, 10000, undefined, 100, mockLayers, undefined, ringThresholds);

    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.total_hits).toBe(3);
    expect(result.hits[0].feature_id).toBe("t1");
    expect(result.hits[0].ring_band).toBe(1);

    expect(result.hits[1].feature_id).toBe("t2");
    expect(result.hits[1].ring_band).toBe(2);

    expect(result.hits[2].feature_id).toBe("t3");
    expect(result.hits[2].ring_band).toBe(3);
  });

  it("evaluates isBearingInSector with standard and 360-degree wraparound sectors", () => {
    // Standard sector: East quadrant (45° to 135°)
    expect(isBearingInSector(90, 45, 135)).toBe(true);
    expect(isBearingInSector(45, 45, 135)).toBe(true);
    expect(isBearingInSector(135, 45, 135)).toBe(true);
    expect(isBearingInSector(0, 45, 135)).toBe(false);
    expect(isBearingInSector(180, 45, 135)).toBe(false);
    expect(isBearingInSector(270, 45, 135)).toBe(false);

    // Wraparound sector across North (315° to 45°, 90° fan)
    expect(isBearingInSector(0, 315, 45)).toBe(true);
    expect(isBearingInSector(350, 315, 45)).toBe(true);
    expect(isBearingInSector(30, 315, 45)).toBe(true);
    expect(isBearingInSector(315, 315, 45)).toBe(true);
    expect(isBearingInSector(45, 315, 45)).toBe(true);
    expect(isBearingInSector(90, 315, 45)).toBe(false);
    expect(isBearingInSector(180, 315, 45)).toBe(false);
    expect(isBearingInSector(270, 315, 45)).toBe(false);

    // Full 360 circle
    expect(isBearingInSector(180, 0, 360)).toBe(true);
    expect(isBearingInSector(270, 90, 90)).toBe(true);
  });

  it("creates valid geodesic sector polygons for pie wedge and doughnut blind-radius", () => {
    const outerRadius = 10000; // 10 km

    // 1. Standard Pie Wedge (0° to 90°, East/North quadrant, innerRadius = 0)
    const pieWedge = createGeodesicSectorBuffer(0, 0, outerRadius, 0, 90, 0);
    expect(pieWedge.geometry.type).toBe("Polygon");
    const pieRing = pieWedge.geometry.coordinates[0];
    expect(pieRing.length).toBeGreaterThan(10);
    // Closed ring
    expect(pieRing[0][0]).toBeCloseTo(pieRing[pieRing.length - 1][0], 5);
    expect(pieRing[0][1]).toBeCloseTo(pieRing[pieRing.length - 1][1], 5);

    // 2. Doughnut Sector / Radar Fan with dead zone (innerRadius = 3000m)
    const doughnut = createGeodesicSectorBuffer(0, 0, outerRadius, 45, 135, 3000);
    expect(doughnut.geometry.type).toBe("Polygon");
    const doughnutRing = doughnut.geometry.coordinates[0];
    expect(doughnutRing.length).toBeGreaterThan(20);
    // Closed ring
    expect(doughnutRing[0][0]).toBeCloseTo(doughnutRing[doughnutRing.length - 1][0], 5);
    expect(doughnutRing[0][1]).toBeCloseTo(doughnutRing[doughnutRing.length - 1][1], 5);
  });

  it("filters spatial buffer query targets by directional sector and blind dead-zone", async () => {
    const mockLayers: DatasetLayer[] = [
      {
        id: "sector_targets",
        datasetId: "ds_sec",
        name: "Sector Targets",
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
          // Target North: ~5.55 km North (bearing ~0°)
          { id: "tgt_north", geometry: { type: "Point", coordinates: [0, 0.05] }, properties: {} },
          // Target East: ~5.55 km East (bearing ~90°)
          { id: "tgt_east", geometry: { type: "Point", coordinates: [0.05, 0] }, properties: {} },
          // Target South: ~5.55 km South (bearing ~180°)
          { id: "tgt_south", geometry: { type: "Point", coordinates: [0, -0.05] }, properties: {} },
          // Target DeadZone North: ~1.11 km North (bearing ~0°, within 2000m dead zone)
          { id: "tgt_blind_north", geometry: { type: "Point", coordinates: [0, 0.01] }, properties: {} },
        ],
      },
    ];

    // Query North sector: 315° to 45°, outerRadius 10,000m, dead-zone 2,000m
    const northSectorResult = await spatialBufferQuery(
      0,
      0,
      10000,
      undefined,
      100,
      mockLayers,
      undefined,
      undefined,
      {
        startAzimuthDeg: 315,
        endAzimuthDeg: 45,
        innerRadiusMeters: 2000,
      },
    );

    expect(northSectorResult).not.toBeNull();
    if (!northSectorResult) return;

    // Only tgt_north should match (tgt_east and tgt_south are out of azimuth; tgt_blind_north is < 2000m)
    expect(northSectorResult.total_hits).toBe(1);
    expect(northSectorResult.hits[0].feature_id).toBe("tgt_north");
  });

  it("filters corridor buffer queries by Port (Left) and Starboard (Right) sides with flat/round caps", async () => {
    // Equator route heading East: (0, 0) -> (1, 0)
    const route: [number, number][] = [
      [0, 0],
      [1, 0],
    ];

    const mockLayers: DatasetLayer[] = [
      {
        id: "corridor_targets",
        datasetId: "ds_corr",
        name: "Corridor Targets",
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
          // Port (Left / North of eastbound line): ~2.22 km North
          { id: "ship_port", geometry: { type: "Point", coordinates: [0.5, 0.02] }, properties: {} },
          // Starboard (Right / South of eastbound line): ~2.22 km South
          { id: "ship_starboard", geometry: { type: "Point", coordinates: [0.5, -0.02] }, properties: {} },
        ],
      },
    ];

    // 1. Port / Left only query
    const portResult = await spatialBufferQuery(
      0,
      0,
      5000,
      undefined,
      100,
      mockLayers,
      route,
      undefined,
      undefined,
      { sideType: "left", capStyle: "flat" },
    );
    expect(portResult).not.toBeNull();
    if (!portResult) return;
    expect(portResult.total_hits).toBe(1);
    expect(portResult.hits[0].feature_id).toBe("ship_port");

    // 2. Starboard / Right only query
    const stbdResult = await spatialBufferQuery(
      0,
      0,
      5000,
      undefined,
      100,
      mockLayers,
      route,
      undefined,
      undefined,
      { sideType: "right", capStyle: "flat" },
    );
    expect(stbdResult).not.toBeNull();
    if (!stbdResult) return;
    expect(stbdResult.total_hits).toBe(1);
    expect(stbdResult.hits[0].feature_id).toBe("ship_starboard");

    // 3. Both sides query
    const bothResult = await spatialBufferQuery(
      0,
      0,
      5000,
      undefined,
      100,
      mockLayers,
      route,
      undefined,
      undefined,
      { sideType: "both", capStyle: "round" },
    );
    expect(bothResult).not.toBeNull();
    if (!bothResult) return;
    expect(bothResult.total_hits).toBe(2);

    // 4. Verify flat cap geometry generation
    const flatBuffer = createGeodesicLineBuffer(route, 5000, { sideType: "both", capStyle: "flat" });
    expect(flatBuffer.geometry.type).toBe("Polygon");
    const flatRing = flatBuffer.geometry.coordinates[0];
    expect(flatRing[0][0]).toBeCloseTo(flatRing[flatRing.length - 1][0], 5);
    expect(flatRing[0][1]).toBeCloseTo(flatRing[flatRing.length - 1][1], 5);
  });

  it("computes accurate geodesic coverage area and density metrics for spatial buffer queries", async () => {
    // 5 km buffer at (0, 0) -> Area = pi * 5000^2 ~ 78.54 km^2
    const result = await spatialBufferQuery(0, 0, 5000);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.area_sq_meters).toBeDefined();
    expect(result.area_sq_km).toBeDefined();
    expect(result.area_acres).toBeDefined();

    expect(result.area_sq_km!).toBeGreaterThan(75);
    expect(result.area_sq_km!).toBeLessThan(82);
    expect(result.buffer_geojson.properties.area_sq_km).toBeCloseTo(result.area_sq_km!, 2);
  });

  it("normalizes antimeridian-crossing buffer circles and corridors into valid MultiPolygon GeoJSON", () => {
    // Center at 179.5 deg Lon, 0 deg Lat. Radius 100,000 meters (~0.9 degrees).
    // Buffer crosses 180 deg into -179.6 deg.
    const pointBuffer = createGeodesicPointBuffer(179.5, 0, 100_000);
    expect(pointBuffer.geometry.type).toBe("MultiPolygon");
    expect(pointBuffer.geometry.coordinates).toHaveLength(2);

    const [eastPoly, westPoly] = pointBuffer.geometry.coordinates;
    // East ring should stay >= 0 (and touch +180)
    for (const pt of eastPoly[0]) {
      expect(pt[0]).toBeGreaterThanOrEqual(0);
    }
    // West ring should stay <= 0 (and touch -180)
    for (const pt of westPoly[0]) {
      expect(pt[0]).toBeLessThanOrEqual(0);
    }

    // A corridor crossing the antimeridian
    const route: [number, number][] = [
      [179.0, 10.0],
      [-179.0, 10.0],
    ];
    const corridorBuffer = createGeodesicLineBuffer(route, 20_000);
    expect(corridorBuffer.geometry.type).toBe("MultiPolygon");
    expect(corridorBuffer.geometry.coordinates).toHaveLength(2);

    // Direct ring normalization test
    const rawRing: [number, number][] = [
      [179.0, 0.0],
      [-179.0, 0.0],
      [-179.0, 1.0],
      [179.0, 1.0],
      [179.0, 0.0],
    ];
    const normalized = normalizeAntimeridianPolygon(rawRing);
    expect(normalized.type).toBe("MultiPolygon");
    expect(normalized.coordinates).toHaveLength(2);
  });

  it("handles outward polygon buffering and inward setbacks (negative erosion)", () => {
    // 10 km x 10 km square centered at (0, 0)
    // ~ 0.09 degrees per 10 km
    const square: [number, number][] = [
      [-0.05, -0.05],
      [0.05, -0.05],
      [0.05, 0.05],
      [-0.05, 0.05],
      [-0.05, -0.05],
    ];

    // 1. Outward buffer (+2000m)
    const expanded = createGeodesicPolygonBuffer(square, 2000);
    expect(expanded).not.toBeNull();
    expect(expanded.properties.is_setback).toBe(false);
    expect(expanded.properties.is_collapsed).toBe(false);
    // Outer corner should be further away from center
    expect(expanded.geometry.coordinates[0][0][0]).toBeLessThan(-0.05);

    // 2. Inward setback (-2000m)
    const eroded = createGeodesicPolygonBuffer(square, -2000);
    expect(eroded).not.toBeNull();
    expect(eroded.properties.is_setback).toBe(true);
    expect(eroded.properties.is_collapsed).toBe(false);
    // Inner corner should move inward toward 0
    expect(eroded.geometry.coordinates[0][0][0]).toBeGreaterThan(-0.05);
    expect(eroded.geometry.coordinates[0][0][0]).toBeLessThan(0);

    // 3. Catastrophic setback that collapses the polygon (-50,000m)
    const collapsed = createGeodesicPolygonBuffer(square, -50000);
    expect(collapsed).not.toBeNull();
    expect(collapsed.properties.is_collapsed).toBe(true);
  });

  it("calculates k-NN nearest neighbors with forward bearings and 16-point compass directions", async () => {
    const candidates = [
      { id: "NorthPoint", lon: 0.0, lat: 1.0 },
      { id: "EastPoint", lon: 1.0, lat: 0.0 },
      { id: "SouthPoint", lon: 0.0, lat: -1.0 },
      { id: "WestPoint", lon: -1.0, lat: 0.0 },
      { id: "FarAway", lon: 10.0, lat: 10.0 },
    ];

    // Query from origin (0, 0)
    const res = await spatialKnnQuery(candidates, 0.0, 0.0, undefined, 4);
    expect(res).not.toBeNull();
    if (!res) return;

    expect(res.neighbors).toHaveLength(4);
    expect(res.neighbors.map((n) => n.id)).not.toContain("FarAway");

    // Check NorthPoint
    const north = res.neighbors.find((n) => n.id === "NorthPoint");
    expect(north).toBeDefined();
    expect(north!.compass_direction).toBe("N");
    expect(Math.abs(north!.bearing_deg)).toBeLessThan(1.0);

    // Check EastPoint
    const east = res.neighbors.find((n) => n.id === "EastPoint");
    expect(east).toBeDefined();
    expect(east!.compass_direction).toBe("E");
    expect(Math.abs(east!.bearing_deg - 90)).toBeLessThan(1.0);

    // Check SouthPoint
    const south = res.neighbors.find((n) => n.id === "SouthPoint");
    expect(south).toBeDefined();
    expect(south!.compass_direction).toBe("S");
    expect(Math.abs(south!.bearing_deg - 180)).toBeLessThan(1.0);

    // Check WestPoint
    const west = res.neighbors.find((n) => n.id === "WestPoint");
    expect(west).toBeDefined();
    expect(west!.compass_direction).toBe("W");
    expect(Math.abs(west!.bearing_deg - 270)).toBeLessThan(1.0);
  });

  it("applies maxDistanceMeters cutoff radius filtering in k-NN queries", async () => {
    const candidates = [
      { id: "Close", lon: 0.0, lat: 0.01 }, // ~1.11 km
      { id: "Medium", lon: 0.0, lat: 0.1 },  // ~11.1 km
      { id: "Far", lon: 0.0, lat: 1.0 },     // ~111 km
    ];

    // Max distance: 5 km (5000m) -> only "Close" should match
    const res = await spatialKnnQuery(candidates, 0.0, 0.0, undefined, 10, 5000);
    expect(res).not.toBeNull();
    if (!res) return;

    expect(res.neighbors).toHaveLength(1);
    expect(res.neighbors[0].id).toBe("Close");
    expect(res.neighbors[0].surface_distance_m).toBeLessThan(5000);
  });

  it("converts bearings to accurate 16-point compass directions", () => {
    expect(bearingToCompassDirection(0)).toBe("N");
    expect(bearingToCompassDirection(360)).toBe("N");
    expect(bearingToCompassDirection(22.5)).toBe("NNE");
    expect(bearingToCompassDirection(45)).toBe("NE");
    expect(bearingToCompassDirection(67.5)).toBe("ENE");
    expect(bearingToCompassDirection(90)).toBe("E");
    expect(bearingToCompassDirection(135)).toBe("SE");
    expect(bearingToCompassDirection(180)).toBe("S");
    expect(bearingToCompassDirection(225)).toBe("SW");
    expect(bearingToCompassDirection(270)).toBe("W");
    expect(bearingToCompassDirection(315)).toBe("NW");
    expect(bearingToCompassDirection(350)).toBe("N");
  });

  it("extracts representative centroids across all GeoJSON geometry types", () => {
    // Point
    expect(extractFeatureCentroid({ type: "Point", coordinates: [10, 20] })).toEqual([10, 20]);

    // MultiPoint
    expect(extractFeatureCentroid({
      type: "MultiPoint",
      coordinates: [[10, 20], [20, 40]],
    })).toEqual([15, 30]);

    // LineString
    expect(extractFeatureCentroid({
      type: "LineString",
      coordinates: [[0, 0], [10, 10]],
    })).toEqual([5, 5]);

    // Polygon
    expect(extractFeatureCentroid({
      type: "Polygon",
      coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]],
    })).toEqual([4, 4]);

    // Invalid or empty
    expect(extractFeatureCentroid(null)).toBeNull();
    expect(extractFeatureCentroid({ type: "Point", coordinates: [] })).toBeNull();
  });
});
