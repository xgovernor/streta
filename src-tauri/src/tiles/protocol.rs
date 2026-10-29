use tauri::http::{Request, Response, StatusCode};
use super::store::SharedDatasetStore;
use crate::raster::{CogSource, SharedRasterRegistry};

pub fn parse_range_header(header: &str, total_length: Option<u64>) -> Option<(u64, u64)> {
    let header = header.trim();
    if !header.to_ascii_lowercase().starts_with("bytes=") {
        return None;
    }
    let range_str = &header[6..];
    let first_range = range_str.split(',').next()?.trim();
    let parts: Vec<&str> = first_range.split('-').collect();
    if parts.len() != 2 {
        return None;
    }
    let start_str = parts[0].trim();
    let end_str = parts[1].trim();

    if start_str.is_empty() {
        // Suffix range: bytes=-500 (last 500 bytes)
        let suffix = end_str.parse::<u64>().ok()?;
        let total = total_length?;
        let start = total.saturating_sub(suffix);
        let end = total.saturating_sub(1);
        Some((start, end))
    } else if end_str.is_empty() {
        // Prefix range: bytes=100- (from 100 to end)
        let start = start_str.parse::<u64>().ok()?;
        let end = total_length.map(|t| t.saturating_sub(1)).unwrap_or(start + 65535);
        Some((start, end))
    } else {
        // Normal range: bytes=100-200
        let start = start_str.parse::<u64>().ok()?;
        let end = end_str.parse::<u64>().ok()?;
        if start <= end {
            Some((start, end))
        } else {
            None
        }
    }
}

pub async fn handle_strata_protocol_async(
    store: &SharedDatasetStore,
    raster: &SharedRasterRegistry,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    // Handle CORS preflight
    if request.method() == "OPTIONS" {
        return Response::builder()
            .status(StatusCode::OK)
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            .header("Access-Control-Allow-Headers", "Range, Content-Type, Accept")
            .header("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges")
            .header("Accept-Ranges", "bytes")
            .body(Vec::new())
            .unwrap();
    }

    let uri = request.uri();
    let path = uri.path();
    let host = uri.host().unwrap_or("");
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();

    // 1. Check if this is a COG Gateway request: strata://cog/{layer_id}/{band_id}
    let cog_target = if host == "cog" && segments.len() >= 2 {
        Some((segments[0].to_string(), segments[1].to_string()))
    } else if let Some(idx) = segments.iter().position(|&s| s == "cog") {
        if segments.len() >= idx + 2 {
            Some((segments[idx + 1].to_string(), segments[idx + 2].to_string()))
        } else {
            None
        }
    } else {
        None
    };

    if let Some((layer_id, raw_band_id)) = cog_target {
        return handle_cog_request(raster, &layer_id, &raw_band_id, request).await;
    }

    // 2. Check if this is a Vector Tile request: strata://tiles/{id}/{z}/{x}/{y}.pbf
    let tile_coord = if host == "tiles" && segments.len() >= 4 {
        let dataset_id = segments[0];
        let z_str = segments[1];
        let x_str = segments[2];
        let mut y_str = segments[3];
        if let Some(pos) = y_str.find('.') {
            y_str = &y_str[..pos];
        }
        match (z_str.parse::<u32>(), x_str.parse::<u32>(), y_str.parse::<u32>()) {
            (Ok(z), Ok(x), Ok(y)) => Some((dataset_id, z, x, y)),
            _ => return bad_request("Invalid tile coordinate integers"),
        }
    } else if let Some(idx) = segments.iter().position(|&s| s == "tiles") {
        if segments.len() >= idx + 4 {
            let dataset_id = segments[idx + 1];
            let z_str = segments[idx + 2];
            let x_str = segments[idx + 3];
            let mut y_str = segments[idx + 4];
            if let Some(pos) = y_str.find('.') {
                y_str = &y_str[..pos];
            }
            match (z_str.parse::<u32>(), x_str.parse::<u32>(), y_str.parse::<u32>()) {
                (Ok(z), Ok(x), Ok(y)) => Some((dataset_id, z, x, y)),
                _ => return bad_request("Invalid tile coordinate integers"),
            }
        } else {
            return not_found("Incomplete tile path");
        }
    } else {
        None
    };

    if let Some((dataset_id, z, x, y)) = tile_coord {
        return handle_vector_tile_request(store, dataset_id, z, x, y);
    }

    // 3. Check if this is a Telemetry request: strata://telemetry/...
    let is_telemetry = host == "telemetry" || segments.first().map_or(false, |&s| s == "telemetry");
    if is_telemetry {
        return handle_telemetry_request(request);
    }

    not_found("Unrecognized strata URI path")
}

