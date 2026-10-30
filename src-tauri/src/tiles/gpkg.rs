use std::path::Path;
use rusqlite::{types::ValueRef, Connection};
use serde_json::Value;
use geozero::ToGeo;
use geozero::wkb::Wkb;

use super::math::lon_lat_to_epsg3857;
use super::store::{compute_bounds, Geometry3857, IndexedFeature};

/// Envelope byte length mapping based on GeoPackage header flags (bits 1-3).
fn envelope_byte_length(envelope_indicator: u8) -> usize {
    match envelope_indicator {
        0 => 0,
        1 => 32, // min_x, max_x, min_y, max_y (f64 each)
        2 => 48, // with z
        3 => 48, // with m
        4 => 64, // with z and m
        _ => 0,
    }
}

/// Decodes GeoPackage geometry blob (8-byte header + envelope + WKB) into a `Geometry3857`.
pub fn decode_gpkg_geometry(blob: &[u8]) -> Result<Geometry3857, String> {
    if blob.len() < 8 {
        return Err("Geometry blob is too short for GeoPackage header".to_string());
    }

    // Verify magic bytes: 'GP' (0x47, 0x50)
    if blob[0] != 0x47 || blob[1] != 0x50 {
        return Err("Missing GeoPackage magic header [0x47, 0x50]".to_string());
    }

    let flags = blob[3];
    // Check GeoPackage empty geometry flag (bit 0)
    if (flags & 0x01) != 0 {
        return Err("Empty GeoPackage geometry".to_string());
    }

    let envelope_indicator = (flags >> 1) & 0x07;
    let env_len = envelope_byte_length(envelope_indicator);
    let header_len = 8 + env_len;

    if blob.len() <= header_len {
        return Err("Blob does not contain WKB payload after header".to_string());
    }

    let wkb_bytes = &blob[header_len..];
    let wkb = Wkb(wkb_bytes);
    let geo_geom: geo::Geometry<f64> = wkb.to_geo()
        .map_err(|e| format!("WKB decode error: {e}"))?;

    geo_to_geometry3857(&geo_geom)
}

/// Converts a coordinate to EPSG:3857, auto-detecting if it is already projected in meters.
fn to_coord(x: f64, y: f64) -> [f64; 2] {
    if !x.is_finite() || !y.is_finite() {
        return [0.0, 0.0];
    }
    if x.abs() > 180.0 || y.abs() > 90.0 {
        [x, y]
    } else {
        let (px, py) = lon_lat_to_epsg3857(x, y);
        [px, py]
    }
}

/// Converts a `geo::Geometry<f64>` (in lon/lat degrees or projected meters) to `Geometry3857`.
pub fn geo_to_geometry3857(geom: &geo::Geometry<f64>) -> Result<Geometry3857, String> {
    match geom {
        geo::Geometry::Point(p) => {
            Ok(Geometry3857::Point(to_coord(p.x(), p.y())))
        }
        geo::Geometry::MultiPoint(mp) => {
            let pts = mp.iter()
                .map(|p| to_coord(p.x(), p.y()))
                .collect();
            Ok(Geometry3857::MultiPoint(pts))
        }
        geo::Geometry::LineString(ls) => {
            let coords = ls.coords()
                .map(|c| to_coord(c.x, c.y))
                .collect();
            Ok(Geometry3857::LineString(coords))
        }
        geo::Geometry::MultiLineString(mls) => {
            let lines = mls.iter()
                .map(|ls| {
                    ls.coords()
                        .map(|c| to_coord(c.x, c.y))
                        .collect()
                })
                .collect();
            Ok(Geometry3857::MultiLineString(lines))
        }
        geo::Geometry::Polygon(poly) => {
            let mut rings = Vec::new();
            let ext: Vec<[f64; 2]> = poly.exterior().coords()
                .map(|c| to_coord(c.x, c.y))
                .collect();
            rings.push(ext);

            for int in poly.interiors() {
                let int_ring: Vec<[f64; 2]> = int.coords()
                    .map(|c| to_coord(c.x, c.y))
                    .collect();
                rings.push(int_ring);
            }
            Ok(Geometry3857::Polygon(rings))
        }
        geo::Geometry::MultiPolygon(mpoly) => {
            let polys = mpoly.iter()
                .map(|poly| {
                    let mut rings = Vec::new();
                    let ext: Vec<[f64; 2]> = poly.exterior().coords()
                        .map(|c| to_coord(c.x, c.y))
                        .collect();
                    rings.push(ext);

                    for int in poly.interiors() {
                        let int_ring: Vec<[f64; 2]> = int.coords()
                            .map(|c| to_coord(c.x, c.y))
                            .collect();
                        rings.push(int_ring);
                    }
                    rings
                })
                .collect();
            Ok(Geometry3857::MultiPolygon(polys))
        }
        geo::Geometry::GeometryCollection(gc) => {
            if let Some(first) = gc.iter().next() {
                geo_to_geometry3857(first)
            } else {
                Err("Empty GeometryCollection".to_string())
            }
        }
        _ => Err("Unsupported geometry type".to_string()),
    }
}

