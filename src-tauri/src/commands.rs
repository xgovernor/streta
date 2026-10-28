use tauri::State;
use serde_json::Value;
use std::fs::File;
use std::io::Read;
use super::tiles::SharedDatasetStore;

#[tauri::command]
pub fn register_geojson_layer(
    store: State<'_, SharedDatasetStore>,
    dataset_id: String,
    geojson: String,
) -> Result<serde_json::Value, String> {
    let mut guard = store.write().map_err(|e| e.to_string())?;
    let count = guard.insert_geojson(&dataset_id, &geojson)?;

    Ok(serde_json::json!({
        "success": true,
        "dataset_id": dataset_id,
        "feature_count": count,
        "tile_url": format!("strata://tiles/{dataset_id}/{{z}}/{{x}}/{{y}}.pbf")
    }))
}

#[tauri::command]
pub fn load_file_layer(
    store: State<'_, SharedDatasetStore>,
    dataset_id: String,
    file_path: String,
) -> Result<serde_json::Value, String> {
    let mut file = File::open(&file_path)
        .map_err(|e| format!("Could not open file '{file_path}': {e}"))?;

    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("Could not read file '{file_path}': {e}"))?;

    let mut guard = store.write().map_err(|e| e.to_string())?;
    let count = guard.insert_geojson(&dataset_id, &content)?;

    Ok(serde_json::json!({
        "success": true,
        "dataset_id": dataset_id,
        "feature_count": count,
        "tile_url": format!("strata://tiles/{dataset_id}/{{z}}/{{x}}/{{y}}.pbf")
    }))
}

#[tauri::command]
pub fn get_layer_records(
    store: State<'_, SharedDatasetStore>,
    dataset_id: String,
    offset: usize,
    limit: usize,
    filter: Option<String>,
) -> Result<Value, String> {
    let guard = store.read().map_err(|e| e.to_string())?;
    guard.get_records(&dataset_id, offset, limit, filter.as_deref())
}

#[tauri::command]
pub fn remove_layer(
    store: State<'_, SharedDatasetStore>,
    dataset_id: String,
) -> Result<bool, String> {
    let mut guard = store.write().map_err(|e| e.to_string())?;
    Ok(guard.clear_dataset(&dataset_id))
}

#[tauri::command]
pub fn has_layer(
    store: State<'_, SharedDatasetStore>,
    dataset_id: String,
) -> Result<bool, String> {
    let guard = store.read().map_err(|e| e.to_string())?;
    Ok(guard.has_dataset(&dataset_id))
}

#[tauri::command]
pub fn get_dataset_manifest() -> Result<Vec<crate::manifest::DatasetManifestEntry>, String> {
    let manifest = crate::manifest::Manifest::load_embedded()?;
    Ok(manifest.datasets)
}

#[tauri::command]
pub fn measure_geodesic(
    coords: Vec<(f64, f64)>,
    is_polygon: bool,
) -> Result<crate::analysis::GeodesicMeasurementResult, String> {
    crate::analysis::measure_geodesic(&coords, is_polygon)
}

#[tauri::command]
pub fn spatial_buffer_query(
    store: State<'_, SharedDatasetStore>,
    center_lon: f64,
    center_lat: f64,
    radius_meters: f64,
    layer_ids: Option<Vec<String>>,
    max_results: Option<usize>,
) -> Result<crate::analysis::SpatialQueryResult, String> {
    let guard = store.read().map_err(|e| e.to_string())?;
    crate::analysis::spatial_buffer_query(
        &guard,
        center_lon,
        center_lat,
        radius_meters,
        layer_ids.as_deref(),
        max_results,
    )
}

#[tauri::command]
pub async fn elevation_profile(
    coords: Vec<(f64, f64)>,
    sample_count: Option<usize>,
) -> Result<crate::analysis::ElevationProfileResult, String> {
    crate::analysis::compute_elevation_profile(&coords, sample_count.unwrap_or(40)).await
}
