use kiddo::dist::SquaredEuclidean;
use kiddo::ImmutableKdTree;
use serde::{Deserialize, Serialize};
use std::num::NonZero;

const EARTH_RADIUS_M: f64 = 6_371_008.8;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpatialPointInput {
    pub id: String,
    pub lon: f64,
    pub lat: f64,
    pub elevation_m: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnnNeighbor {
    pub id: String,
    pub lon: f64,
    pub lat: f64,
    /// Distance along Earth's surface (geodesic great-circle approximation) in meters
    pub surface_distance_m: f64,
    /// Direct 3D line-of-sight Euclidean distance in meters
    pub euclidean_distance_3d_m: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnnQueryResult {
    pub query_lon: f64,
    pub query_lat: f64,
    pub k: usize,
    pub neighbors: Vec<KnnNeighbor>,
    pub execution_micros: f64,
}

/// Converts geographic coordinates (lon, lat in degrees, elevation in meters)
/// into 3D Earth-Centered, Earth-Fixed (ECEF) Cartesian coordinates [x, y, z] in meters.
#[inline]
pub fn geodetic_to_ecef(lon_deg: f64, lat_deg: f64, elevation_m: f64) -> [f64; 3] {
    let lat_rad = lat_deg.to_radians();
    let lon_rad = lon_deg.to_radians();
    let r = EARTH_RADIUS_M + elevation_m;

    let x = r * lat_rad.cos() * lon_rad.cos();
    let y = r * lat_rad.cos() * lon_rad.sin();
    let z = r * lat_rad.sin();

    [x, y, z]
}

/// Computes great-circle surface distance from 3D chord distance.
#[inline]
pub fn chord_to_surface_distance(chord_dist: f64) -> f64 {
    let half_angle_sin = (chord_dist / (2.0 * EARTH_RADIUS_M)).clamp(0.0, 1.0);
    let central_angle = 2.0 * half_angle_sin.asin();
    EARTH_RADIUS_M * central_angle
}

/// Performs SIMD-accelerated k-Nearest-Neighbor spatial query across a collection of geodetic points.
pub fn query_spatial_knn(
    points: &[SpatialPointInput],
    query_lon: f64,
    query_lat: f64,
    query_elevation_m: Option<f64>,
    k: usize,
) -> Result<KnnQueryResult, String> {
    if points.is_empty() {
        return Ok(KnnQueryResult {
            query_lon,
            query_lat,
            k,
            neighbors: Vec::new(),
            execution_micros: 0.0,
        });
    }

    let k_eff = k.clamp(1, points.len());
    let k_nonzero = NonZero::new(k_eff).ok_or_else(|| "k must be >= 1".to_string())?;

    let start = std::time::Instant::now();

    // Convert all points to 3D ECEF entries: (index_u32, [x, y, z])
    let entries: Vec<(u32, [f64; 3])> = points
        .iter()
        .enumerate()
        .map(|(idx, pt)| {
            let ecef = geodetic_to_ecef(pt.lon, pt.lat, pt.elevation_m.unwrap_or(0.0));
            (idx as u32, ecef)
        })
        .collect();

    // Construct immutable 3D k-d tree
    let tree: ImmutableKdTree<f64, 3> = ImmutableKdTree::new_from_entries(&entries)
        .map_err(|e| format!("Failed to build 3D k-d tree: {e:?}"))?;

    // Query 3D nearest neighbors
    let query_ecef = geodetic_to_ecef(query_lon, query_lat, query_elevation_m.unwrap_or(0.0));
    let raw_results = tree
        .query(&query_ecef)
        .nearest_n::<SquaredEuclidean<f64>>(k_nonzero)
        .execute();

    let mut neighbors = Vec::with_capacity(raw_results.len());
    for item in raw_results {
        let pt = &points[item.item as usize];
        let chord_dist = item.distance.max(0.0).sqrt();
        let surface_dist = chord_to_surface_distance(chord_dist);

        neighbors.push(KnnNeighbor {
            id: pt.id.clone(),
            lon: pt.lon,
            lat: pt.lat,
            surface_distance_m: (surface_dist * 10.0).round() / 10.0,
            euclidean_distance_3d_m: (chord_dist * 10.0).round() / 10.0,
        });
    }

    let elapsed = start.elapsed();
    let micros = elapsed.as_secs_f64() * 1_000_000.0;

    Ok(KnnQueryResult {
        query_lon,
        query_lat,
        k: k_eff,
        neighbors,
        execution_micros: (micros * 10.0).round() / 10.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_knn_query_accuracy() {
        // Cities around the world
        let cities = vec![
            SpatialPointInput {
                id: "London".to_string(),
                lon: -0.1276,
                lat: 51.5074,
                elevation_m: None,
            },
            SpatialPointInput {
                id: "Paris".to_string(),
                lon: 2.3522,
                lat: 48.8566,
                elevation_m: None,
            },
            SpatialPointInput {
                id: "Berlin".to_string(),
                lon: 13.4050,
                lat: 52.5200,
                elevation_m: None,
            },
            SpatialPointInput {
                id: "New York".to_string(),
                lon: -74.0060,
                lat: 40.7128,
                elevation_m: None,
            },
            SpatialPointInput {
                id: "Tokyo".to_string(),
                lon: 139.6917,
                lat: 35.6895,
                elevation_m: None,
            },
        ];

        // Query point near Brussels (closer to Paris and London than Tokyo)
        let res = query_spatial_knn(&cities, 4.3517, 50.8503, None, 3).expect("kNN query should succeed");
        assert_eq!(res.neighbors.len(), 3);

        // Nearest should be Paris or London, definitely not Tokyo or New York
        let top1 = &res.neighbors[0];
        let top2 = &res.neighbors[1];
        let top3 = &res.neighbors[2];

        assert!(top1.id == "Paris" || top1.id == "London");
        assert!(top2.id == "Paris" || top2.id == "London" || top2.id == "Berlin");
        assert!(top3.id == "Paris" || top3.id == "London" || top3.id == "Berlin");

        // Surface distance from Brussels to Paris is ~264 km
        assert!(top1.surface_distance_m < 500_000.0);
    }
}
