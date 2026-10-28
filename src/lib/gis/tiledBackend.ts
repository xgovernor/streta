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