fn handle_telemetry_request(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri();
    let path = uri.path();
    let query = uri.query().unwrap_or("");

    // Parse bbox query param: bbox=minLon,minLat,maxLon,maxLat
    let mut bbox: Option<(f64, f64, f64, f64)> = None;
    for param in query.split('&') {
        let mut parts = param.split('=');
        if let (Some(key), Some(val)) = (parts.next(), parts.next()) {
            if key == "bbox" {
                let coords: Vec<f64> = val.split(',').filter_map(|s| s.parse::<f64>().ok()).collect();
                if coords.len() == 4 {
                    bbox = Some((coords[0], coords[1], coords[2], coords[3]));
                }
            }
        }
    }

    if path.ends_with("/live.bin") || path.contains("/flights/live.bin") {
        let (min_lon, min_lat, max_lon, max_lat) = bbox.unwrap_or((-180.0, -90.0, 180.0, 90.0));
        match crate::telemetry::TelemetryDb::global().query_binary_bbox(min_lon, min_lat, max_lon, max_lat) {
            Ok(bytes) => Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/octet-stream")
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Allow-Methods", "GET, OPTIONS")
                .header("Cache-Control", "no-cache, no-store, must-revalidate")
                .body(bytes)
                .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR)),
            Err(e) => internal_error(&e),
        }
    } else if path.ends_with("/live.json") || path.contains("/flights/live.json") {
        let (min_lon, min_lat, max_lon, max_lat) = bbox.unwrap_or((-180.0, -90.0, 180.0, 90.0));
        match crate::telemetry::TelemetryDb::global().query_bbox(min_lon, min_lat, max_lon, max_lat) {
            Ok(flights) => {
                let json_bytes = serde_json::to_vec(&flights).unwrap_or_default();
                Response::builder()
                    .status(StatusCode::OK)
                    .header("Content-Type", "application/json")
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Access-Control-Allow-Methods", "GET, OPTIONS")
                    .header("Cache-Control", "no-cache, no-store, must-revalidate")
                    .body(json_bytes)
                    .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR))
            }
            Err(e) => internal_error(&e),
        }
    } else if path.contains("/trail.json") || path.contains("/trail") {
        let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
        let icao = if let Some(idx) = parts.iter().position(|&s| s == "trail" || s == "trail.json") {
            if idx > 0 { parts[idx - 1] } else { "" }
        } else {
            ""
        };

        if icao.is_empty() {
            return bad_request("Missing icao24 in trail path");
        }

        match crate::telemetry::TelemetryDb::global().get_flight_trail(icao) {
            Ok(geojson) => {
                let json_bytes = serde_json::to_vec(&geojson).unwrap_or_default();
                Response::builder()
                    .status(StatusCode::OK)
                    .header("Content-Type", "application/json")
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Access-Control-Allow-Methods", "GET, OPTIONS")
                    .header("Cache-Control", "no-cache, no-store, must-revalidate")
                    .body(json_bytes)
                    .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR))
            }
            Err(e) => internal_error(&e),
        }
    } else {
        not_found("Unrecognized telemetry endpoint")
    }
}

pub fn handle_strata_protocol(
    store: &SharedDatasetStore,
    raster: &SharedRasterRegistry,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    tauri::async_runtime::block_on(handle_strata_protocol_async(store, raster, request))
}

