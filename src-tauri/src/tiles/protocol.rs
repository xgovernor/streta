use tauri::http::{Request, Response, StatusCode};
use super::store::SharedDatasetStore;

pub fn handle_strata_protocol(
    store: &SharedDatasetStore,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let uri = request.uri();
    let path = uri.path();

    // Parse path segments: expected format .../tiles/{dataset_id}/{z}/{x}/{y}.pbf
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();

    // Look for "tiles" segment
    let tiles_idx = segments.iter().position(|&s| s == "tiles");

    let (dataset_id, z, x, y) = match tiles_idx {
        Some(idx) if segments.len() >= idx + 4 => {
            let dataset_id = segments[idx + 1];
            let z_str = segments[idx + 2];
            let x_str = segments[idx + 3];
            let mut y_str = segments[idx + 4];

            // Strip extension if present
            if let Some(pos) = y_str.find('.') {
                y_str = &y_str[..pos];
            }

            match (z_str.parse::<u32>(), x_str.parse::<u32>(), y_str.parse::<u32>()) {
                (Ok(z), Ok(x), Ok(y)) => (dataset_id, z, x, y),
                _ => return bad_request("Invalid tile coordinate integers"),
            }
        }
        _ => return not_found("Unrecognized strata URI path"),
    };

    let store_guard = match store.read() {
        Ok(guard) => guard,
        Err(_) => return internal_error("Failed to acquire store lock"),
    };

    match store_guard.render_tile(dataset_id, z, x, y) {
        Ok(bytes) => {
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/x-protobuf")
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Allow-Methods", "GET, OPTIONS")
                .header("Access-Control-Allow-Headers", "*")
                .header("Cache-Control", "public, max-age=3600")
                .body(bytes)
                .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR))
        }
        Err(_) => {
            // Return empty 200 vector tile so OpenLayers does not log errors for empty/out-of-bound tiles
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/x-protobuf")
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Allow-Methods", "GET, OPTIONS")
                .header("Access-Control-Allow-Headers", "*")
                .body(Vec::new())
                .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR))
        }
    }
}

fn empty_response(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .body(Vec::new())
        .unwrap()
}

fn bad_request(msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::BAD_REQUEST)
        .header("Content-Type", "text/plain")
        .header("Access-Control-Allow-Origin", "*")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

fn not_found(msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header("Content-Type", "text/plain")
        .header("Access-Control-Allow-Origin", "*")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

fn internal_error(msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .header("Content-Type", "text/plain")
        .header("Access-Control-Allow-Origin", "*")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}
