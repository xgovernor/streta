use std::path::Path;
use serde_json::Value;
use shapefile::dbase::FieldValue;

use super::math::lon_lat_to_epsg3857;
use super::store::{compute_bounds, Geometry3857, IndexedFeature};

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

/// Converts shapefile polygon rings, grouping each outer ring and its subsequent inner rings (holes)
/// into distinct polygons (MultiPolygon when multiple outer rings exist).
fn convert_polygon_rings<T, F>(rings: &[shapefile::record::polygon::PolygonRing<T>], get_xy: F) -> Result<Geometry3857, String>
where
    F: Fn(&T) -> (f64, f64),
{
    use shapefile::record::polygon::PolygonRing;
    let mut polygons: Vec<Vec<Vec<[f64; 2]>>> = Vec::new();

    for ring in rings {
        let coords: Vec<[f64; 2]> = ring.points().iter()
            .map(|p| {
                let (x, y) = get_xy(p);
                to_coord(x, y)
            })
            .collect();

        if coords.len() < 4 {
            continue;
        }

        match ring {
            PolygonRing::Outer(_) => {
                polygons.push(vec![coords]);
            }
            PolygonRing::Inner(_) => {
                if let Some(last_poly) = polygons.last_mut() {
                    last_poly.push(coords);
                } else {
                    polygons.push(vec![coords]);
                }
            }
        }
    }

    if polygons.is_empty() {
        return Err("No valid polygon rings found".to_string());
    }

    if polygons.len() == 1 {
        Ok(Geometry3857::Polygon(polygons.into_iter().next().unwrap()))
    } else {
        Ok(Geometry3857::MultiPolygon(polygons))
    }
}

/// Converts a `shapefile::Shape` to `Geometry3857`.
pub fn shape_to_geometry3857(shape: &shapefile::Shape) -> Result<Geometry3857, String> {
    match shape {
        shapefile::Shape::Point(p) => Ok(Geometry3857::Point(to_coord(p.x, p.y))),
        shapefile::Shape::PointZ(p) => Ok(Geometry3857::Point(to_coord(p.x, p.y))),
        shapefile::Shape::PointM(p) => Ok(Geometry3857::Point(to_coord(p.x, p.y))),
        shapefile::Shape::Multipoint(mp) => {
            let pts = mp.points().iter().map(|p| to_coord(p.x, p.y)).collect();
            Ok(Geometry3857::MultiPoint(pts))
        }
        shapefile::Shape::MultipointZ(mp) => {
            let pts = mp.points().iter().map(|p| to_coord(p.x, p.y)).collect();
            Ok(Geometry3857::MultiPoint(pts))
        }
        shapefile::Shape::MultipointM(mp) => {
            let pts = mp.points().iter().map(|p| to_coord(p.x, p.y)).collect();
            Ok(Geometry3857::MultiPoint(pts))
        }
        shapefile::Shape::Polyline(pl) => {
            let parts: Vec<Vec<[f64; 2]>> = pl.parts().iter()
                .map(|part| part.iter().map(|p| to_coord(p.x, p.y)).collect())
                .collect();

            if parts.len() == 1 {
                Ok(Geometry3857::LineString(parts.into_iter().next().unwrap()))
            } else {
                Ok(Geometry3857::MultiLineString(parts))
            }
        }
        shapefile::Shape::PolylineZ(pl) => {
            let parts: Vec<Vec<[f64; 2]>> = pl.parts().iter()
                .map(|part| part.iter().map(|p| to_coord(p.x, p.y)).collect())
                .collect();

            if parts.len() == 1 {
                Ok(Geometry3857::LineString(parts.into_iter().next().unwrap()))
            } else {
                Ok(Geometry3857::MultiLineString(parts))
            }
        }
        shapefile::Shape::PolylineM(pl) => {
            let parts: Vec<Vec<[f64; 2]>> = pl.parts().iter()
                .map(|part| part.iter().map(|p| to_coord(p.x, p.y)).collect())
                .collect();

            if parts.len() == 1 {
                Ok(Geometry3857::LineString(parts.into_iter().next().unwrap()))
            } else {
                Ok(Geometry3857::MultiLineString(parts))
            }
        }
        shapefile::Shape::Polygon(poly) => {
            convert_polygon_rings(poly.rings(), |p| (p.x, p.y))
        }
        shapefile::Shape::PolygonZ(poly) => {
            convert_polygon_rings(poly.rings(), |p| (p.x, p.y))
        }
        shapefile::Shape::PolygonM(poly) => {
            convert_polygon_rings(poly.rings(), |p| (p.x, p.y))
        }
        shapefile::Shape::NullShape => Err("Null shape".to_string()),
        _ => Err("Unsupported shapefile shape type".to_string()),
    }
}

/// Reads all shapes and DBF records from a `.shp` path.
pub fn read_shapefile(file_path: &str) -> Result<Vec<IndexedFeature>, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("Shapefile not found: {file_path}"));
    }

    let mut reader = shapefile::Reader::from_path(path)
        .map_err(|e| format!("Failed to open shapefile '{file_path}': {e}"))?;

    let mut features = Vec::new();
    let mut idx: usize = 0;

    for result in reader.iter_shapes_and_records() {
        idx += 1;
        let (shape, dbase_record) = match result {
            Ok(pair) => pair,
            Err(_) => continue,
        };

        let parsed_geom = match shape_to_geometry3857(&shape) {
            Ok(g) => g,
            Err(_) => continue,
        };

        let (min_x, min_y, max_x, max_y) = compute_bounds(&parsed_geom);

        let mut properties = serde_json::Map::new();
        let mut feature_id = format!("{idx}");

        for (name, field_val) in dbase_record {
            let json_val = match field_val {
                FieldValue::Character(Some(s)) => {
                    if name.eq_ignore_ascii_case("id") {
                        feature_id = s.clone();
                    }
                    Value::String(s)
                }
                FieldValue::Numeric(Some(n)) => {
                    serde_json::Number::from_f64(n)
                        .map(Value::Number)
                        .unwrap_or(Value::Null)
                }
                FieldValue::Logical(Some(b)) => Value::Bool(b),
                FieldValue::Date(Some(d)) => Value::String(d.to_string()),
                FieldValue::Float(Some(f)) => {
                    serde_json::Number::from_f64(f as f64)
                        .map(Value::Number)
                        .unwrap_or(Value::Null)
                }
                FieldValue::Double(d) => {
                    serde_json::Number::from_f64(d)
                        .map(Value::Number)
                        .unwrap_or(Value::Null)
                }
                FieldValue::Integer(i) => {
                    if name.eq_ignore_ascii_case("id") || name.eq_ignore_ascii_case("fid") {
                        feature_id = i.to_string();
                    }
                    Value::from(i)
                }
                _ => Value::Null,
            };

            properties.insert(name, json_val);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ring_types() {
        use shapefile::record::polygon::PolygonRing;
        let ring = PolygonRing::Outer(vec![shapefile::Point::default()]);
        match ring {
            PolygonRing::Outer(_) => assert!(true),
            PolygonRing::Inner(_) => assert!(false),
        }
    }

    #[test]
    fn test_to_coord_detection() {
        // Degrees should project to meters
        let coord_deg = to_coord(0.0, 0.0);
        assert!((coord_deg[0] - 0.0).abs() < 1e-6);
        assert!((coord_deg[1] - 0.0).abs() < 1e-6);

        // Projected meters should remain as-is
        let coord_meters = to_coord(10_000_000.0, 5_000_000.0);
        assert_eq!(coord_meters, [10_000_000.0, 5_000_000.0]);
    }
}
