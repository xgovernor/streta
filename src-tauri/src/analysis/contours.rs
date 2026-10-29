use contour::ContourBuilder;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContourParams {
    /// Elevation or scalar values in row-major order (size: width * height)
    pub values: Vec<f64>,
    pub width: usize,
    pub height: usize,
    /// Bounding box: [min_lon, min_lat, max_lon, max_lat]
    pub bbox: (f64, f64, f64, f64),
    /// Explicit contour thresholds (e.g. [100.0, 200.0, 300.0])
    pub thresholds: Option<Vec<f64>>,
    /// Fixed interval step (e.g. 50.0m) if thresholds not specified
    pub interval: Option<f64>,
    /// Smooth contour edges using linear interpolation (default: true)
    pub smooth: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContourResult {
    pub feature_count: usize,
    pub min_value: f64,
    pub max_value: f64,
    pub thresholds_used: Vec<f64>,
    pub geojson: Value,
}

/// Generates marching-squares isoline / isoband contours from a regular scalar grid (e.g. DEM raster),
/// mapped to geographic coordinates using the supplied bounding box.
pub fn generate_contours(params: &ContourParams) -> Result<ContourResult, String> {
    if params.width == 0 || params.height == 0 {
        return Err("Grid dimensions width and height must be > 0".to_string());
    }
    let expected_len = params.width * params.height;
    if params.values.len() != expected_len {
        return Err(format!(
            "Values array length ({}) does not match width * height ({} * {} = {})",
            params.values.len(),
            params.width,
            params.height,
            expected_len
        ));
    }

    let mut min_val = f64::INFINITY;
    let mut max_val = f64::NEG_INFINITY;
    for &v in &params.values {
        if !v.is_nan() {
            if v < min_val {
                min_val = v;
            }
            if v > max_val {
                max_val = v;
            }
        }
    }

    if min_val.is_infinite() || max_val.is_infinite() {
        return Err("Values array contains no non-NaN numbers".to_string());
    }

    let thresholds = if let Some(th) = &params.thresholds {
        th.clone()
    } else {
        let step = params.interval.unwrap_or_else(|| {
            let diff = max_val - min_val;
            if diff <= 0.0 {
                1.0
            } else {
                (diff / 10.0).max(1.0)
            }
        });

        if step <= 0.0 {
            return Err("Threshold step interval must be > 0".to_string());
        }

        let mut t = Vec::new();
        let mut curr = (min_val / step).floor() * step;
        while curr <= max_val {
            if curr >= min_val {
                t.push((curr * 1000.0).round() / 1000.0);
            }
            curr += step;
        }
        if t.is_empty() {
            t.push(min_val);
        }
        t
    };

    let (min_lon, min_lat, max_lon, max_lat) = params.bbox;
    let x_step = if params.width > 1 {
        (max_lon - min_lon) / (params.width as f64 - 1.0)
    } else {
        1.0
    };
    let y_step = if params.height > 1 {
        (max_lat - min_lat) / (params.height as f64 - 1.0)
    } else {
        1.0
    };

    let smooth = params.smooth.unwrap_or(true);

    let builder = ContourBuilder::new(params.width, params.height, smooth)
        .x_origin(min_lon)
        .y_origin(min_lat)
        .x_step(x_step)
        .y_step(y_step);

    let contours = builder
        .contours(&params.values, &thresholds)
        .map_err(|e| format!("Failed to compute marching-squares contours: {e:?}"))?;

    let mut features = Vec::new();
    for (idx, contour) in contours.into_iter().enumerate() {
        let threshold = contour.threshold();
        let geom = contour.geometry();

        // Convert geo::MultiPolygon to GeoJSON geometry JSON
        let mut poly_coords = Vec::new();
        for poly in geom.iter() {
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
            poly_coords.push(all_rings);
        }

        let feature = serde_json::json!({
            "type": "Feature",
            "id": format!("contour_{idx}"),
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": poly_coords
            },
            "properties": {
                "threshold": threshold,
                "index": idx,
                "is_closed": true
            }
        });
        features.push(feature);
    }

    let geojson = serde_json::json!({
        "type": "FeatureCollection",
        "features": features
    });

    Ok(ContourResult {
        feature_count: features.len(),
        min_value: min_val,
        max_value: max_val,
        thresholds_used: thresholds,
        geojson,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_elevation_contour_generation() {
        // Create a 5x5 synthetic hill centered in the grid
        let width = 5;
        let height = 5;
        let mut values = vec![0.0; width * height];
        for y in 0..height {
            for x in 0..width {
                let dx = x as f64 - 2.0;
                let dy = y as f64 - 2.0;
                // Hill peaking at 100m, falling off to 0m
                let dist_sq = dx * dx + dy * dy;
                values[y * width + x] = (100.0 - dist_sq * 20.0).max(0.0);
            }
        }

        let params = ContourParams {
            values,
            width,
            height,
            bbox: (-120.0, 35.0, -119.0, 36.0),
            thresholds: Some(vec![20.0, 50.0, 80.0]),
            interval: None,
            smooth: Some(true),
        };

        let result = generate_contours(&params).expect("contour generation should succeed");
        assert_eq!(result.thresholds_used, vec![20.0, 50.0, 80.0]);
        assert!(result.feature_count > 0);
        assert_eq!(result.max_value, 100.0);
        assert_eq!(result.min_value, 0.0);

        let fc = result.geojson;
        let features = fc["features"].as_array().unwrap();
        assert_eq!(features.len(), result.feature_count);
        assert_eq!(features[0]["geometry"]["type"], "MultiPolygon");
    }
}
