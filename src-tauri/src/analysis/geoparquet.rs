use parquet::file::reader::{FileReader, SerializedFileReader};
use parquet::record::{Field, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::File;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoParquetColumnInfo {
    pub name: String,
    pub encoding: String,
    pub geometry_types: Vec<String>,
    pub bbox: Option<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoParquetMetadataSummary {
    pub file_path: String,
    pub num_rows: usize,
    pub num_row_groups: usize,
    pub primary_geometry_column: String,
    pub columns: Vec<GeoParquetColumnInfo>,
    pub schema_fields: Vec<String>,
    pub geo_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoParquetLayerLoadResult {
    pub num_features: usize,
    pub primary_column: String,
    pub feature_collection: Value,
}

/// Inspects a GeoParquet file, parsing the OGC 'geo' key-value metadata and schema.
pub fn inspect_geoparquet_metadata(file_path: &str) -> Result<GeoParquetMetadataSummary, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {file_path}"));
    }

    let file = File::open(path).map_err(|e| format!("Failed to open Parquet file: {e}"))?;
    let reader = SerializedFileReader::new(file)
        .map_err(|e| format!("Failed to create Parquet reader: {e}"))?;

    let meta = reader.metadata();
    let file_meta = meta.file_metadata();
    let num_rows = file_meta.num_rows() as usize;
    let num_row_groups = meta.num_row_groups();

    // Extract Parquet schema field names
    let schema_descr = file_meta.schema_descr();
    let schema_fields: Vec<String> = (0..schema_descr.num_columns())
        .map(|i| schema_descr.column(i).name().to_string())
        .collect();

    // Look for OGC "geo" metadata key
    let mut geo_version = None;
    let mut primary_geometry_column = "geometry".to_string();
    let mut columns_info = Vec::new();

    if let Some(kv_meta) = file_meta.key_value_metadata() {
        for kv in kv_meta {
            if kv.key == "geo" {
                if let Some(val_str) = &kv.value {
                    if let Ok(geo_json) = serde_json::from_str::<Value>(val_str) {
                        if let Some(ver) = geo_json.get("version").and_then(|v| v.as_str()) {
                            geo_version = Some(ver.to_string());
                        }
                        if let Some(prim) = geo_json.get("primary_column").and_then(|p| p.as_str()) {
                            primary_geometry_column = prim.to_string();
                        }
                        if let Some(cols) = geo_json.get("columns").and_then(|c| c.as_object()) {
                            for (col_name, col_data) in cols {
                                let encoding = col_data
                                    .get("encoding")
                                    .and_then(|e| e.as_str())
                                    .unwrap_or("WKB")
                                    .to_string();

                                let geometry_types = col_data
                                    .get("geometry_types")
                                    .and_then(|gt| gt.as_array())
                                    .map(|arr| {
                                        arr.iter()
                                            .filter_map(|s| s.as_str().map(|str_s| str_s.to_string()))
                                            .collect()
                                    })
                                    .unwrap_or_default();

                                let bbox = col_data
                                    .get("bbox")
                                    .and_then(|b| b.as_array())
                                    .map(|arr| arr.iter().filter_map(|num| num.as_f64()).collect());

                                columns_info.push(GeoParquetColumnInfo {
                                    name: col_name.clone(),
                                    encoding,
                                    geometry_types,
                                    bbox,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(GeoParquetMetadataSummary {
        file_path: file_path.to_string(),
        num_rows,
        num_row_groups,
        primary_geometry_column,
        columns: columns_info,
        schema_fields,
        geo_version,
    })
}

/// Reads records from a GeoParquet file (up to max_features limit), converting WKB geometry
/// columns into standard GeoJSON Features.
pub fn load_geoparquet_as_geojson(
    file_path: &str,
    max_features: Option<usize>,
) -> Result<GeoParquetLayerLoadResult, String> {
    let summary = inspect_geoparquet_metadata(file_path)?;
    let limit = max_features.unwrap_or(50_000);

    let path = Path::new(file_path);
    let file = File::open(path).map_err(|e| format!("Failed to open Parquet file: {e}"))?;
    let reader = SerializedFileReader::new(file)
        .map_err(|e| format!("Failed to parse Parquet: {e}"))?;

    let geom_col_name = &summary.primary_geometry_column;
    let mut features = Vec::new();

    // Iterate through rows using row iterator
    let row_iter = reader
        .get_row_iter(None)
        .map_err(|e| format!("Failed to initialize Parquet row iterator: {e}"))?;

    for (row_idx, row_res) in row_iter.enumerate() {
        if features.len() >= limit {
            break;
        }

        let row: Row = row_res.map_err(|e| format!("Error reading row {row_idx}: {e}"))?;
        let mut properties = serde_json::Map::new();
        let mut geometry_val: Option<Value> = None;

        for (_col_idx, (col_name, field)) in row.get_column_iter().enumerate() {
            if col_name == geom_col_name {
                // Parse WKB binary into GeoJSON geometry
                if let Field::Bytes(bytes) = field {
                    if let Ok(geojson_geom) = convert_wkb_to_geojson_geometry(bytes.data()) {
                        geometry_val = Some(geojson_geom);
                    }
                }
            } else {
                // Convert Parquet field to JSON property
                let val = match field {
                    Field::Null => Value::Null,
                    Field::Bool(b) => Value::Bool(*b),
                    Field::Byte(b) => Value::Number((*b).into()),
                    Field::Short(s) => Value::Number((*s).into()),
                    Field::Int(i) => Value::Number((*i).into()),
                    Field::Long(l) => Value::Number((*l).into()),
                    Field::Float(f) => serde_json::Number::from_f64(*f as f64)
                        .map(Value::Number)
                        .unwrap_or(Value::Null),
                    Field::Double(d) => serde_json::Number::from_f64(*d)
                        .map(Value::Number)
                        .unwrap_or(Value::Null),
                    Field::Str(s) => Value::String(s.clone()),
                    Field::Bytes(b) => Value::String(format!("<bytes len={}>", b.len())),
                    _ => Value::String(field.to_string()),
                };
                properties.insert(col_name.clone(), val);
            }
        }

        let feature = serde_json::json!({
            "type": "Feature",
            "id": format!("gpq_{row_idx}"),
            "geometry": geometry_val.unwrap_or(Value::Null),
            "properties": Value::Object(properties),
        });

        features.push(feature);
    }

    let fc = serde_json::json!({
        "type": "FeatureCollection",
        "features": features
    });

    Ok(GeoParquetLayerLoadResult {
        num_features: fc["features"].as_array().map(|a| a.len()).unwrap_or(0),
        primary_column: geom_col_name.clone(),
        feature_collection: fc,
    })
}

/// Helper converting WKB slice to GeoJSON geometry JSON via geozero WKB reader
fn convert_wkb_to_geojson_geometry(wkb_bytes: &[u8]) -> Result<Value, String> {
    use geozero::geojson::GeoJsonWriter;
    use geozero::GeozeroGeometry;
    use geozero::wkb::Wkb;

    let mut out_bytes = Vec::new();
    let mut writer = GeoJsonWriter::new(&mut out_bytes);

    Wkb(wkb_bytes)
        .process_geom(&mut writer)
        .map_err(|e| format!("Failed to decode WKB geometry: {e}"))?;

    let json_str = String::from_utf8(out_bytes)
        .map_err(|e| format!("Invalid UTF-8 from GeoJSON writer: {e}"))?;

    serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse decoded GeoJSON geometry: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wkb_conversion() {
        // Point WKB (little endian, type 1 = Point, x=10.0, y=20.0)
        let mut wkb = vec![1, 1, 0, 0, 0]; // 1 (LE) + Point (1)
        wkb.extend_from_slice(&10.0_f64.to_le_bytes());
        wkb.extend_from_slice(&20.0_f64.to_le_bytes());

        let geom = convert_wkb_to_geojson_geometry(&wkb).expect("WKB conversion should succeed");
        assert_eq!(geom["type"], "Point");
        let coords = geom["coordinates"].as_array().unwrap();
        assert_eq!(coords[0].as_f64().unwrap(), 10.0);
        assert_eq!(coords[1].as_f64().unwrap(), 20.0);
    }
}
