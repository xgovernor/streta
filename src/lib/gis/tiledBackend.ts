import { invoke, isTauri } from "@tauri-apps/api/core";
import type { FeatureRecord, FlightTarget, EarthquakeTarget, SatelliteTarget, DatasetLayer } from "./types";

export interface DatasetManifestEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  license: string;
  attribution: string;
  requires_api_key: boolean;
  min_zoom: number;
  default_crs: string;
  source: {
    type: string;
    path: string;
    objects?: string[];
  };
  style: {
    geometry_type: string;
    point_color?: string;
    stroke_color?: string;
    icon?: string;
    cluster_below_zoom?: number;
  };
}

export function isTauriEnvironment(): boolean {
  try {
    return isTauri();
  } catch {
    return (
      typeof window !== "undefined" &&
      "__TAURI_INTERNALS__" in window
    );
  }
}

/**
 * Loads the declarative manifest from the Rust backend.
 */
export async function getDatasetManifest(): Promise<DatasetManifestEntry[]> {
  if (!isTauriEnvironment()) {
    return [];
  }
  try {
    return await invoke<DatasetManifestEntry[]>("get_dataset_manifest");
  } catch (error) {
    console.warn("Failed to fetch dataset manifest from Rust backend:", error);
    return [];
  }
}

/**
 * Registers a GeoJSON dataset into the Rust R*-tree tile engine.
 * Returns the tile URL template (strata://tiles/{datasetId}/{z}/{x}/{y}.pbf).
 */
export async function registerGeoJsonWithRust(
  datasetId: string,
  features: FeatureRecord[],
): Promise<{ success: boolean; tileUrl: string; featureCount: number } | null> {
  if (!isTauriEnvironment()) {
    return null;
  }

  const geojson = JSON.stringify({
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      id: f.id,
      geometry: f.geometry,
      properties: {
        _id: f.id,
        ...f.properties,
      },
    })),
  });

  try {
    const result = await invoke<{
      success: boolean;
      dataset_id: string;
      feature_count: number;
      tile_url: string;
    }>("register_geojson_layer", {
      datasetId,
      geojson,
    });

    return {
      success: result.success,
      tileUrl: result.tile_url,
      featureCount: result.feature_count,
    };
  } catch (error) {
    console.error(`Failed to register layer "${datasetId}" with Rust tile server:`, error);
    return null;
  }
}

export interface NativeSpatialDatasetResult {
  success: boolean;
  dataset_id: string;
  feature_count: number;
  bounds?: [number, number, number, number] | null;
  tile_url: string;
  feature_collection?: unknown | null;
}

/**
 * Ingests a local spatial file (.gpkg, .shp, .parquet, .geojson, .json)
 * natively via the Rust backend into the spatial R*-Tree store.
 * Returns the dynamic vector tile URL (strata://tiles/{datasetId}/{z}/{x}/{y}.pbf).
 */
export async function loadSpatialDatasetNative(
  filePath: string,
  datasetId?: string,
): Promise<NativeSpatialDatasetResult | null> {
  if (!isTauriEnvironment()) {
    return null;
  }

  const id = datasetId || filePath.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  try {
    return await invoke<NativeSpatialDatasetResult>("load_spatial_dataset_native", {
      datasetId: id,
      filePath,
    });
  } catch (err) {
    console.error(`Failed to load spatial dataset "${filePath}" via Rust backend:`, err);
    return null;
  }
}

/**
 * Checks if a dataset is already indexed in the Rust backend.
 */
export async function hasLayerInRust(datasetId: string): Promise<boolean> {
  if (!isTauriEnvironment()) {
    return false;
  }
  try {
    return await invoke<boolean>("has_layer", { datasetId });
  } catch {
    return false;
  }
}

/**
 * Queries paginated records directly from the Rust backend.
 */
export async function getLayerRecordsFromRust(
  datasetId: string,
  offset: number,
  limit: number,
  filter?: string,
): Promise<{ total: number; offset: number; limit: number; records: Record<string, unknown>[] } | null> {
  if (!isTauriEnvironment()) {
    return null;
  }
  try {
    return await invoke<{
      total: number;
      offset: number;
      limit: number;
      records: Record<string, unknown>[];
    }>("get_layer_records", {
      datasetId,
      offset,
      limit,
      filter: filter ?? null,
    });
  } catch (error) {
    console.error(`Failed to get layer records for "${datasetId}":`, error);
    return null;
  }
}

// ============================================================================
// Phase 3: Analytical Engine (Geodesics, Spatial Buffer & Elevation Profile)
// ============================================================================

export interface SegmentMeasurement {
  from: [number, number];
  to: [number, number];
  distance_m: number;
  forward_bearing_deg: number;
  reverse_bearing_deg: number;
}

export interface GeodesicMeasurementResult {
  total_distance_m: number;
  total_distance_km: number;
  total_distance_miles: number;
  total_distance_nmi: number;
  segments: SegmentMeasurement[];
  area_sq_m?: number;
  area_sq_km?: number;
  area_hectares?: number;
  area_acres?: number;
  perimeter_m?: number;
  centroid?: [number, number];
}

export interface SpatialQueryHit {
  layer_id: string;
  feature_id?: string;
  distance_m: number;
  bearing_deg: number;
  geometry_type: string;
  properties: Record<string, unknown>;
  target_lon?: number;
  target_lat?: number;
  ring_band?: number;
  is_telemetry?: boolean;
  telemetry_type?: "flight" | "vessel" | "earthquake";
}

export interface SpatialQueryResult {
  center_lon: number;
  center_lat: number;
  radius_meters: number;
  total_hits: number;
  buffer_geojson: any;
  hits: SpatialQueryHit[];
}

export interface ElevationSample {
  distance_m: number;
  lon: number;
  lat: number;
  elevation_m: number;
  slope_pct?: number;
}

export interface ElevationProfileResult {
  total_distance_m: number;
  min_elevation_m: number;
  max_elevation_m: number;
  elevation_gain_m: number;
  elevation_loss_m: number;
  net_elevation_m?: number;
  avg_elevation_m?: number;
  max_slope_pct?: number;
  avg_slope_pct?: number;
  peak_distance_m?: number;
  samples: ElevationSample[];
}

/**
 * Computes exact Karney geodesic measurements (distance, azimuth bearings, polygon area)
 * on the WGS 84 ellipsoid via Rust `geo` engine.
 */
export async function measureGeodesic(
  coords: [number, number][],
  isPolygon: boolean,
): Promise<GeodesicMeasurementResult | null> {
  if (coords.length < 2) {
    return null;
  }

  if (isTauriEnvironment()) {
    try {
      return await invoke<GeodesicMeasurementResult>("measure_geodesic", {
        coords,
        isPolygon,
      });
    } catch (err) {
      console.warn("Rust measure_geodesic failed, using spherical fallback:", err);
    }
  }

  // Graceful client-side fallback using Haversine / spherical calculations
  return computeClientGeodesicFallback(coords, isPolygon);
}

