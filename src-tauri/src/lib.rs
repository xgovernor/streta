use std::sync::{Arc, RwLock};

pub mod tiles;
pub mod commands;
pub mod manifest;
pub mod analysis;
pub mod telemetry;
pub mod raster;

use tiles::{DatasetStore, SharedDatasetStore};
use raster::{RasterRegistry, SharedRasterRegistry};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load environment variables from .env
    let _ = dotenvy::dotenv();
    let _ = dotenvy::from_path("../.env");

    #[cfg(target_os = "linux")]
    {
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            // SAFETY: Executed at the very start of the process before worker threads are spawned
            unsafe {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
        }
    }

    let store: SharedDatasetStore = Arc::new(RwLock::new(DatasetStore::new()));
    let raster_store: SharedRasterRegistry = Arc::new(RasterRegistry::new());

    let protocol_store = store.clone();
    let protocol_raster = raster_store.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(store)
        .manage(raster_store)
        .register_asynchronous_uri_scheme_protocol("strata", move |_ctx, request, responder| {
            let s = protocol_store.clone();
            let r = protocol_raster.clone();
            tauri::async_runtime::spawn(async move {
                let response = tiles::handle_strata_protocol_async(&s, &r, &request).await;
                responder.respond(response);
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::register_geojson_layer,
            commands::load_file_layer,
            commands::get_layer_records,
            commands::remove_layer,
            commands::has_layer,
            commands::get_dataset_manifest,
            commands::measure_geodesic,
            commands::spatial_buffer_query,
            commands::elevation_profile,
            commands::compute_h3_aggregation,
            commands::polygon_boolean_operation,
            commands::generate_contours,
            commands::spatial_knn_query,
            commands::inspect_geoparquet,
            commands::load_geoparquet_layer,
            commands::fetch_live_flights,
            commands::fetch_live_earthquakes,
            commands::fetch_live_satellites,
            commands::fetch_live_fires,
            commands::fetch_live_vessels,
            commands::get_api_providers_status,
            commands::get_adsb_telemetry_status,
            commands::fetch_telemetry_binary,
            commands::register_cog_layer,
            commands::get_cog_presets,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
