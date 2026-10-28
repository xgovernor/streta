use std::sync::{Arc, RwLock};

pub mod tiles;
pub mod commands;

use tiles::{DatasetStore, SharedDatasetStore};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