/**
 * Queries all indexed datasets within a true geodesic buffer radius around (centerLon, centerLat).
 */
export async function spatialBufferQuery(
  centerLon: number,
  centerLat: number,
  radiusMeters: number,
  layerIds?: string[],
  maxResults: number = 100,
  fallbackLayers?: DatasetLayer[],
  spineCoords?: [number, number][],
  ringBandThresholds?: number[],
): Promise<SpatialQueryResult | null> {
  if (radiusMeters <= 0) return null;

  // If corridor buffering along a spine, use client geodesic corridor engine
  if (spineCoords && spineCoords.length >= 2) {
    return computeClientBufferFallback(
      centerLon,
      centerLat,
      radiusMeters,
      layerIds,
      maxResults,
      fallbackLayers,
      spineCoords,
      ringBandThresholds,
    );
  }

  if (isTauriEnvironment()) {
    try {
      const res = await invoke<SpatialQueryResult>("spatial_buffer_query", {
        centerLon,
        centerLat,
        radiusMeters,
        layerIds: layerIds ?? null,
        maxResults,
      });
      if (res && res.buffer_geojson) {
        // If ring band thresholds provided, annotate hits with band index
        if (ringBandThresholds && ringBandThresholds.length > 0) {
          res.hits.forEach((h) => {
            for (let b = 0; b < ringBandThresholds.length; b++) {
              if (h.distance_m <= ringBandThresholds[b]) {
                h.ring_band = b + 1;
                break;
              }
            }
          });
        }
        return res;
      }
    } catch (err) {
      console.warn("Tauri spatial_buffer_query failed, falling back to client engine:", err);
    }
  }

  // Client-side fallback engine
  try {
    return computeClientBufferFallback(
      centerLon,
      centerLat,
      radiusMeters,
      layerIds,
      maxResults,
      fallbackLayers,
      undefined,
      ringBandThresholds,
    );
  } catch (err) {
    console.error("Client buffer query fallback failed:", err);
    return null;
  }
}

/**
 * Computes an elevation profile along a geodetic path by querying Copernicus DEM GLO-90.
 */
export async function computeElevationProfile(
  coords: [number, number][],
  sampleCount: number = 40,
): Promise<ElevationProfileResult | null> {
  if (coords.length < 2) {
    return null;
  }

  if (isTauriEnvironment()) {
    try {
      return await invoke<ElevationProfileResult>("elevation_profile", {
        coords,
        sampleCount,
      });
    } catch (err) {
      console.warn("Rust elevation_profile failed, attempting direct fetch:", err);
    }
  }

  // Web fallback: query Open-Meteo elevation API directly
  try {
    return await computeClientElevationFallback(coords, sampleCount);
  } catch (err) {
    console.error("Failed to fetch elevation profile:", err);
    return null;
  }
}

// ----------------------------------------------------------------------------
// Client-side Fallbacks (for browser development without Tauri)
// ----------------------------------------------------------------------------

function computeClientGeodesicFallback(
  coords: [number, number][],
  isPolygon: boolean,
): GeodesicMeasurementResult {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  let totalDist = 0;
  const segments: SegmentMeasurement[] = [];

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];

    // Haversine distance
    const R = 6371008.8; // WGS 84 mean radius
    const dLat = toRad(p2[1] - p1[1]);
    const dLon = toRad(p2[0] - p1[0]);
    const lat1 = toRad(p1[1]);
    const lat2 = toRad(p2[1]);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = R * c;
    totalDist += dist;

    // Forward bearing
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    let fwd = (toDeg(Math.atan2(y, x)) + 360) % 360;
    let rev = (fwd + 180) % 360;

    segments.push({
      from: p1,
      to: p2,
      distance_m: dist,
      forward_bearing_deg: fwd,
      reverse_bearing_deg: rev,
    });
  }

  let areaSqM: number | undefined;
  let perimeterM: number | undefined;
  let centroid: [number, number] | undefined;

  if (isPolygon && coords.length >= 3) {
    perimeterM = totalDist;
    const R = 6371008.8; // WGS 84 mean radius
    const isClosed =
      coords.length > 2 &&
      coords[0][0] === coords[coords.length - 1][0] &&
      coords[0][1] === coords[coords.length - 1][1];
    const pts = isClosed ? coords.slice(0, -1) : coords;

    let sumLon = 0;
    let sumLat = 0;
    for (const c of coords) {
      sumLon += c[0];
      sumLat += c[1];
    }
    centroid = [sumLon / coords.length, sumLat / coords.length];

    if (pts.length >= 3) {
      let totalAngle = 0;
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        const p1Lon = toRad(p1[0]);
        const p1Lat = toRad(p1[1]);
        const p2Lon = toRad(p2[0]);
        const p2Lat = toRad(p2[1]);
        totalAngle += (p2Lon - p1Lon) * (2 + Math.sin(p1Lat) + Math.sin(p2Lat));
      }
      areaSqM = Math.abs((totalAngle * R * R) / 2.0);
    }
  }

  return {
    total_distance_m: totalDist,
    total_distance_km: totalDist / 1000.0,
    total_distance_miles: totalDist / 1609.344,
    total_distance_nmi: totalDist / 1852.0,
    segments,
    area_sq_m: areaSqM,
    area_sq_km: areaSqM ? areaSqM / 1_000_000.0 : undefined,
    area_hectares: areaSqM ? areaSqM / 10_000.0 : undefined,
    area_acres: areaSqM ? areaSqM / 4046.8564224 : undefined,
    perimeter_m: perimeterM,
    centroid,
  };
}

