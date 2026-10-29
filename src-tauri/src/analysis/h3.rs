use h3o::{CellIndex, LatLng, Resolution};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct H3AggregationInput {
    pub lon: f64,
    pub lat: f64,
    pub weight: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct H3CellAggregate {
    pub cell_index: String,
    pub resolution: u8,
    pub count: usize,
    pub total_weight: f64,
    pub avg_weight: f64,
    pub center: (f64, f64),
    pub boundary: Vec<(f64, f64)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct H3AggregationResult {
    pub resolution: u8,
    pub total_points: usize,
    pub cell_count: usize,
    pub cells: Vec<H3CellAggregate>,
    pub geojson: Value,
}

/// Aggregates a set of geographic points into an Uber H3 discrete global hexagonal grid.
/// Emits hexagon polygons and bin attributes formatted directly as GeoJSON FeatureCollection.
pub fn aggregate_to_h3(
    points: &[H3AggregationInput],
    resolution: u8,
) -> Result<H3AggregationResult, String> {
    let res = Resolution::try_from(resolution)
        .map_err(|e| format!("Invalid H3 resolution {resolution} (must be 0-15): {e}"))?;

    let mut map: HashMap<CellIndex, (usize, f64)> = HashMap::new();
    let mut total_points = 0;

    for pt in points {
        if !pt.lon.is_finite() || !pt.lat.is_finite() {
            continue;
        }
        if let Ok(ll) = LatLng::new(pt.lat, pt.lon) {
            let cell = ll.to_cell(res);
            let entry = map.entry(cell).or_insert((0, 0.0));
            entry.0 += 1;
            entry.1 += pt.weight.unwrap_or(1.0);
            total_points += 1;
        }
    }

    let mut cells = Vec::with_capacity(map.len());
    let mut features = Vec::with_capacity(map.len());

    for (cell, (count, sum_weight)) in map {
        let center_ll: LatLng = cell.into();
        let center = (
            (center_ll.lng() * 1_000_000.0).round() / 1_000_000.0,
            (center_ll.lat() * 1_000_000.0).round() / 1_000_000.0,
        );

        let boundary_ll = cell.boundary();
        let mut boundary: Vec<(f64, f64)> = boundary_ll
            .iter()
            .map(|ll| (
                (ll.lng() * 1_000_000.0).round() / 1_000_000.0,
                (ll.lat() * 1_000_000.0).round() / 1_000_000.0,
            ))
            .collect();
        // Ensure closed ring
        if let Some(&first) = boundary.first() {
            boundary.push(first);
        }

        let avg_weight = if count > 0 { sum_weight / count as f64 } else { 0.0 };
        let cell_str = cell.to_string();
        let ring_coords: Vec<Vec<f64>> = boundary.iter().map(|&(lon, lat)| vec![lon, lat]).collect();

        let feat = serde_json::json!({
            "type": "Feature",
            "id": cell_str,
            "geometry": {
                "type": "Polygon",
                "coordinates": [ring_coords]
            },
            "properties": {
                "h3_index": cell_str,
                "resolution": resolution,
                "count": count,
                "total_weight": (sum_weight * 100.0).round() / 100.0,
                "avg_weight": (avg_weight * 100.0).round() / 100.0,
                "center_lon": center.0,
                "center_lat": center.1,
            }
        });

        features.push(feat);

        cells.push(H3CellAggregate {
            cell_index: cell_str,
            resolution,
            count,
            total_weight: (sum_weight * 100.0).round() / 100.0,
            avg_weight: (avg_weight * 100.0).round() / 100.0,
            center,
            boundary,
        });
    }

    let geojson = serde_json::json!({
        "type": "FeatureCollection",
        "features": features
    });

    Ok(H3AggregationResult {
        resolution,
        total_points,
        cell_count: cells.len(),
        cells,
        geojson,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_h3_aggregation_basic() {
        let points = vec![
            H3AggregationInput { lon: -122.4194, lat: 37.7749, weight: Some(10.0) },
            H3AggregationInput { lon: -122.4195, lat: 37.7750, weight: Some(20.0) },
            H3AggregationInput { lon: 139.6917, lat: 35.6895, weight: Some(5.0) },
        ];

        let res = aggregate_to_h3(&points, 7).unwrap();
        assert_eq!(res.total_points, 3);
        assert_eq!(res.cell_count, 2); // 2 in SF (same cell at res 7), 1 in Tokyo

        for cell in &res.cells {
            assert!(cell.boundary.len() >= 7); // Hexagon has 6 vertices + 1 closed
            assert_eq!(cell.boundary.first(), cell.boundary.last());
        }

        let sf_cell = res.cells.iter().find(|c| c.count == 2).unwrap();
        assert_eq!(sf_cell.total_weight, 30.0);
        assert_eq!(sf_cell.avg_weight, 15.0);
    }

    #[test]
    fn test_h3_invalid_resolution() {
        let points = vec![H3AggregationInput { lon: 0.0, lat: 0.0, weight: None }];
        assert!(aggregate_to_h3(&points, 16).is_err());
    }
}
