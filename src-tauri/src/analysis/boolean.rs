use geo::{BooleanOps, Centroid, GeodesicArea, MultiPolygon, Polygon};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BooleanOpType {
    Intersection,
    Union,
    Difference,
    Xor,
}

impl BooleanOpType {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s.to_ascii_lowercase().trim() {
            "intersection" | "intersect" => Ok(Self::Intersection),
            "union" => Ok(Self::Union),
            "difference" | "diff" => Ok(Self::Difference),
            "xor" | "sym_difference" => Ok(Self::Xor),
            other => Err(format!(
                "Invalid Boolean operation '{other}'. Expected: intersection, union, difference, xor"
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BooleanOpSummary {
    pub operation: String,
    pub polygon_count: usize,
    pub total_area_sq_m: f64,
    pub geojson: Value,
}

/// Executes constructive area geometry boolean operations (Intersection, Union, Difference, XOR)
/// between two polygon geometries using exact topological clipping.
pub fn execute_polygon_boolean_op(
    operation: &str,
    geom_a: &Value,
    geom_b: &Value,
) -> Result<BooleanOpSummary, String> {
    let op = BooleanOpType::parse(operation)?;
    let mp_a = parse_geojson_to_multipolygon(geom_a)?;
    let mp_b = parse_geojson_to_multipolygon(geom_b)?;

    let result_mp: MultiPolygon<f64> = match op {
        BooleanOpType::Intersection => mp_a.intersection(&mp_b),
        BooleanOpType::Union => mp_a.union(&mp_b),
        BooleanOpType::Difference => mp_a.difference(&mp_b),
        BooleanOpType::Xor => mp_a.xor(&mp_b),
    };

    let mut total_area = 0.0;
    let mut features = Vec::new();

    for (idx, poly) in result_mp.iter().enumerate() {
        let area = poly.geodesic_area_unsigned();
        total_area += area;
        let perim = poly.geodesic_perimeter();
        let centroid = poly.centroid().map(|c| (c.x(), c.y()));

        let ext_ring: Vec<Vec<f64>> = poly
            .exterior()
            .coords()
            .map(|c| vec![(c.x * 1_000_000.0).round() / 1_000_000.0, (c.y * 1_000_000.0).round() / 1_000_000.0])
            .collect();

        let int_rings: Vec<Vec<Vec<f64>>> = poly
            .interiors()
            .iter()
            .map(|ring| {
                ring.coords()
                    .map(|c| vec![(c.x * 1_000_000.0).round() / 1_000_000.0, (c.y * 1_000_000.0).round() / 1_000_000.0])
                    .collect()
            })
            .collect();

        let mut all_rings = vec![ext_ring];
        all_rings.extend(int_rings);

        let feature = serde_json::json!({
            "type": "Feature",
            "id": format!("bool_res_{idx}"),
            "geometry": {
                "type": "Polygon",
                "coordinates": all_rings
            },
            "properties": {
                "operation": operation,
                "part_index": idx,
                "area_sq_m": (area * 10.0).round() / 10.0,
                "area_sq_km": ((area / 1_000_000.0) * 1000.0).round() / 1000.0,
                "perimeter_m": (perim * 10.0).round() / 10.0,
                "centroid_lon": centroid.map(|c| (c.0 * 100_000.0).round() / 100_000.0),
                "centroid_lat": centroid.map(|c| (c.1 * 100_000.0).round() / 100_000.0),
            }
        });

        features.push(feature);
    }

    let geojson = serde_json::json!({
        "type": "FeatureCollection",
        "features": features
    });

    Ok(BooleanOpSummary {
        operation: operation.to_string(),
        polygon_count: result_mp.0.len(),
        total_area_sq_m: (total_area * 10.0).round() / 10.0,
        geojson,
    })
}

fn parse_geojson_to_multipolygon(val: &Value) -> Result<MultiPolygon<f64>, String> {
    // Extract geometry from Feature if passed
    let geom_val = if val.get("type").and_then(|t| t.as_str()) == Some("Feature") {
        val.get("geometry").ok_or_else(|| "Feature has no geometry".to_string())?
    } else {
        val
    };

    let geom_type = geom_val
        .get("type")
        .and_then(|t| t.as_str())
        .ok_or_else(|| "Missing geometry 'type'".to_string())?;

    let coords = geom_val
        .get("coordinates")
        .ok_or_else(|| "Missing 'coordinates'".to_string())?;

    match geom_type {
        "Polygon" => {
            let poly = parse_polygon_coords(coords)?;
            Ok(MultiPolygon::new(vec![poly]))
        }
        "MultiPolygon" => {
            let polys_arr = coords
                .as_array()
                .ok_or_else(|| "Expected array for MultiPolygon coordinates".to_string())?;
            let mut polys = Vec::new();
            for p_val in polys_arr {
                polys.push(parse_polygon_coords(p_val)?);
            }
            Ok(MultiPolygon::new(polys))
        }
        other => Err(format!(
            "Boolean operations require Polygon or MultiPolygon, got '{other}'"
        )),
    }
}

fn parse_polygon_coords(val: &Value) -> Result<Polygon<f64>, String> {
    let rings = val
        .as_array()
        .ok_or_else(|| "Expected array of rings".to_string())?;
    if rings.is_empty() {
        return Ok(Polygon::new(geo::LineString::new(vec![]), vec![]));
    }

    let parse_ring = |ring_val: &Value| -> Result<geo::LineString<f64>, String> {
        let pts = ring_val
            .as_array()
            .ok_or_else(|| "Expected array of coordinate pairs in ring".to_string())?;
        let mut coords = Vec::with_capacity(pts.len());
        for p in pts {
            let pair = p
                .as_array()
                .ok_or_else(|| "Expected [lon, lat] coordinate pair".to_string())?;
            if pair.len() < 2 {
                return Err("Coordinate pair must have at least 2 numbers".to_string());
            }
            let x = pair[0].as_f64().ok_or_else(|| "Non-numeric X".to_string())?;
            let y = pair[1].as_f64().ok_or_else(|| "Non-numeric Y".to_string())?;
            coords.push(geo::Coord { x, y });
        }
        Ok(geo::LineString::new(coords))
    };

    let exterior = parse_ring(&rings[0])?;
    let mut interiors = Vec::new();
    for interior_val in &rings[1..] {
        interiors.push(parse_ring(interior_val)?);
    }

    Ok(Polygon::new(exterior, interiors))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_polygon_intersection() {
        // Square A: [0, 0] to [2, 2]
        let a = serde_json::json!({
            "type": "Polygon",
            "coordinates": [[[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0], [0.0, 0.0]]]
        });
        // Square B: [1, 1] to [3, 3] (overlapping from 1,1 to 2,2)
        let b = serde_json::json!({
            "type": "Polygon",
            "coordinates": [[[1.0, 1.0], [3.0, 1.0], [3.0, 3.0], [1.0, 3.0], [1.0, 1.0]]]
        });

        let res = execute_polygon_boolean_op("intersection", &a, &b).unwrap();
        assert_eq!(res.polygon_count, 1);
        assert!(res.total_area_sq_m > 0.0);
    }

    #[test]
    fn test_polygon_union_and_difference() {
        let a = serde_json::json!({
            "type": "Polygon",
            "coordinates": [[[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0], [0.0, 0.0]]]
        });
        let b = serde_json::json!({
            "type": "Polygon",
            "coordinates": [[[1.0, 1.0], [3.0, 1.0], [3.0, 3.0], [1.0, 3.0], [1.0, 1.0]]]
        });

        let union_res = execute_polygon_boolean_op("union", &a, &b).unwrap();
        assert_eq!(union_res.polygon_count, 1);

        let diff_res = execute_polygon_boolean_op("difference", &a, &b).unwrap();
        assert_eq!(diff_res.polygon_count, 1);
        assert!(diff_res.total_area_sq_m < union_res.total_area_sq_m);
    }
}