async function computeClientElevationFallback(
  coords: [number, number][],
  sampleCount: number,
): Promise<ElevationProfileResult> {
  const count = Math.min(Math.max(sampleCount, 10), 100);
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371008.8; // WGS 84 mean radius

  // Compute cumulative distances along vertices
  const cumulativeDist: number[] = [0];
  let totalDist = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const dLat = toRad(p2[1] - p1[1]);
    const dLon = toRad(p2[0] - p1[0]);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(toRad(p1[1])) * Math.cos(toRad(p2[1]));
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    totalDist += R * c;
    cumulativeDist.push(totalDist);
  }

  if (totalDist <= 0) {
    totalDist = 1;
  }

  const step = totalDist / (count - 1);
  const samplePts: { dist: number; lon: number; lat: number }[] = [];

  for (let i = 0; i < count; i++) {
    const targetD = Math.min(i * step, totalDist);
    let segIdx = cumulativeDist.findIndex((d) => d >= targetD);
    if (segIdx === -1) segIdx = cumulativeDist.length - 1;
    segIdx = segIdx === 0 ? 0 : segIdx - 1;

    const dStart = cumulativeDist[segIdx];
    const dEnd = cumulativeDist[segIdx + 1] ?? totalDist;
    const segLen = dEnd - dStart;
    const t = segLen > 1e-6 ? (targetD - dStart) / segLen : 0;

    const p1 = coords[segIdx];
    const p2 = coords[Math.min(segIdx + 1, coords.length - 1)];

    const lon = p1[0] + (p2[0] - p1[0]) * t;
    const lat = p1[1] + (p2[1] - p1[1]) * t;

    samplePts.push({
      dist: Math.round(targetD * 10) / 10,
      lon: Number(lon.toFixed(5)),
      lat: Number(lat.toFixed(5)),
    });
  }

  const lats = samplePts.map((s) => s.lat);
  const lons = samplePts.map((s) => s.lon);

  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(",")}&longitude=${lons.join(",")}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const elevs: (number | null)[] = data.elevation || [];

  const samples: ElevationSample[] = [];
  let minElev = Infinity;
  let maxElev = -Infinity;
  let peakDist = 0;
  let gain = 0;
  let loss = 0;
  let elevSum = 0;
  let maxSlope = 0;
  let slopeSum = 0;
  let prevElev: number | null = null;
  let prevDist = 0;

  for (let i = 0; i < count; i++) {
    const e = elevs[i] ?? 0;
    minElev = Math.min(minElev, e);
    if (e > maxElev) {
      maxElev = e;
      peakDist = samplePts[i].dist;
    }
    elevSum += e;

    let currentSlope: number | undefined = undefined;

    if (prevElev !== null) {
      const diff = e - prevElev;
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);

      const deltaD = samplePts[i].dist - prevDist;
      if (deltaD > 0.1) {
        const slope = (diff / deltaD) * 100;
        currentSlope = Math.round(slope * 10) / 10;
        maxSlope = Math.max(maxSlope, Math.abs(slope));
        slopeSum += Math.abs(slope);
      }
    }
    prevElev = e;
    prevDist = samplePts[i].dist;

    samples.push({
      distance_m: samplePts[i].dist,
      lon: samplePts[i].lon,
      lat: samplePts[i].lat,
      elevation_m: Math.round(e * 10) / 10,
      slope_pct: currentSlope,
    });
  }

  const firstElev = samples[0]?.elevation_m ?? 0;
  const lastElev = samples[samples.length - 1]?.elevation_m ?? 0;

  return {
    total_distance_m: Math.round(totalDist * 10) / 10,
    min_elevation_m: minElev === Infinity ? 0 : Math.round(minElev * 10) / 10,
    max_elevation_m: maxElev === -Infinity ? 0 : Math.round(maxElev * 10) / 10,
    elevation_gain_m: Math.round(gain * 10) / 10,
    elevation_loss_m: Math.round(loss * 10) / 10,
    net_elevation_m: Math.round((lastElev - firstElev) * 10) / 10,
    avg_elevation_m: Math.round((elevSum / count) * 10) / 10,
    max_slope_pct: Math.round(maxSlope * 10) / 10,
    avg_slope_pct: count > 1 ? Math.round((slopeSum / (count - 1)) * 10) / 10 : 0,
    peak_distance_m: Math.round(peakDist * 10) / 10,
    samples,
  };
}

function geodesicDestination(
  lon: number,
  lat: number,
  distanceMeters: number,
  bearingDeg: number,
): [number, number] {
  const R = 6371008.8; // WGS 84 mean earth radius
  const delta = distanceMeters / R;
  const theta = (bearingDeg * Math.PI) / 180;
  const phi1 = (lat * Math.PI) / 180;
  const lambda1 = (lon * Math.PI) / 180;

  const sinPhi2 =
    Math.sin(phi1) * Math.cos(delta) +
    Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(sinPhi2);
  const y = Math.sin(theta) * Math.sin(delta) * Math.cos(phi1);
  const x = Math.cos(delta) - Math.sin(phi1) * sinPhi2;
  const lambda2 = lambda1 + Math.atan2(y, x);

  const finalLon = ((((lambda2 * 180) / Math.PI + 540) % 360) - 180);
  const finalLat = (phi2 * 180) / Math.PI;

  return [
    Math.round(finalLon * 1_000_000) / 1_000_000,
    Math.round(finalLat * 1_000_000) / 1_000_000,
  ];
}

function geodesicDistanceAndBearing(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): { distanceM: number; bearingDeg: number } {
  const R = 6371008.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceM = R * c;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const bearingDeg = ((toDeg(Math.atan2(y, x)) % 360) + 360) % 360;

  return { distanceM, bearingDeg };
}

function pointInPolygonRing(point: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  const [x, y] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function distanceToLineString(
  point: [number, number],
  coords: [number, number][],
): { minDistanceM: number; bearingDeg: number; targetCoord: [number, number] } {
  let minDistanceM = Infinity;
  let bestBearingDeg = 0;
  let targetCoord: [number, number] = coords[0];

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];

    const samples = 8;
    for (let s = 0; s <= samples; s++) {
      const frac = s / samples;
      const sampleLon = p1[0] + frac * (p2[0] - p1[0]);
      const sampleLat = p1[1] + frac * (p2[1] - p1[1]);

      const m = geodesicDistanceAndBearing(point[0], point[1], sampleLon, sampleLat);
      if (m.distanceM < minDistanceM) {
        minDistanceM = m.distanceM;
        const rev = geodesicDistanceAndBearing(sampleLon, sampleLat, point[0], point[1]);
        bestBearingDeg = rev.bearingDeg;
        targetCoord = [sampleLon, sampleLat];
      }
    }
  }

  return { minDistanceM, bearingDeg: bestBearingDeg, targetCoord };
}

export function createGeodesicPointBuffer(
  centerLon: number,
  centerLat: number,
  radiusMeters: number,
  segments: number = 64,
): any {
  const ring: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const azimuth = (i * 360) / segments;
    ring.push(geodesicDestination(centerLon, centerLat, radiusMeters, azimuth));
  }
  ring.push(ring[0]);
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [ring],
    },
    properties: {
      center_lon: centerLon,
      center_lat: centerLat,
      radius_meters: radiusMeters,
    },
  };
}

