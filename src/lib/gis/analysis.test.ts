import { describe, expect, it } from "bun:test";
import {
  computeElevationProfile,
  createGeodesicLineBuffer,
  createGeodesicSectorBuffer,
  distanceToLineString,
  isBearingInSector,
  measureGeodesic,
  spatialBufferQuery,
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
});