async fn handle_cog_request(
    raster: &SharedRasterRegistry,
    layer_id: &str,
    raw_band_id: &str,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let clean_band_id = raw_band_id
        .trim_end_matches(".tif")
        .trim_end_matches(".tiff");

    let source = raster
        .resolve_source(layer_id, raw_band_id)
        .or_else(|| raster.resolve_source(layer_id, clean_band_id));

    let source = match source {
        Some(s) => s,
        None => {
            return cog_response(
                StatusCode::NOT_FOUND,
                format!("COG layer '{}' band '{}' not registered", layer_id, raw_band_id).into_bytes(),
                None,
                0,
            );
        }
    };

    // Parse Range header if present
    let range_hdr_val = request
        .headers()
        .get("Range")
        .or_else(|| request.headers().get("range"))
        .and_then(|v| v.to_str().ok());

    match source {
        CogSource::Local(path) => {
            let total_len = std::fs::metadata(&path).ok().map(|m| m.len());
            let (start, end) = range_hdr_val
                .and_then(|hdr| parse_range_header(hdr, total_len))
                .unwrap_or_else(|| (0, total_len.map(|t| t.saturating_sub(1)).unwrap_or(65535)));

            match raster.read_local_range(&path, start, end) {
                Ok((bytes, total)) => {
                    if bytes.is_empty() {
                        cog_response(
                            StatusCode::RANGE_NOT_SATISFIABLE,
                            Vec::new(),
                            None,
                            total,
                        )
                    } else {
                        let actual_end = start + (bytes.len() as u64).saturating_sub(1);
                        cog_response(
                            StatusCode::PARTIAL_CONTENT,
                            bytes,
                            Some((start, actual_end, total)),
                            total,
                        )
                    }
                }
                Err(err) => {
                    cog_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        err.into_bytes(),
                        None,
                        0,
                    )
                }
            }
        }
        CogSource::Remote(url) => {
            let (start, end) = range_hdr_val
                .and_then(|hdr| parse_range_header(hdr, None))
                .unwrap_or((0, 65535)); // Default initial header probe chunk if unspecified

            match raster
                .fetch_remote_range(&url, layer_id, clean_band_id, start, end)
                .await
            {
                Ok((bytes, total)) => {
                    if bytes.is_empty() {
                        cog_response(
                            StatusCode::RANGE_NOT_SATISFIABLE,
                            Vec::new(),
                            None,
                            total,
                        )
                    } else {
                        let actual_end = start + (bytes.len() as u64).saturating_sub(1);
                        cog_response(
                            StatusCode::PARTIAL_CONTENT,
                            bytes,
                            Some((start, actual_end, total)),
                            total,
                        )
                    }
                }
                Err(err) => {
                    cog_response(
                        StatusCode::BAD_GATEWAY,
                        err.into_bytes(),
                        None,
                        0,
                    )
                }
            }
        }
    }
}

fn handle_vector_tile_request(
    store: &SharedDatasetStore,
    dataset_id: &str,
    z: u32,
    x: u32,
    y: u32,
) -> Response<Vec<u8>> {
    let store_guard = match store.read() {
        Ok(guard) => guard,
        Err(_) => return internal_error("Failed to acquire store lock"),
    };

    match store_guard.render_tile(dataset_id, z, x, y) {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", "application/x-protobuf")
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Methods", "GET, OPTIONS")
            .header("Access-Control-Allow-Headers", "*")
            .header("Cache-Control", "public, max-age=3600")
            .body(bytes)
            .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR)),
        Err(_) => Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", "application/x-protobuf")
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Methods", "GET, OPTIONS")
            .header("Access-Control-Allow-Headers", "*")
            .body(Vec::new())
            .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR)),
    }
}

fn cog_response(
    status: StatusCode,
    body: Vec<u8>,
    range_info: Option<(u64, u64, u64)>,
    _total_len: u64,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header("Content-Type", "image/tiff")
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        .header("Access-Control-Allow-Headers", "Range, Content-Type, Accept")
        .header(
            "Access-Control-Expose-Headers",
            "Content-Range, Content-Length, Accept-Ranges",
        )
        .header("Accept-Ranges", "bytes")
        .header("Content-Length", body.len().to_string())
        .header("Cache-Control", "public, max-age=86400");

    if let Some((start, end, total)) = range_info {
        builder = builder.header("Content-Range", format!("bytes {}-{}/{}", start, end, total));
    }

    builder.body(body).unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_range_header_standard() {
        assert_eq!(parse_range_header("bytes=0-1023", None), Some((0, 1023)));
        assert_eq!(parse_range_header("bytes=16384-32767", None), Some((16384, 32767)));
        assert_eq!(parse_range_header("bytes=0-0", None), Some((0, 0)));
    }

    #[test]
    fn test_parse_range_header_prefix() {
        assert_eq!(parse_range_header("bytes=100-", Some(500)), Some((100, 499)));
        assert_eq!(parse_range_header("bytes=100-", None), Some((100, 65635)));
    }

    #[test]
    fn test_parse_range_header_suffix() {
        assert_eq!(parse_range_header("bytes=-100", Some(500)), Some((400, 499)));
        assert_eq!(parse_range_header("bytes=-600", Some(500)), Some((0, 499)));
    }

    #[test]
    fn test_parse_range_header_invalid() {
        assert_eq!(parse_range_header("invalid", None), None);
        assert_eq!(parse_range_header("characters=0-10", None), None);
        assert_eq!(parse_range_header("bytes=500-100", None), None);
    }
}