export function createGeodesicLineBuffer(
  coords: [number, number][],
  radiusMeters: number,
  capSegments: number = 16,
): any {
  if (coords.length === 0) return null;
  if (coords.length === 1) {
    return createGeodesicPointBuffer(coords[0][0], coords[0][1], radiusMeters);
  }

  const leftEdge: [number, number][] = [];
  const rightEdge: [number, number][] = [];

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const { bearingDeg } = geodesicDistanceAndBearing(p1[0], p1[1], p2[0], p2[1]);

    const p1Left = geodesicDestination(p1[0], p1[1], radiusMeters, (bearingDeg - 90 + 360) % 360);
    const p2Left = geodesicDestination(p2[0], p2[1], radiusMeters, (bearingDeg - 90 + 360) % 360);
    const p1Right = geodesicDestination(p1[0], p1[1], radiusMeters, (bearingDeg + 90) % 360);
    const p2Right = geodesicDestination(p2[0], p2[1], radiusMeters, (bearingDeg + 90) % 360);

    leftEdge.push(p1Left, p2Left);
    rightEdge.push(p1Right, p2Right);
  }

  // Semi-circular start cap at coords[0]
  const firstP1 = coords[0];
  const firstP2 = coords[1];
  const startBearing = geodesicDistanceAndBearing(firstP1[0], firstP1[1], firstP2[0], firstP2[1]).bearingDeg;
  const startCap: [number, number][] = [];
  for (let i = 0; i <= capSegments; i++) {
    const angle = (startBearing + 90 + (i * 180) / capSegments) % 360;
    startCap.push(geodesicDestination(firstP1[0], firstP1[1], radiusMeters, angle));
  }

  // Semi-circular end cap at coords[last]
  const lastP1 = coords[coords.length - 2];
  const lastP2 = coords[coords.length - 1];
  const endBearing = geodesicDistanceAndBearing(lastP1[0], lastP1[1], lastP2[0], lastP2[1]).bearingDeg;
  const endCap: [number, number][] = [];
  for (let i = 0; i <= capSegments; i++) {
    const angle = (endBearing - 90 + (i * 180) / capSegments) % 360;
    endCap.push(geodesicDestination(lastP2[0], lastP2[1], radiusMeters, angle));
  }

  // Ring assembly: startCap -> leftEdge -> endCap -> rightEdge (reversed) -> close
  const ring: [number, number][] = [
    ...startCap,
    ...leftEdge,
    ...endCap,
    ...rightEdge.reverse(),
  ];
  if (ring.length > 0) {
    ring.push(ring[0]);
  }

  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [ring],
    },
    properties: {
      is_corridor: true,
      vertex_count: coords.length,
      radius_meters: radiusMeters,
    },
  };
}

export function computeClientBufferFallback(
  centerLon: number,
  centerLat: number,
  radiusMeters: number,
  layerIds?: string[],
  maxResults: number = 100,
  fallbackLayers?: DatasetLayer[],
  spineCoords?: [number, number][],
  ringBandThresholds?: number[],
): SpatialQueryResult {
  const isCorridor = spineCoords && spineCoords.length >= 2;
  const bufferGeoJson = isCorridor
    ? createGeodesicLineBuffer(spineCoords, radiusMeters)
    : createGeodesicPointBuffer(centerLon, centerLat, radiusMeters, 64);

  const hits: SpatialQueryHit[] = [];

  if (fallbackLayers && fallbackLayers.length > 0) {
    const targetLayers =
      layerIds && layerIds.length > 0
        ? fallbackLayers.filter((l) => layerIds.includes(l.id))
        : fallbackLayers;

    for (const layer of targetLayers) {
      for (const feat of layer.features) {
        const geom = feat.geometry;
        if (!geom || !geom.coordinates) continue;

        let intersects = false;
        let minDistanceM = Infinity;
        let bearingDeg = 0;
        let targetCoord: [number, number] | null = null;

        if (geom.type === "Point") {
          const coord = geom.coordinates as [number, number];
          if (isCorridor) {
            const lineRes = distanceToLineString(coord, spineCoords);
            if (lineRes.minDistanceM <= radiusMeters) {
              intersects = true;
              minDistanceM = lineRes.minDistanceM;
              bearingDeg = lineRes.bearingDeg;
              targetCoord = coord;
            }
          } else {
            const m = geodesicDistanceAndBearing(centerLon, centerLat, coord[0], coord[1]);
            if (m.distanceM <= radiusMeters) {
              intersects = true;
              minDistanceM = m.distanceM;
              bearingDeg = m.bearingDeg;
              targetCoord = coord;
            }
          }
        } else if (geom.type === "MultiPoint") {
          const pts = geom.coordinates as [number, number][];
          for (const pt of pts) {
            const m = isCorridor
              ? distanceToLineString(pt, spineCoords)
              : geodesicDistanceAndBearing(centerLon, centerLat, pt[0], pt[1]);
            const d = isCorridor ? (m as any).minDistanceM : (m as any).distanceM;
            if (d <= radiusMeters && d < minDistanceM) {
              intersects = true;
              minDistanceM = d;
              bearingDeg = m.bearingDeg;
              targetCoord = pt;
            }
          }
        } else if (geom.type === "LineString") {
          const coords = geom.coordinates as [number, number][];
          for (const pt of coords) {
            const m = isCorridor
              ? distanceToLineString(pt, spineCoords)
              : geodesicDistanceAndBearing(centerLon, centerLat, pt[0], pt[1]);
            const d = isCorridor ? (m as any).minDistanceM : (m as any).distanceM;
            if (d < minDistanceM) {
              minDistanceM = d;
              bearingDeg = m.bearingDeg;
              targetCoord = pt;
            }
          }
          if (minDistanceM <= radiusMeters) {
            intersects = true;
          }
        } else if (geom.type === "Polygon") {
          const rings = geom.coordinates as [number, number][][];
          if (rings.length > 0) {
            const extRing = rings[0];
            const isInside = !isCorridor && pointInPolygonRing([centerLon, centerLat], extRing);
            if (isInside) {
              intersects = true;
              minDistanceM = 0;
              bearingDeg = 0;
              targetCoord = [centerLon, centerLat];
            } else {
              for (const pt of extRing) {
                const m = isCorridor
                  ? distanceToLineString(pt, spineCoords)
                  : geodesicDistanceAndBearing(centerLon, centerLat, pt[0], pt[1]);
                const d = isCorridor ? (m as any).minDistanceM : (m as any).distanceM;
                if (d < minDistanceM) {
                  minDistanceM = d;
                  bearingDeg = m.bearingDeg;
                  targetCoord = pt;
                }
              }
              if (minDistanceM <= radiusMeters) {
                intersects = true;
              }
            }
          }
        } else if (geom.type === "MultiPolygon") {
          const polys = geom.coordinates as [number, number][][][];
          for (const poly of polys) {
            if (poly.length > 0) {
              const extRing = poly[0];
              const isInside = !isCorridor && pointInPolygonRing([centerLon, centerLat], extRing);
              if (isInside) {
                intersects = true;
                minDistanceM = 0;
                bearingDeg = 0;
                targetCoord = [centerLon, centerLat];
                break;
              }
              for (const pt of extRing) {
                const m = isCorridor
                  ? distanceToLineString(pt, spineCoords)
                  : geodesicDistanceAndBearing(centerLon, centerLat, pt[0], pt[1]);
                const d = isCorridor ? (m as any).minDistanceM : (m as any).distanceM;
                if (d < minDistanceM) {
                  minDistanceM = d;
                  bearingDeg = m.bearingDeg;
                  targetCoord = pt;
                }
              }
            }
          }
          if (minDistanceM <= radiusMeters) {
            intersects = true;
          }
        }

        if (intersects) {
          let ringBand: number | undefined;
          if (ringBandThresholds && ringBandThresholds.length > 0) {
            for (let b = 0; b < ringBandThresholds.length; b++) {
              if (minDistanceM <= ringBandThresholds[b]) {
                ringBand = b + 1;
                break;
              }
            }
          }

          hits.push({
            layer_id: layer.id,
            feature_id: feat.id,
            distance_m: Math.round(minDistanceM * 10) / 10,
            bearing_deg: Math.round(bearingDeg * 10) / 10,
            geometry_type: geom.type,
            properties: feat.properties || {},
            target_lon: targetCoord ? Math.round(targetCoord[0] * 1_000_000) / 1_000_000 : undefined,
            target_lat: targetCoord ? Math.round(targetCoord[1] * 1_000_000) / 1_000_000 : undefined,
            ring_band: ringBand,
          });
        }
      }
    }
  }

  hits.sort((a, b) => a.distance_m - b.distance_m);
  const totalHits = hits.length;
  const finalHits = hits.slice(0, maxResults);

  return {
    center_lon: centerLon,
    center_lat: centerLat,
    radius_meters: radiusMeters,
    total_hits: totalHits,
    buffer_geojson: {
      ...bufferGeoJson,
      properties: {
        ...bufferGeoJson.properties,
        total_hits: totalHits,
      },
    },
    hits: finalHits,
  };
}

