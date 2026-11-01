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
    /// Initial geodesic forward azimuth bearing from query origin to neighbor (0° to 360°)
    pub bearing_deg: f64,
    /// 16-point cardinal compass direction (e.g. N, NE, ENE, SSW)
    pub compass_direction: String,
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

/// Computes forward azimuth bearing from (lon1, lat1) to (lon2, lat2) in degrees [0, 360).
#[inline]
pub fn calculate_forward_bearing(lon1: f64, lat1: f64, lon2: f64, lat2: f64) -> f64 {
    let phi1 = lat1.to_radians();
    let phi2 = lat2.to_radians();
    let delta_lambda = (lon2 - lon1).to_radians();

    let y = delta_lambda.sin() * phi2.cos();
    let x = phi1.cos() * phi2.sin() - phi1.sin() * phi2.cos() * delta_lambda.cos();
    let bearing_rad = y.atan2(x);
    let bearing_deg = bearing_rad.to_degrees();
    (bearing_deg % 360.0 + 360.0) % 360.0
}

/// Converts a 0°-360° azimuth bearing into a 16-point cardinal compass string (e.g. "N", "NNE", "NE").
#[inline]
pub fn bearing_to_compass_direction(bearing_deg: f64) -> &'static str {
    const DIRECTIONS: [&str; 16] = [
        "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
        "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
    ];
    let normalized = (bearing_deg % 360.0 + 360.0) % 360.0;
    let idx = ((normalized / 22.5).round() as usize) % 16;
    DIRECTIONS[idx]
}

/// Performs SIMD-accelerated k-Nearest-Neighbor spatial query across a collection of geodetic points.
/// Optionally filters neighbors exceeding `max_distance_meters`.
pub fn query_spatial_knn(
    points: &[SpatialPointInput],
    query_lon: f64,
    query_lat: f64,
    query_elevation_m: Option<f64>,
    k: usize,
    max_distance_meters: Option<f64>,
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

        // Apply search radius cutoff if specified
        if let Some(max_dist) = max_distance_meters {
            if surface_dist > max_dist {
                continue;
            }
        }

        let bearing = calculate_forward_bearing(query_lon, query_lat, pt.lon, pt.lat);
        let compass = bearing_to_compass_direction(bearing).to_string();

        neighbors.push(KnnNeighbor {
            id: pt.id.clone(),
            lon: pt.lon,
            lat: pt.lat,
            surface_distance_m: (surface_dist * 10.0).round() / 10.0,
            euclidean_distance_3d_m: (chord_dist * 10.0).round() / 10.0,
            bearing_deg: (bearing * 10.0).round() / 10.0,
            compass_direction: compass,
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
        let res = query_spatial_knn(&cities, 4.3517, 50.8503, None, 3, None).expect("kNN query should succeed");
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
        assert!(!top1.compass_direction.is_empty());
        assert!(top1.bearing_deg >= 0.0 && top1.bearing_deg < 360.0);

        // Distance cutoff test: if max_distance_meters is 300 km (300,000m), London and Paris pass, but Berlin (~650 km) is excluded
        let res_filtered = query_spatial_knn(&cities, 4.3517, 50.8503, None, 5, Some(350_000.0)).expect("Filtered query should succeed");
        assert!(res_filtered.neighbors.len() <= 2);
        for n in &res_filtered.neighbors {
            assert!(n.surface_distance_m <= 350_000.0);
        }
    }

    #[test]
    fn test_bearing_and_compass() {
        // Query at Equator Prime Meridian (0.0, 0.0)
        // Due North: (0.0, 10.0) -> bearing ~ 0 deg, "N"
        let b_north = calculate_forward_bearing(0.0, 0.0, 0.0, 10.0);
        assert!((b_north - 0.0).abs() < 1.0 || (b_north - 360.0).abs() < 1.0);
        assert_eq!(bearing_to_compass_direction(b_north), "N");

        // Due East: (10.0, 0.0) -> bearing ~ 90 deg, "E"
        let b_east = calculate_forward_bearing(0.0, 0.0, 10.0, 0.0);
        assert!((b_east - 90.0).abs() < 1.0);
        assert_eq!(bearing_to_compass_direction(b_east), "E");

        // Due South: (0.0, -10.0) -> bearing ~ 180 deg, "S"
        let b_south = calculate_forward_bearing(0.0, 0.0, 0.0, -10.0);
        assert!((b_south - 180.0).abs() < 1.0);
        assert_eq!(bearing_to_compass_direction(b_south), "S");

        // Due West: (-10.0, 0.0) -> bearing ~ 270 deg, "W"
        let b_west = calculate_forward_bearing(0.0, 0.0, -10.0, 0.0);
        assert!((b_west - 270.0).abs() < 1.0);
        assert_eq!(bearing_to_compass_direction(b_west), "W");

        // Northeast: (10.0, 10.0) -> bearing ~ 45 deg, "NE"
        let b_ne = calculate_forward_bearing(0.0, 0.0, 10.0, 10.0);
        assert_eq!(bearing_to_compass_direction(b_ne), "NE");
    }
}