/// Reads all features from a GeoPackage file into `IndexedFeature` records.
pub fn read_gpkg_file(file_path: &str) -> Result<Vec<IndexedFeature>, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("GeoPackage file not found: {file_path}"));
    }

    let conn = Connection::open(path)
        .map_err(|e| format!("Failed to open GeoPackage SQLite database: {e}"))?;

    // 1. Locate feature tables via gpkg_contents
    let mut stmt = conn.prepare(
        "SELECT table_name FROM gpkg_contents WHERE data_type = 'features' ORDER BY table_name"
    ).map_err(|e| format!("Failed to query gpkg_contents: {e}"))?;

    let table_names: Vec<String> = stmt.query_map([], |row| row.get(0))
        .map_err(|e| format!("Error reading feature table names: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    if table_names.is_empty() {
        return Err("No feature tables found in GeoPackage gpkg_contents".to_string());
    }

    // Default to the first feature table
    let table_name = &table_names[0];

    // 2. Discover the geometry column name from gpkg_geometry_columns
    let geom_col: String = conn.query_row(
        "SELECT column_name FROM gpkg_geometry_columns WHERE table_name = ?1",
        [table_name],
        |row| row.get(0),
    ).unwrap_or_else(|_| "geom".to_string());

    // 3. Query all columns from the feature table
    let query = format!("SELECT * FROM \"{}\"", table_name);
    let mut query_stmt = conn.prepare(&query)
        .map_err(|e| format!("Failed to query table '{table_name}': {e}"))?;

    let col_names: Vec<String> = query_stmt.column_names()
        .into_iter()
        .map(|s| s.to_string())
        .collect();

    let geom_idx = col_names.iter().position(|c| c.eq_ignore_ascii_case(&geom_col))
        .ok_or_else(|| format!("Geometry column '{geom_col}' not found in '{table_name}'"))?;

    let mut rows = query_stmt.query([])
        .map_err(|e| format!("Failed to execute query on '{table_name}': {e}"))?;

    let mut features = Vec::new();
    let mut row_idx: usize = 0;

    while let Some(row) = rows.next().map_err(|e| format!("Error fetching row: {e}"))? {
        row_idx += 1;

        // Extract geometry blob
        let geom_blob: Option<Vec<u8>> = match row.get_ref(geom_idx) {
            Ok(ValueRef::Blob(b)) => Some(b.to_vec()),
            _ => None,
        };

        let geom_blob = match geom_blob {
            Some(b) => b,
            None => continue,
        };

        let parsed_geom = match decode_gpkg_geometry(&geom_blob) {
            Ok(g) => g,
            Err(_) => continue, // Skip unparseable or empty geometries
        };

        let (min_x, min_y, max_x, max_y) = compute_bounds(&parsed_geom);

        // Extract properties and determine ID
        let mut properties = serde_json::Map::new();
        let mut feature_id = format!("{row_idx}");

        for (idx, col_name) in col_names.iter().enumerate() {
            if idx == geom_idx {
                continue;
            }

            let val_ref = row.get_ref(idx).unwrap_or(ValueRef::Null);
            let json_val = match val_ref {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(i) => {
                    if col_name.eq_ignore_ascii_case("fid") || col_name.eq_ignore_ascii_case("id") {
                        feature_id = i.to_string();
                    }
                    Value::from(i)
                }
                ValueRef::Real(r) => {
                    serde_json::Number::from_f64(r)
                        .map(Value::Number)
                        .unwrap_or(Value::Null)
                }
                ValueRef::Text(t) => {
                    let s = String::from_utf8_lossy(t).to_string();
                    if col_name.eq_ignore_ascii_case("id") {
                        feature_id = s.clone();
                    }
                    Value::String(s)
                }
                ValueRef::Blob(_) => Value::String("<binary>".to_string()),
            };

            properties.insert(col_name.clone(), json_val);
        }

        features.push(IndexedFeature {
            id: feature_id,
            geometry: parsed_geom,
            properties,
            min_x,
            min_y,
            max_x,
            max_y,
        });
    }

    Ok(features)
}