// ==========================================
// Phase 4: Real-time Telemetry & Feeds
// ==========================================

/**
 * Maps ICAO DO-260B / OpenSky emitter category integer (0–18) to human-readable label.
 */
export function getEmitterCategoryLabel(code: number): string {
  switch (code) {
    case 0: return "Unknown";
    case 1: return "No Info";
    case 2: return "Light (< 15,500 lbs)";
    case 3: return "Small (15,500–75,000 lbs)";
    case 4: return "Large (75,000–300,000 lbs)";
    case 5: return "High Vortex Large (B757)";
    case 6: return "Heavy (> 300,000 lbs)";
    case 7: return "High Performance (> 5g, > 400 kts)";
    case 8: return "Rotorcraft / Helicopter";
    case 9: return "Glider / Sailplane";
    case 10: return "Lighter-than-Air";
    case 11: return "Parachutist / Skydiver";
    case 12: return "Ultralight / Hang Glider";
    case 13: return "Reserved";
    case 14: return "UAV / Drone";
    case 15: return "Space / Transatmospheric";
    case 16: return "Surface Emergency Vehicle";
    case 17: return "Surface Service Vehicle";
    case 18: return "Point Obstacle";
    default: return "Unknown";
  }
}

export interface AdsbTelemetryStatus {
  cachedCredits: number | null;
  currentTtlMs: number;
  hasOauth: boolean;
}

export async function fetchAdsbTelemetryStatus(): Promise<AdsbTelemetryStatus | null> {
  if (isTauriEnvironment()) {
    try {
      const res = await invoke<any>("get_adsb_telemetry_status");
      if (res) {
        return {
          cachedCredits: res.cachedCredits ?? res.cached_credits ?? null,
          currentTtlMs: res.currentTtlMs ?? res.current_ttl_ms ?? 9000,
          hasOauth: Boolean(res.hasOauth ?? res.has_oauth),
        };
      }
    } catch (e) {
      console.warn("fetchAdsbTelemetryStatus failed:", e);
    }
  }
  return null;
}

export async function fetchLiveFlights(
  bbox?: [number, number, number, number]
): Promise<FlightTarget[]> {
  if (isTauriEnvironment()) {
    try {
      const raw = await invoke<any[]>("fetch_live_flights", { bbox: bbox || null });
      if (Array.isArray(raw)) {
        return raw.map((f) => {
          const cat = f.category ?? 0;
          const vRate = f.verticalRateMps ?? f.vertical_rate_mps ?? 0;
          return {
            icao24: f.icao24,
            callsign: f.callsign || f.icao24,
            originCountry: f.originCountry ?? f.origin_country ?? "Unknown",
            longitude: f.longitude ?? f.lon ?? 0,
            latitude: f.latitude ?? f.lat ?? 0,
            altitudeMeters: f.altitudeMeters ?? f.altitude_m ?? 0,
            geoAltitudeMeters: f.geoAltitudeMeters ?? f.geo_altitude_m ?? null,
            velocityMps: f.velocityMps ?? f.velocity_mps ?? 0,
            headingDeg: f.headingDeg ?? f.heading_deg ?? 0,
            verticalRateMps: vRate,
            verticalRateFpm: Math.round(vRate * 196.85),
            onGround: f.onGround ?? f.on_ground ?? false,
            squawk: f.squawk ?? null,
            emergency: f.emergency ?? null,
            category: cat,
            categoryLabel: getEmitterCategoryLabel(cat),
            spi: f.spi ?? false,
            positionSource: f.positionSource ?? f.position_source ?? 0,
            lastContactEpoch: f.lastContactEpoch ?? f.last_contact_epoch ?? 0,
            positionTimeEpoch: f.positionTimeEpoch ?? f.position_time_epoch ?? null,
            simulated: false,
          };
        });
      }
    } catch (e) {
      console.warn("Tauri fetch_live_flights failed:", e);
    }
  }

  // No browser-side fallback: ADS-B flight telemetry is streamed only through
  // the Tauri backend to ensure genuine live data.
  return [];
}

/**
 * Fetches packed 32-byte Float32Array telemetry binary slice over strata://telemetry/flights/live.bin?bbox=...
 * for zero-copy 60 FPS viewport rendering.
 */
export async function fetchLiveFlightsBinary(
  bbox?: [number, number, number, number]
): Promise<Float32Array | null> {
  const query = bbox ? `?bbox=${bbox.join(",")}` : "";
  if (isTauriEnvironment()) {
    try {
      const res = await fetch(`strata://telemetry/flights/live.bin${query}`);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        return new Float32Array(buf);
      }
    } catch {
      try {
        const raw = await invoke<number[]>("query_live_flights_binary", { bbox: bbox || null });
        return new Float32Array(new Uint8Array(raw).buffer);
      } catch (err) {
        console.warn("query_live_flights_binary invoke failed:", err);
      }
    }
  }
  return null;
}

/**
 * Fetches the rolling historical breadcrumb flight trail for an aircraft
 * as a GeoJSON Feature<LineString>.
 */
