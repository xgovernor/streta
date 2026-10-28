import { invoke, isTauri } from "@tauri-apps/api/core";
import type { FeatureRecord } from "./types";

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
}

export interface ElevationProfileResult {
  total_distance_m: number;
  min_elevation_m: number;
  max_elevation_m: number;
  elevation_gain_m: number;
  elevation_loss_m: number;
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
): Promise<SpatialQueryResult | null> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<SpatialQueryResult>("spatial_buffer_query", {
        centerLon,
        centerLat,
        radiusMeters,
        layerIds: layerIds ?? null,
        maxResults,
      });
    } catch (err) {
      console.error("spatial_buffer_query error:", err);
      return null;
    }
  }

  return null;
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
    // Simple polygon area on sphere
    let sumLon = 0;
    let sumLat = 0;
    for (const c of coords) {
      sumLon += c[0];
      sumLat += c[1];
    }
    centroid = [sumLon / coords.length, sumLat / coords.length];
    areaSqM = 0; // rough placeholder for web fallback
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
  const count = Math.min(Math.max(sampleCount, 10), 80);
  const lats: number[] = [];
  const lons: number[] = [];
  const distances: number[] = [];

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const totalSegments = coords.length - 1;
    const scaledT = t * totalSegments;
    const segIdx = Math.min(Math.floor(scaledT), totalSegments - 1);
    const segT = scaledT - segIdx;

    const p1 = coords[segIdx];
    const p2 = coords[segIdx + 1];

    const lon = p1[0] + (p2[0] - p1[0]) * segT;
    const lat = p1[1] + (p2[1] - p1[1]) * segT;

    lons.push(Number(lon.toFixed(5)));
    lats.push(Number(lat.toFixed(5)));
    distances.push(i * 100); // approximate
  }

  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(",")}&longitude=${lons.join(",")}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const elevs: (number | null)[] = data.elevation || [];

  const samples: ElevationSample[] = [];
  let minElev = Infinity;
  let maxElev = -Infinity;
  let gain = 0;
  let loss = 0;
  let prevElev: number | null = null;

  for (let i = 0; i < count; i++) {
    const e = elevs[i] ?? 0;
    minElev = Math.min(minElev, e);
    maxElev = Math.max(maxElev, e);

    if (prevElev !== null) {
      const diff = e - prevElev;
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);
    }
    prevElev = e;

    samples.push({
      distance_m: distances[i],
      lon: lons[i],
      lat: lats[i],
      elevation_m: e,
    });
  }

  return {
    total_distance_m: distances[distances.length - 1] || 0,
    min_elevation_m: minElev === Infinity ? 0 : minElev,
    max_elevation_m: maxElev === -Infinity ? 0 : maxElev,
    elevation_gain_m: gain,
    elevation_loss_m: loss,
    samples,
  };
}
