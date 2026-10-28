use std::sync::{Arc, RwLock};

pub mod tiles;
pub mod commands;
pub mod manifest;
pub mod analysis;
pub mod telemetry;

use tiles::{DatasetStore, SharedDatasetStore};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
    let protocol_store = store.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(store)
        .register_uri_scheme_protocol("strata", move |_ctx, request| {
            tiles::handle_strata_protocol(&protocol_store, &request)
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
            commands::fetch_live_flights,
            commands::fetch_live_earthquakes,
            commands::fetch_live_satellites,
            commands::fetch_telemetry_binary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