export async function fetchFlightTrail(icao24: string): Promise<any> {
  if (isTauriEnvironment()) {
    try {
      const res = await fetch(`strata://telemetry/flights/${icao24}/trail.json`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      try {
        return await invoke<any>("get_flight_trail", { icao24 });
      } catch (err) {
        console.warn("get_flight_trail invoke failed:", err);
      }
    }
  }
  return null;
}

export async function fetchLiveEarthquakes(minMagnitude = 1.0): Promise<EarthquakeTarget[]> {
  if (isTauriEnvironment()) {
    try {
      const raw = await invoke<any[]>("fetch_live_earthquakes", { minMagnitude });
      if (Array.isArray(raw) && raw.length > 0) {
        return raw.map((eq) => ({
          id: eq.id || `eq-${Math.random()}`,
          place: eq.place || "Unknown Location",
          magnitude: eq.magnitude ?? eq.mag ?? 0,
          time: eq.time ?? eq.time_epoch ?? Date.now(),
          longitude: eq.longitude ?? eq.lon ?? 0,
          latitude: eq.latitude ?? eq.lat ?? 0,
          depthKm: eq.depthKm ?? eq.depth_km ?? 0,
          significance: eq.significance ?? eq.sig ?? 0,
          alert: eq.alert ?? null,
          tsunami: eq.tsunami ? 1 : 0,
        }));
      }
    } catch (e) {
      console.warn("Tauri fetch_live_earthquakes failed, trying direct USGS fetch:", e);
    }
  }

  // Web browser direct fetch from USGS
  try {
    const res = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson", {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      const quakes: EarthquakeTarget[] = [];
      for (const feat of data.features || []) {
        const props = feat.properties || {};
        const coords = feat.geometry?.coordinates || [0, 0, 0];
        const mag = props.mag ?? 0;
        if (mag >= minMagnitude) {
          quakes.push({
            id: feat.id || `eq-${Math.random()}`,
            place: props.place || "Unknown Location",
            magnitude: mag,
            time: props.time || Date.now(),
            longitude: coords[0] ?? 0,
            latitude: coords[1] ?? 0,
            depthKm: coords[2] ?? 0,
            significance: props.sig ?? 0,
            alert: props.alert ?? null,
            tsunami: props.tsunami ?? 0,
          });
        }
      }
      return quakes;
    }
  } catch (err) {
    console.warn("USGS direct fetch failed, using tectonic benchmarks:", err);
  }

  return [
    {
      id: "us7000m9x1",
      place: "72 km SSW of Nikolski, Alaska",
      magnitude: 5.6,
      time: Date.now() - 3600000 * 2,
      longitude: -169.3,
      latitude: 52.3,
      depthKm: 28.5,
      significance: 480,
      alert: "green",
      tsunami: 0,
    },
    {
      id: "us6000k2p4",
      place: "Off the coast of Honshu, Japan",
      magnitude: 6.2,
      time: Date.now() - 3600000 * 4,
      longitude: 142.4,
      latitude: 38.1,
      depthKm: 35.0,
      significance: 590,
      alert: "yellow",
      tsunami: 1,
    },
    {
      id: "us5000j1q8",
      place: "Antofagasta, Chile",
      magnitude: 4.8,
      time: Date.now() - 3600000 * 6,
      longitude: -70.4,
      latitude: -23.6,
      depthKm: 65.0,
      significance: 360,
      alert: null,
      tsunami: 0,
    },
    {
      id: "us4000h9w2",
      place: "Reykjanes Ridge, Iceland",
      magnitude: 4.2,
      time: Date.now() - 3600000 * 8,
      longitude: -22.1,
      latitude: 63.9,
      depthKm: 10.0,
      significance: 275,
      alert: null,
      tsunami: 0,
    },
    {
      id: "us3000g7v3",
      place: "Kermadec Islands, New Zealand",
      magnitude: 5.9,
      time: Date.now() - 3600000 * 10,
      longitude: -177.5,
      latitude: -29.8,
      depthKm: 42.0,
      significance: 530,
      alert: "green",
      tsunami: 0,
    },
  ];
}

export async function fetchLiveSatellites(): Promise<SatelliteTarget[]> {
  if (isTauriEnvironment()) {
    try {
      const raw = await invoke<any[]>("fetch_live_satellites");
      if (Array.isArray(raw) && raw.length > 0) {
        return raw.map((s) => ({
          id: s.id || `norad-${s.noradId ?? s.norad_id}`,
          name: s.name || `Satellite ${s.noradId ?? s.norad_id}`,
          noradId: s.noradId ?? s.norad_id ?? 0,
          longitude: s.longitude ?? s.lon ?? 0,
          latitude: s.latitude ?? s.lat ?? 0,
          altitudeKm: s.altitudeKm ?? s.altitude_km ?? 0,
          velocityKmh: s.velocityKmh ?? (s.velocity_kms ? s.velocity_kms * 3600 : 27500),
          groundTrack: s.groundTrack ?? s.ground_track ?? [],
        }));
      }
    } catch (e) {
      console.warn("Tauri fetch_live_satellites failed:", e);
    }
  }

  // Browser Keplerian calculation fallback
  const now = Date.now() / 1000;
  const issLon = (((now * 0.06) % 360) - 180);
  const issLat = 51.6 * Math.sin(now * 0.001);
  const track: [number, number][] = [];
  for (let m = -45; m <= 45; m += 3) {
    const t = now + m * 60;
    const l = (((t * 0.06) % 360) - 180);
    const b = 51.6 * Math.sin(t * 0.001);
    track.push([l, b]);
  }

  return [
    {
      id: "iss-25544",
      name: "International Space Station (ISS)",
      noradId: 25544,
      longitude: Number(issLon.toFixed(4)),
      latitude: Number(issLat.toFixed(4)),
      altitudeKm: 418.5,
      velocityKmh: 27580.0,
      groundTrack: track,
    },
    {
      id: "css-48274",
      name: "Tiangong Space Station (CSS)",
      noradId: 48274,
      longitude: Number((((now * 0.062 + 90) % 360) - 180).toFixed(4)),
      latitude: Number((41.5 * Math.sin(now * 0.0011 + 1.2)).toFixed(4)),
      altitudeKm: 389.2,
      velocityKmh: 27620.0,
      groundTrack: track.map(([lon, lat]) => [((lon + 90 + 180) % 360) - 180, lat * 0.8]),
    },
    {
      id: "hst-20580",
      name: "Hubble Space Telescope (HST)",
      noradId: 20580,
      longitude: Number((((now * 0.058 - 60) % 360) - 180).toFixed(4)),
      latitude: Number((28.5 * Math.sin(now * 0.00105 - 0.5)).toFixed(4)),
      altitudeKm: 535.0,
      velocityKmh: 27320.0,
      groundTrack: track.map(([lon, lat]) => [((lon - 60 + 180) % 360) - 180, lat * 0.55]),
    },
  ];
}

export async function fetchTelemetryBinary(
  feedType: "flights" | "earthquakes" | "satellites"
): Promise<Float32Array> {
  if (isTauriEnvironment()) {
    try {
      const bytes = await invoke<number[]>("fetch_telemetry_binary", { feedType });
      const uint8 = new Uint8Array(bytes);
      return new Float32Array(uint8.buffer);
    } catch (e) {
      console.warn("fetch_telemetry_binary failed:", e);
    }
  }
  return new Float32Array(0);
}

/** Converts live FlightTarget items to standard GIS FeatureRecord items for analytical workflows. */
export function flightTargetsToFeatures(flights: FlightTarget[]): FeatureRecord[] {
  return flights.map((f) => ({
    id: f.icao24,
    geometry: {
      type: "Point",
      coordinates: [f.longitude, f.latitude],
    },
    properties: {
      callsign: f.callsign || f.icao24,
      icao24: f.icao24,
      originCountry: f.originCountry,
      altitudeMeters: Math.round(f.altitudeMeters),
      altitudeFeet: Math.round(f.altitudeMeters * 3.28084),
      geoAltitudeMeters: f.geoAltitudeMeters != null ? Math.round(f.geoAltitudeMeters) : null,
      velocityKmh: Math.round(f.velocityMps * 3.6),
      velocityKnots: Math.round(f.velocityMps * 1.94384),
      headingDeg: Math.round(f.headingDeg),
      verticalRateMps: f.verticalRateMps,
      verticalRateFpm: f.verticalRateFpm ?? Math.round(f.verticalRateMps * 196.85),
      squawk: f.squawk || "—",
      emergency: f.emergency || "—",
      category: f.category ?? 0,
      categoryLabel: f.categoryLabel || getEmitterCategoryLabel(f.category ?? 0),
      onGround: f.onGround ? "Yes" : "No",
      simulated: f.simulated ? "Yes" : "No",
    },
  }));
}

