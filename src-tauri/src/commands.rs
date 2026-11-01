use tauri::State;
use serde_json::Value;
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
    let mut guard = store.write().map_err(|e| e.to_string())?;
    let count = guard.insert_spatial_file(&dataset_id, &file_path)?;
    let bounds = guard.get_dataset_bounds_4326(&dataset_id);

    let fc = guard.get_dataset_feature_collection(&dataset_id);

    Ok(serde_json::json!({
        "success": true,
        "dataset_id": dataset_id,
        "feature_count": count,
        "bounds": bounds,
        "tile_url": format!("strata://tiles/{dataset_id}/{{z}}/{{x}}/{{y}}.pbf"),
        "feature_collection": fc
    }))
}

#[tauri::command]
pub fn load_spatial_dataset_native(
    store: State<'_, SharedDatasetStore>,
    dataset_id: String,
    file_path: String,
) -> Result<serde_json::Value, String> {
    load_file_layer(store, dataset_id, file_path)
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

#[tauri::command]
pub fn compute_h3_aggregation(
    points: Vec<crate::analysis::H3AggregationInput>,
    resolution: u8,
) -> Result<crate::analysis::H3AggregationResult, String> {
    crate::analysis::aggregate_to_h3(&points, resolution)
}

#[tauri::command]
pub fn polygon_boolean_operation(
    operation: String,
    geom_a: serde_json::Value,
    geom_b: serde_json::Value,
) -> Result<crate::analysis::BooleanOpSummary, String> {
    crate::analysis::execute_polygon_boolean_op(&operation, &geom_a, &geom_b)
}

#[tauri::command]
pub fn generate_contours(
    params: crate::analysis::ContourParams,
) -> Result<crate::analysis::ContourResult, String> {
    crate::analysis::generate_contours(&params)
}

#[tauri::command]
pub fn spatial_knn_query(
    points: Vec<crate::analysis::SpatialPointInput>,
    query_lon: f64,
    query_lat: f64,
    query_elevation_m: Option<f64>,
    k: usize,
    max_distance_meters: Option<f64>,
) -> Result<crate::analysis::KnnQueryResult, String> {
    crate::analysis::query_spatial_knn(
        &points,
        query_lon,
        query_lat,
        query_elevation_m,
        k,
        max_distance_meters,
    )
}

#[tauri::command]
pub fn inspect_geoparquet(
    path: String,
) -> Result<crate::analysis::GeoParquetMetadataSummary, String> {
    crate::analysis::inspect_geoparquet_metadata(&path)
}

#[tauri::command]
pub fn load_geoparquet_layer(
    path: String,
    max_features: Option<usize>,
) -> Result<crate::analysis::GeoParquetLayerLoadResult, String> {
    crate::analysis::load_geoparquet_as_geojson(&path, max_features)
}




#[tauri::command]
pub async fn fetch_live_flights(
    bbox: Option<(f64, f64, f64, f64)>,
) -> Result<Vec<crate::telemetry::FlightTarget>, String> {
    crate::telemetry::fetch_live_flights(bbox).await
}

#[tauri::command]
pub fn get_flight_trail(icao24: String) -> Result<serde_json::Value, String> {
    crate::telemetry::TelemetryDb::global().get_flight_trail(&icao24)
}

#[tauri::command]
pub fn query_live_flights_binary(
    bbox: Option<(f64, f64, f64, f64)>,
) -> Result<Vec<u8>, String> {
    let (min_lon, min_lat, max_lon, max_lat) = bbox.unwrap_or((-180.0, -90.0, 180.0, 90.0));
    crate::telemetry::TelemetryDb::global().query_binary_bbox(min_lon, min_lat, max_lon, max_lat)
}

#[tauri::command]
pub async fn fetch_live_earthquakes(
    period: Option<String>,
) -> Result<Vec<crate::telemetry::EarthquakeTarget>, String> {
    let p = period.as_deref().unwrap_or("day");
    crate::telemetry::fetch_live_earthquakes(p).await
}

#[tauri::command]
pub fn fetch_live_satellites() -> Result<Vec<crate::telemetry::SatelliteTarget>, String> {
    Ok(crate::telemetry::compute_live_satellites())
}

#[tauri::command]
pub async fn fetch_live_fires(
    bbox: Option<(f64, f64, f64, f64)>,
) -> Result<Vec<crate::telemetry::FireTarget>, String> {
    crate::telemetry::fetch_live_fires(bbox).await
}

#[tauri::command]
pub async fn fetch_live_vessels(
    bbox: Option<(f64, f64, f64, f64)>,
) -> Result<Vec<crate::telemetry::VesselTarget>, String> {
    crate::telemetry::fetch_live_vessels(bbox).await
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ApiProvidersStatus {
    pub google_maps: bool,
    pub cesium_ion: bool,
    pub opensky_oauth: bool,
    pub nasa_firms: bool,
    pub aisstream: bool,
    pub tomtom_traffic: bool,
}

#[tauri::command]
pub fn get_api_providers_status() -> ApiProvidersStatus {
    let google_maps = std::env::var("GOOGLE_MAPS_API_KEY").map(|s| !s.trim().is_empty()).unwrap_or(false);
    let cesium_ion = std::env::var("CESIUM_ION_TOKEN").map(|s| !s.trim().is_empty()).unwrap_or(false);
    let opensky_oauth = std::env::var("OPENSKY_CLIENT_ID").map(|s| !s.trim().is_empty()).unwrap_or(false)
        && std::env::var("OPENSKY_CLIENT_SECRET").map(|s| !s.trim().is_empty()).unwrap_or(false);
    let nasa_firms = std::env::var("FIRMS_MAP_KEY").map(|s| !s.trim().is_empty()).unwrap_or(false);
    let aisstream = std::env::var("AISSTREAM_API_KEY").map(|s| !s.trim().is_empty()).unwrap_or(false);
    let tomtom_traffic = std::env::var("TOMTOM_API_KEY").map(|s| !s.trim().is_empty()).unwrap_or(false);

    ApiProvidersStatus {
        google_maps,
        cesium_ion,
        opensky_oauth,
        nasa_firms,
        aisstream,
        tomtom_traffic,
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct AdsbTelemetryStatus {
    pub cached_credits: Option<u32>,
    pub current_ttl_ms: u64,
    pub has_oauth: bool,
}

#[tauri::command]
pub async fn get_adsb_telemetry_status() -> AdsbTelemetryStatus {
    let has_oauth = std::env::var("OPENSKY_CLIENT_ID").map(|s| !s.trim().is_empty()).unwrap_or(false)
        && std::env::var("OPENSKY_CLIENT_SECRET").map(|s| !s.trim().is_empty()).unwrap_or(false);
    let cached_credits = crate::telemetry::adsb::get_cached_credits().await;
    let current_ttl_ms = crate::telemetry::adsb::get_current_ttl_ms().await;

    AdsbTelemetryStatus {
        cached_credits,
        current_ttl_ms,
        has_oauth,
    }
}

#[tauri::command]
pub async fn fetch_telemetry_binary(
    feed_type: String,
    bbox: Option<(f64, f64, f64, f64)>,
) -> Result<Vec<u8>, String> {
    match feed_type.as_str() {
        "flights" | "adsb" => {
            let flights = crate::telemetry::fetch_live_flights(bbox).await?;
            Ok(crate::telemetry::pack_flights_binary(&flights))
        }
        "earthquakes" | "seismic" => {
            let quakes = crate::telemetry::fetch_live_earthquakes("day").await?;
            Ok(crate::telemetry::pack_earthquakes_binary(&quakes))
        }
        "satellites" | "orbits" => {
            let sats = crate::telemetry::compute_live_satellites();
            Ok(crate::telemetry::pack_satellites_binary(&sats))
        }
        _ => Err(format!("Unknown telemetry feed type: {}", feed_type)),
    }
}

#[tauri::command]
pub fn register_cog_layer(
    raster: State<'_, crate::raster::SharedRasterRegistry>,
    layer_id: String,
    name: String,
    bands: std::collections::HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    let mut cog_bands = std::collections::HashMap::new();
    let mut mapped_urls = std::collections::HashMap::new();

    for (band_id, source_str) in bands {
        let trimmed = source_str.trim();
        let source = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            crate::raster::CogSource::Remote(trimmed.to_string())
        } else {
            crate::raster::CogSource::Local(std::path::PathBuf::from(trimmed))
        };
        cog_bands.insert(band_id.clone(), source);
        mapped_urls.insert(band_id.clone(), format!("strata://cog/{layer_id}/{band_id}"));
    }

    raster.register_layer(layer_id.clone(), name, cog_bands);

    Ok(serde_json::json!({
        "success": true,
        "layer_id": layer_id,
        "bands": mapped_urls
    }))
}

#[tauri::command]
pub fn get_cog_presets(
    raster: State<'_, crate::raster::SharedRasterRegistry>,
) -> Result<Vec<crate::raster::CogPresetInfo>, String> {
    Ok(raster.get_presets())
}