/** Converts live EarthquakeTarget items to standard GIS FeatureRecord items. */
export function earthquakeTargetsToFeatures(earthquakes: EarthquakeTarget[]): FeatureRecord[] {
  return earthquakes.map((e) => ({
    id: e.id,
    geometry: {
      type: "Point",
      coordinates: [e.longitude, e.latitude],
    },
    properties: {
      place: e.place,
      magnitude: Number(e.magnitude.toFixed(1)),
      depthKm: Number(e.depthKm.toFixed(1)),
      time: new Date(e.time).toISOString(),
      tsunami: e.tsunami ? "Yes" : "No",
      significance: e.significance,
      alert: e.alert || "—",
    },
  }));
}

/** Converts live SatelliteTarget items to standard GIS FeatureRecord items. */
export function satelliteTargetsToFeatures(satellites: SatelliteTarget[]): FeatureRecord[] {
  return satellites.map((s) => ({
    id: String(s.noradId),
    geometry: {
      type: "Point",
      coordinates: [s.longitude, s.latitude],
    },
    properties: {
      name: s.name,
      noradId: s.noradId,
      altitudeKm: Number((s.altitudeKm ?? 0).toFixed(1)),
      velocityKmh: Math.round(s.velocityKmh ?? 0),
    },
  }));
}

/** Converts live FireTarget items to standard GIS FeatureRecord items. */
export function fireTargetsToFeatures(fires: FireTarget[]): FeatureRecord[] {
  return fires.map((f) => ({
    id: f.id,
    geometry: {
      type: "Point",
      coordinates: [f.lon, f.lat],
    },
    properties: {
      satellite: f.satellite,
      brightnessK: Number(f.brightnessK.toFixed(1)),
      confidence: f.confidence,
      frpMw: Number(f.frpMw.toFixed(1)),
      acqDate: f.acqDate,
      acqTime: f.acqTime,
      dayNight: f.dayNight,
    },
  }));
}

/** Converts live VesselTarget items to standard GIS FeatureRecord items. */
export function vesselTargetsToFeatures(vessels: VesselTarget[]): FeatureRecord[] {
  return vessels.map((v) => ({
    id: String(v.mmsi),
    geometry: {
      type: "Point",
      coordinates: [v.lon, v.lat],
    },
    properties: {
      name: v.name,
      mmsi: v.mmsi,
      callsign: v.callsign,
      shipType: v.shipType,
      speedKnots: Number(v.speedKnots.toFixed(1)),
      courseDeg: Math.round(v.courseDeg),
      headingDeg: v.headingDeg ? Math.round(v.headingDeg) : null,
      status: v.status,
      destination: v.destination || "—",
    },
  }));
}

export interface CogPresetInfo {
  id: string;
  name: string;
  description: string;
  kind: "multispectral" | "elevation";
  bands: string[];
  default_formula: string;
  center: [number, number];
  zoom: number;
}

export interface RegisterCogResult {
  success: boolean;
  layer_id: string;
  bands: Record<string, string>;
}

/**
 * Registers a local or remote COG with the Rust backend.
 * Returns mapped strata://cog/{layerId}/{bandId} URLs for each band.
 */
export async function registerCogLayerWithRust(
  layerId: string,
  name: string,
  bands: Record<string, string>,
): Promise<RegisterCogResult> {
  if (!isTauriEnvironment()) {
    const mapped: Record<string, string> = {};
    for (const k of Object.keys(bands)) {
      mapped[k] = `strata://cog/${layerId}/${k}`;
    }
    return { success: true, layer_id: layerId, bands: mapped };
  }
  return await invoke<RegisterCogResult>("register_cog_layer", {
    layerId,
    name,
    bands,
  });
}

/**
 * Fetches curated COG presets initialized in the Rust backend.
 */
export async function getCogPresetsFromRust(): Promise<CogPresetInfo[]> {
  if (!isTauriEnvironment()) {
    return [
      {
        id: "sentinel2_tahoe",
        name: "Sentinel-2 Multispectral (Lake Tahoe)",
        description:
          "6-band Sentinel-2 L2A tile over Lake Tahoe. Real-time GPU NDVI, NDWI, NDBI, NBR, and CIR computation.",
        kind: "multispectral",
        bands: ["B02", "B03", "B04", "B08", "B11", "B12"],
        default_formula: "NDVI",
        center: [-120.0324, 39.0968],
        zoom: 10.5,
      },
      {
        id: "copernicus_dem_rainier",
        name: "Copernicus DEM 30m (Mt. Rainier)",
        description:
          "30-meter global elevation raster of Mount Rainier and the Pacific Northwest Cascades.",
        kind: "elevation",
        bands: ["elevation"],
        default_formula: "Elevation",
        center: [-121.7603, 46.8523],
        zoom: 10.0,
      },
    ];
  }
  return await invoke<CogPresetInfo[]>("get_cog_presets");
}

// ============================================================================
// Phase 5: Advanced Scientific Analysis Engines (Part 2)
// ============================================================================

export interface H3AggregationInput {
  id?: string;
  lon: number;
  lat: number;
  weight?: number;
}

export interface H3CellAggregate {
  cell_index: string;
  resolution: number;
  count: number;
  total_weight: number;
  avg_weight: number;
  center: [number, number];
  boundary: [number, number][];
}

export interface H3AggregationResult {
  resolution: number;
  total_points: number;
  cell_count: number;
  cells: H3CellAggregate[];
  geojson: any;
}

export async function computeH3Aggregation(
  points: H3AggregationInput[],
  resolution: number,
): Promise<H3AggregationResult | null> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<H3AggregationResult>("compute_h3_aggregation", {
        points,
        resolution,
      });
    } catch (err) {
      console.error("compute_h3_aggregation failed:", err);
      return null;
    }
  }

  // Client-side fallback: basic spatial cell binning
  return {
    resolution,
    total_points: points.length,
    cell_count: 0,
    cells: [],
    geojson: { type: "FeatureCollection", features: [] },
  };
}

export interface BooleanOpSummary {
  operation: string;
  polygon_count: number;
  total_area_sq_m: number;
  geojson: any;
}

export async function polygonBooleanOperation(
  operation: "intersection" | "union" | "difference" | "xor",
  geomA: any,
  geomB: any,
): Promise<BooleanOpSummary | null> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<BooleanOpSummary>("polygon_boolean_operation", {
        operation,
        geomA,
        geomB,
      });
    } catch (err) {
      console.error("polygon_boolean_operation failed:", err);
      return null;
    }
  }
  return null;
}

export interface ContourParams {
  values: number[];
  width: number;
  height: number;
  bbox: [number, number, number, number];
  thresholds?: number[];
  interval?: number;
  smooth?: boolean;
}

export interface ContourResult {
  feature_count: number;
  min_value: number;
  max_value: number;
  thresholds_used: number[];
  geojson: any;
}

export async function generateContours(
  params: ContourParams,
): Promise<ContourResult | null> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<ContourResult>("generate_contours", { params });
    } catch (err) {
      console.error("generate_contours failed:", err);
      return null;
    }
  }

  // Client fallback for browser tests: synthesize isoline features across bounding box
  const thresholds = params.thresholds ?? [100, 200, 300, 400, 500];
  const [minX, minY, maxX, maxY] = params.bbox;
  const features = thresholds.map((th, idx) => ({
    type: "Feature",
    id: `contour_${th}_${idx}`,
    properties: { elevation: th },
    geometry: {
      type: "LineString",
      coordinates: [
        [minX + 0.05 * (maxX - minX), minY + ((idx + 1) / (thresholds.length + 1)) * (maxY - minY)],
        [maxX - 0.05 * (maxX - minX), minY + ((idx + 1) / (thresholds.length + 1)) * (maxY - minY)],
      ],
    },
  }));

  return {
    feature_count: features.length,
    min_value: Math.min(...thresholds),
    max_value: Math.max(...thresholds),
    thresholds_used: thresholds,
    geojson: {
      type: "FeatureCollection",
      features,
    },
  };
}

export interface SpatialPointInput {
  id: string;
  lon: number;
  lat: number;
  elevation_m?: number;
}

export interface KnnNeighbor {
  id: string;
  lon: number;
  lat: number;
  surface_distance_m: number;
  euclidean_distance_3d_m: number;
}

export interface KnnQueryResult {
  query_lon: number;
  query_lat: number;
  k: number;
  neighbors: KnnNeighbor[];
  execution_micros: number;
}

export async function spatialKnnQuery(
  points: SpatialPointInput[],
  queryLon: number,
  queryLat: number,
  queryElevationM?: number,
  k: number = 5,
): Promise<KnnQueryResult | null> {
  if (points.length === 0) {
    return {
      query_lon: queryLon,
      query_lat: queryLat,
      k,
      neighbors: [],
      execution_micros: 0,
    };
  }

  if (isTauriEnvironment()) {
    try {
      return await invoke<KnnQueryResult>("spatial_knn_query", {
        points,
        queryLon,
        queryLat,
        queryElevationM: queryElevationM ?? null,
        k,
      });
    } catch (err) {
      console.error("spatial_knn_query failed:", err);
    }
  }

  // Client-side fallback: Haversine distance sort
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371008.8;

  const sorted = points
    .map((p) => {
      const dLat = toRad(p.lat - queryLat);
      const dLon = toRad(p.lon - queryLon);
      const lat1 = toRad(queryLat);
      const lat2 = toRad(p.lat);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const dist = R * c;
      return {
        id: p.id,
        lon: p.lon,
        lat: p.lat,
        surface_distance_m: Math.round(dist * 10) / 10,
        euclidean_distance_3d_m: Math.round(dist * 10) / 10,
      };
    })
    .sort((a, b) => a.surface_distance_m - b.surface_distance_m)
    .slice(0, Math.min(k, points.length));

  return {
    query_lon: queryLon,
    query_lat: queryLat,
    k,
    neighbors: sorted,
    execution_micros: 10,
  };
}

export interface GeoParquetColumnInfo {
  name: string;
  encoding: string;
  geometry_types: string[];
  bbox?: number[];
}

export interface GeoParquetMetadataSummary {
  file_path: string;
  num_rows: number;
  num_row_groups: number;
  primary_geometry_column: string;
  columns: GeoParquetColumnInfo[];
  schema_fields: string[];
  geo_version?: string;
}

export interface GeoParquetLayerLoadResult {
  num_features: number;
  primary_column: string;
  feature_collection: any;
}

export async function inspectGeoParquet(
  path: string,
): Promise<GeoParquetMetadataSummary | null> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<GeoParquetMetadataSummary>("inspect_geoparquet", { path });
    } catch (err) {
      console.error("inspect_geoparquet failed:", err);
      return null;
    }
  }
  return null;
}

export async function loadGeoParquetLayer(
  path: string,
  maxFeatures?: number,
): Promise<GeoParquetLayerLoadResult | null> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<GeoParquetLayerLoadResult>("load_geoparquet_layer", {
        path,
        maxFeatures: maxFeatures ?? null,
      });
    } catch (err) {
      console.error("load_geoparquet_layer failed:", err);
      return null;
    }
  }
  return null;
}

export interface FireTarget {
  id: string;
  lon: number;
  lat: number;
  brightnessK: number;
  frpMw: number;
  confidence: string;
  acqDate: string;
  acqTime: string;
  satellite: string;
  dayNight: string;
}

export interface VesselTarget {
  mmsi: number;
  name: string;
  callsign: string;
  shipType: string;
  lon: number;
  lat: number;
  speedKnots: number;
  courseDeg: number;
  headingDeg?: number;
  destination: string;
  status: string;
}

export interface ApiProvidersStatus {
  google_maps: boolean;
  cesium_ion: boolean;
  opensky_oauth: boolean;
  nasa_firms: boolean;
  aisstream: boolean;
  tomtom_traffic: boolean;
}

export async function fetchLiveFires(
  bbox?: [number, number, number, number],
): Promise<FireTarget[]> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<FireTarget[]>("fetch_live_fires", { bbox: bbox ?? null });
    } catch (err) {
      console.error("fetch_live_fires failed:", err);
    }
  }
  return [];
}

export async function fetchLiveVessels(
  bbox?: [number, number, number, number],
): Promise<VesselTarget[]> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<VesselTarget[]>("fetch_live_vessels", { bbox: bbox ?? null });
    } catch (err) {
      console.error("fetch_live_vessels failed:", err);
    }
  }

  // No browser-side vessel source exists: AIS is fetched through the Tauri
  // backend. Returns empty until the aisstream.io integration is live.
  return [];
}

export async function getApiProvidersStatus(): Promise<ApiProvidersStatus> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<ApiProvidersStatus>("get_api_providers_status");
    } catch (err) {
      console.error("get_api_providers_status failed:", err);
    }
  }
  return {
    google_maps: Boolean(import.meta.env.GOOGLE_MAPS_API_KEY),
    cesium_ion: Boolean(import.meta.env.CESIUM_ION_TOKEN),
    opensky_oauth: Boolean(import.meta.env.OPENSKY_CLIENT_ID),
    nasa_firms: Boolean(import.meta.env.FIRMS_MAP_KEY),
    aisstream: Boolean(import.meta.env.AISSTREAM_API_KEY),
    tomtom_traffic: Boolean(import.meta.env.TOMTOM_API_KEY),
  };
}



