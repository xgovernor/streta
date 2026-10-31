use geo::{
    Bearing, Centroid, Closest, ClosestPoint, Contains, Coord, CoordsIter, Destination, Distance,
    Geodesic, GeodesicArea, Intersects, LineString, Point, Polygon,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::tiles::math::{epsg3857_to_lon_lat, lon_lat_to_epsg3857};
use crate::tiles::store::{DatasetStore, Geometry3857};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentMeasurement {
    pub from: (f64, f64),
    pub to: (f64, f64),
    pub distance_m: f64,
    pub forward_bearing_deg: f64,
    pub reverse_bearing_deg: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeodesicMeasurementResult {
    pub total_distance_m: f64,
    pub total_distance_km: f64,
    pub total_distance_miles: f64,
    pub total_distance_nmi: f64,
    pub segments: Vec<SegmentMeasurement>,
    pub area_sq_m: Option<f64>,
    pub area_sq_km: Option<f64>,
    pub area_hectares: Option<f64>,
    pub area_acres: Option<f64>,
    pub perimeter_m: Option<f64>,
    pub centroid: Option<(f64, f64)>,
}

pub fn measure_geodesic(coords: &[(f64, f64)], is_polygon: bool) -> Result<GeodesicMeasurementResult, String> {
    if coords.len() < 2 {
        return Err("At least 2 points are required for geodesic measurement".to_string());
    }

    let mut total_distance_m = 0.0;
    let mut segments = Vec::with_capacity(coords.len() - 1);

    for i in 0..(coords.len() - 1) {
        let (lon1, lat1) = coords[i];
        let (lon2, lat2) = coords[i + 1];

        let p1 = Point::new(lon1, lat1);
        let p2 = Point::new(lon2, lat2);

        let dist = Geodesic.distance(p1, p2);
        let fwd = Geodesic.bearing(p1, p2);
        let rev = Geodesic.bearing(p2, p1);

        total_distance_m += dist;

        // Normalize bearings to [0, 360)
        let norm_fwd = ((fwd % 360.0) + 360.0) % 360.0;
        let norm_rev = ((rev % 360.0) + 360.0) % 360.0;

        segments.push(SegmentMeasurement {
            from: (lon1, lat1),
            to: (lon2, lat2),
            distance_m: (dist * 10.0).round() / 10.0,
            forward_bearing_deg: (norm_fwd * 100.0).round() / 100.0,
            reverse_bearing_deg: (norm_rev * 100.0).round() / 100.0,
        });
    }

    let mut area_sq_m = None;
    let mut area_sq_km = None;
    let mut area_hectares = None;
    let mut area_acres = None;
    let mut perimeter_m = None;
    let mut centroid = None;

    if is_polygon && coords.len() >= 3 {
        let mut ring_coords: Vec<Coord<f64>> = coords.iter().map(|&(lon, lat)| Coord { x: lon, y: lat }).collect();
        // Ensure ring is closed
        if let (Some(first), Some(last)) = (ring_coords.first().copied(), ring_coords.last().copied()) {
            if (first.x - last.x).abs() > 1e-9 || (first.y - last.y).abs() > 1e-9 {
                ring_coords.push(first);
            }
        }

        let poly = Polygon::new(LineString::new(ring_coords), vec![]);
        let area = poly.geodesic_area_signed().abs();
        let perim = poly.geodesic_perimeter();

        area_sq_m = Some((area * 10.0).round() / 10.0);
        area_sq_km = Some(((area / 1_000_000.0) * 1000.0).round() / 1000.0);
        area_hectares = Some(((area / 10_000.0) * 100.0).round() / 100.0);
        area_acres = Some(((area / 4046.8564224) * 100.0).round() / 100.0);
        perimeter_m = Some((perim * 10.0).round() / 10.0);

        // Centroid: use true area-weighted polygon centroid (falls back to mean if degenerated)
        if let Some(c) = poly.centroid() {
            centroid = Some((
                (c.x() * 100000.0).round() / 100000.0,
                (c.y() * 100000.0).round() / 100000.0,
            ));
        } else {
            let sum_lon: f64 = coords.iter().map(|c| c.0).sum();
            let sum_lat: f64 = coords.iter().map(|c| c.1).sum();
            centroid = Some((
                (sum_lon / coords.len() as f64 * 100000.0).round() / 100000.0,
                (sum_lat / coords.len() as f64 * 100000.0).round() / 100000.0,
            ));
        }
    }

    Ok(GeodesicMeasurementResult {
        total_distance_m: (total_distance_m * 10.0).round() / 10.0,
        total_distance_km: (total_distance_m / 1000.0 * 100.0).round() / 100.0,
        total_distance_miles: (total_distance_m / 1609.344 * 100.0).round() / 100.0,
        total_distance_nmi: (total_distance_m / 1852.0 * 100.0).round() / 100.0,
        segments,
        area_sq_m,
        area_sq_km,
        area_hectares,
        area_acres,
        perimeter_m,
        centroid,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpatialQueryHit {
    pub layer_id: String,
    pub feature_id: String,
    pub distance_m: f64,
    pub bearing_deg: f64,
    pub geometry_type: String,
    pub properties: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_lon: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_lat: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpatialQueryResult {
    pub center_lon: f64,
    pub center_lat: f64,
    pub radius_meters: f64,
    pub total_hits: usize,
    pub buffer_geojson: Value,
    pub hits: Vec<SpatialQueryHit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub area_sq_meters: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub area_sq_km: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub area_acres: Option<f64>,
}

pub fn create_geodesic_buffer_polygon(center_lon: f64, center_lat: f64, radius_meters: f64, segments: usize) -> Polygon<f64> {
    let center = Point::new(center_lon, center_lat);
    let mut ring = Vec::with_capacity(segments + 1);

    for i in 0..segments {
        let azimuth = (i as f64) * (360.0 / segments as f64);
        let dest = Geodesic.destination(center, azimuth, radius_meters);
        ring.push(Coord { x: dest.x(), y: dest.y() });
    }
    // Close the ring
    if let Some(&first) = ring.first() {
        ring.push(first);
    }

    Polygon::new(LineString::new(ring), vec![])
}

pub fn create_geodesic_sector_polygon(
    center_lon: f64,
    center_lat: f64,
    outer_radius_meters: f64,
    start_azimuth_deg: f64,
    end_azimuth_deg: f64,
    inner_radius_meters: f64,
    segments: usize,
) -> Polygon<f64> {
    let center = Point::new(center_lon, center_lat);
    let start_az = ((start_azimuth_deg % 360.0) + 360.0) % 360.0;
    let end_az = ((end_azimuth_deg % 360.0) + 360.0) % 360.0;

    let sweep = if (end_az - start_az).abs() < 1e-6 {
        360.0
    } else if end_az > start_az {
        end_az - start_az
    } else {
        (end_az - start_az) + 360.0
    };

    let arc_steps = ((segments as f64 * (sweep / 360.0)).ceil() as usize).max(8);
    let mut ring = Vec::new();

    // Outer arc: from start_az to end_az
    for i in 0..=arc_steps {
        let frac = (i as f64) / (arc_steps as f64);
        let az = ((start_az + frac * sweep) % 360.0 + 360.0) % 360.0;
        let dest = Geodesic.destination(center, az, outer_radius_meters);
        ring.push(Coord { x: dest.x(), y: dest.y() });
    }

    // Inner arc or center point
    if inner_radius_meters > 0.0 {
        for i in 0..=arc_steps {
            let frac = (i as f64) / (arc_steps as f64);
            let az = ((end_az - frac * sweep) % 360.0 + 360.0) % 360.0;
            let dest = Geodesic.destination(center, az, inner_radius_meters);
            ring.push(Coord { x: dest.x(), y: dest.y() });
        }
    } else {
        ring.push(Coord { x: center_lon, y: center_lat });
    }

    // Close the ring
    if let Some(&first) = ring.first() {
        ring.push(first);
    }

    Polygon::new(LineString::new(ring), vec![])
}

fn geometry3857_to_geo(geom: &Geometry3857) -> geo::Geometry<f64> {
    match geom {
        Geometry3857::Point(pt) => {
            let (lon, lat) = epsg3857_to_lon_lat(pt[0], pt[1]);
            geo::Geometry::Point(Point::new(lon, lat))
        }
        Geometry3857::MultiPoint(pts) => {
            let points: Vec<Point<f64>> = pts.iter().map(|p| {
                let (lon, lat) = epsg3857_to_lon_lat(p[0], p[1]);
                Point::new(lon, lat)
            }).collect();
            geo::Geometry::MultiPoint(geo::MultiPoint::new(points))
        }
        Geometry3857::LineString(pts) => {
            let coords: Vec<Coord<f64>> = pts.iter().map(|p| {
                let (lon, lat) = epsg3857_to_lon_lat(p[0], p[1]);
                Coord { x: lon, y: lat }
            }).collect();
            geo::Geometry::LineString(LineString::new(coords))
        }
        Geometry3857::MultiLineString(lines) => {
            let mls: Vec<LineString<f64>> = lines.iter().map(|line| {
                let coords: Vec<Coord<f64>> = line.iter().map(|p| {
                    let (lon, lat) = epsg3857_to_lon_lat(p[0], p[1]);
                    Coord { x: lon, y: lat }
                }).collect();
                LineString::new(coords)
            }).collect();
            geo::Geometry::MultiLineString(geo::MultiLineString::new(mls))
        }
        Geometry3857::Polygon(rings) => {
            if rings.is_empty() {
                return geo::Geometry::Polygon(Polygon::new(LineString::new(vec![]), vec![]));
            }
            let ext_coords: Vec<Coord<f64>> = rings[0].iter().map(|p| {
                let (lon, lat) = epsg3857_to_lon_lat(p[0], p[1]);
                Coord { x: lon, y: lat }
            }).collect();
            let mut interiors = Vec::new();
            for interior in &rings[1..] {
                let int_coords: Vec<Coord<f64>> = interior.iter().map(|p| {
                    let (lon, lat) = epsg3857_to_lon_lat(p[0], p[1]);
                    Coord { x: lon, y: lat }
                }).collect();
                interiors.push(LineString::new(int_coords));
            }
            geo::Geometry::Polygon(Polygon::new(LineString::new(ext_coords), interiors))
        }
        Geometry3857::MultiPolygon(polys) => {
            let mut result_polys = Vec::new();
            for rings in polys {
                if rings.is_empty() { continue; }
                let ext_coords: Vec<Coord<f64>> = rings[0].iter().map(|p| {
                    let (lon, lat) = epsg3857_to_lon_lat(p[0], p[1]);
                    Coord { x: lon, y: lat }
                }).collect();
                let mut interiors = Vec::new();
                for interior in &rings[1..] {
                    let int_coords: Vec<Coord<f64>> = interior.iter().map(|p| {
                        let (lon, lat) = epsg3857_to_lon_lat(p[0], p[1]);
                        Coord { x: lon, y: lat }
                    }).collect();
                    interiors.push(LineString::new(int_coords));
                }
                result_polys.push(Polygon::new(LineString::new(ext_coords), interiors));
            }
            geo::Geometry::MultiPolygon(geo::MultiPolygon::new(result_polys))
        }
    }
}

pub fn spatial_buffer_query(
    store: &DatasetStore,
    center_lon: f64,
    center_lat: f64,
    radius_meters: f64,
    target_layers: Option<&[String]>,
    max_results: Option<usize>,
) -> Result<SpatialQueryResult, String> {
    if radius_meters <= 0.0 {
        return Err("Radius must be greater than zero".to_string());
    }

    let buffer_poly = create_geodesic_buffer_polygon(center_lon, center_lat, radius_meters, 64);
    let center_pt = Point::new(center_lon, center_lat);

    // Compute 3857 bounding box of the buffer polygon
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;

    for coord in buffer_poly.exterior().coords() {
        let (x, y) = lon_lat_to_epsg3857(coord.x, coord.y);
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }

    let candidates = store.query_bbox(min_x, min_y, max_x, max_y, target_layers);
    let mut hits = Vec::new();

    for (dataset_id, feat) in candidates {
        let wgs_geom = geometry3857_to_geo(&feat.geometry);

        let mut intersects = false;
        let mut min_distance = f64::INFINITY;
        let mut bearing_deg = 0.0;
        let mut target_pt: Option<Point<f64>> = None;

        match &wgs_geom {
            geo::Geometry::Point(p) => {
                let dist = Geodesic.distance(center_pt, *p);
                if dist <= radius_meters {
                    intersects = true;
                    min_distance = dist;
                    let b = Geodesic.bearing(center_pt, *p);
                    bearing_deg = ((b % 360.0) + 360.0) % 360.0;
                    target_pt = Some(*p);
                }
            }
            geo::Geometry::MultiPoint(mp) => {
                for p in mp {
                    let dist = Geodesic.distance(center_pt, *p);
                    if dist <= radius_meters {
                        intersects = true;
                        if dist < min_distance {
                            min_distance = dist;
                            let b = Geodesic.bearing(center_pt, *p);
                            bearing_deg = ((b % 360.0) + 360.0) % 360.0;
                            target_pt = Some(*p);
                        }
                    }
                }
            }
            other => {
                if buffer_poly.intersects(other) {
                    intersects = true;
                    let contains_center = match other {
                        geo::Geometry::Polygon(poly) => poly.contains(&center_pt),
                        geo::Geometry::MultiPolygon(mp) => mp.contains(&center_pt),
                        _ => false,
                    };

                    if contains_center {
                        min_distance = 0.0;
                        bearing_deg = 0.0;
                        target_pt = Some(center_pt);
                    } else {
                        let closest = match other {
                            geo::Geometry::LineString(ls) => ls.closest_point(&center_pt),
                            geo::Geometry::MultiLineString(mls) => mls.closest_point(&center_pt),
                            geo::Geometry::Polygon(poly) => poly.exterior().closest_point(&center_pt),
                            geo::Geometry::MultiPolygon(mp) => {
                                let mut best_pt = None;
                                let mut best_d = f64::INFINITY;
                                for p in mp {
                                    if let Closest::SinglePoint(pt) | Closest::Intersection(pt) = p.exterior().closest_point(&center_pt) {
                                        let d = Geodesic.distance(center_pt, pt);
                                        if d < best_d {
                                            best_d = d;
                                            best_pt = Some(pt);
                                        }
                                    }
                                }
                                match best_pt {
                                    Some(pt) => Closest::SinglePoint(pt),
                                    None => Closest::Indeterminate,
                                }
                            }
                            _ => Closest::Indeterminate,
                        };

                        match closest {
                            Closest::SinglePoint(pt) | Closest::Intersection(pt) => {
                                min_distance = Geodesic.distance(center_pt, pt);
                                let b = Geodesic.bearing(center_pt, pt);
                                bearing_deg = ((b % 360.0) + 360.0) % 360.0;
                                target_pt = Some(pt);
                            }
                            Closest::Indeterminate => {
                                if let Some(first_coord) = other.coords_iter().next() {
                                    let pt = Point::new(first_coord.x, first_coord.y);
                                    min_distance = Geodesic.distance(center_pt, pt);
                                    let b = Geodesic.bearing(center_pt, pt);
                                    bearing_deg = ((b % 360.0) + 360.0) % 360.0;
                                    target_pt = Some(pt);
                                }
                            }
                        }
                    }
                }
            }
        }

        if intersects {
            let geom_type = match &feat.geometry {
                Geometry3857::Point(_) => "Point",
                Geometry3857::LineString(_) => "LineString",
                Geometry3857::Polygon(_) => "Polygon",
                Geometry3857::MultiPoint(_) => "MultiPoint",
                Geometry3857::MultiLineString(_) => "MultiLineString",
                Geometry3857::MultiPolygon(_) => "MultiPolygon",
            };

            hits.push(SpatialQueryHit {
                layer_id: dataset_id.to_string(),
                feature_id: feat.id.clone(),
                distance_m: (min_distance * 10.0).round() / 10.0,
                bearing_deg: (bearing_deg * 10.0).round() / 10.0,
                geometry_type: geom_type.to_string(),
                properties: Value::Object(feat.properties.clone()),
                target_lon: target_pt.map(|p| (p.x() * 1_000_000.0).round() / 1_000_000.0),
                target_lat: target_pt.map(|p| (p.y() * 1_000_000.0).round() / 1_000_000.0),
            });
        }
    }

    // Sort hits by distance ascending
    hits.sort_by(|a, b| a.distance_m.partial_cmp(&b.distance_m).unwrap_or(std::cmp::Ordering::Equal));

    let total_hits = hits.len();
    if let Some(limit) = max_results {
        if hits.len() > limit {
            hits.truncate(limit);
        }
    }

    // Convert buffer polygon to GeoJSON
    let buffer_coords: Vec<Vec<f64>> = buffer_poly
        .exterior()
        .coords()
        .map(|c| vec![(c.x * 1_000_000.0).round() / 1_000_000.0, (c.y * 1_000_000.0).round() / 1_000_000.0])
        .collect();

    let area_m2 = buffer_poly.geodesic_area_signed().abs();
    let area_sq_meters = Some((area_m2 * 10.0).round() / 10.0);
    let area_sq_km = Some(((area_m2 / 1_000_000.0) * 1000.0).round() / 1000.0);
    let area_acres = Some(((area_m2 / 4046.8564224) * 100.0).round() / 100.0);

    let buffer_geojson = serde_json::json!({
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [buffer_coords]
        },
        "properties": {
            "center_lon": center_lon,
            "center_lat": center_lat,
            "radius_meters": radius_meters,
            "total_hits": total_hits,
            "area_sq_meters": area_sq_meters,
            "area_sq_km": area_sq_km,
            "area_acres": area_acres
        }
    });

    Ok(SpatialQueryResult {
        center_lon,
        center_lat,
        radius_meters,
        total_hits,
        buffer_geojson,
        hits,
        area_sq_meters,
        area_sq_km,
        area_acres,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElevationSample {
    pub distance_m: f64,
    pub lon: f64,
    pub lat: f64,
    pub elevation_m: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slope_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElevationProfileResult {
    pub total_distance_m: f64,
    pub min_elevation_m: f64,
    pub max_elevation_m: f64,
    pub elevation_gain_m: f64,
    pub elevation_loss_m: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub net_elevation_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_elevation_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_slope_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_slope_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peak_distance_m: Option<f64>,
    pub samples: Vec<ElevationSample>,
}

#[derive(Deserialize)]
struct OpenMeteoElevationResponse {
    elevation: Vec<Option<f64>>,
}

pub async fn compute_elevation_profile(
    coords: &[(f64, f64)],
    sample_count: usize,
) -> Result<ElevationProfileResult, String> {
    if coords.len() < 2 {
        return Err("Path must have at least 2 points".to_string());
    }

    let sample_count = sample_count.clamp(10, 100);

    let mut cumulative_dist = Vec::with_capacity(coords.len());
    cumulative_dist.push(0.0);
    let mut total_dist = 0.0;

    for i in 0..(coords.len() - 1) {
        let p1 = Point::new(coords[i].0, coords[i].1);
        let p2 = Point::new(coords[i + 1].0, coords[i + 1].1);
        let d = Geodesic.distance(p1, p2);
        total_dist += d;
        cumulative_dist.push(total_dist);
    }

    if total_dist <= 0.0 {
        return Err("Path distance is 0 meters".to_string());
    }

    let step = total_dist / (sample_count - 1) as f64;
    let mut sample_pts: Vec<(f64, f64, f64)> = Vec::with_capacity(sample_count);

    for i in 0..sample_count {
        let target_d = (i as f64 * step).min(total_dist);

        let seg_idx = cumulative_dist
            .iter()
            .position(|&d| d >= target_d)
            .unwrap_or(cumulative_dist.len() - 1);

        let seg_idx = if seg_idx == 0 { 0 } else { seg_idx - 1 };
        let d_start = cumulative_dist[seg_idx];
        let d_end = cumulative_dist[seg_idx + 1];
        let seg_len = d_end - d_start;

        if seg_len <= 1e-6 {
            sample_pts.push((target_d, coords[seg_idx].0, coords[seg_idx].1));
        } else {
            let p_start = Point::new(coords[seg_idx].0, coords[seg_idx].1);
            let p_end = Point::new(coords[seg_idx + 1].0, coords[seg_idx + 1].1);
            let bearing = Geodesic.bearing(p_start, p_end);
            let offset = target_d - d_start;
            let dest = Geodesic.destination(p_start, bearing, offset);
            sample_pts.push((target_d, dest.x(), dest.y()));
        }
    }

    let lats: Vec<String> = sample_pts.iter().map(|s| format!("{:.5}", s.2)).collect();
    let lons: Vec<String> = sample_pts.iter().map(|s| format!("{:.5}", s.1)).collect();

    let url = format!(
        "https://api.open-meteo.com/v1/elevation?latitude={}&longitude={}",
        lats.join(","),
        lons.join(",")
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(&url)
        .header("User-Agent", "Strata-GIS/0.1.0")
        .send()
        .await
        .map_err(|e| format!("Elevation service request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Elevation API returned status: {}", response.status()));
    }

    let parsed: OpenMeteoElevationResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse elevation response: {e}"))?;

    let mut samples = Vec::with_capacity(sample_pts.len());
    let mut min_elev = f64::INFINITY;
    let mut max_elev = f64::NEG_INFINITY;
    let mut peak_distance_m = 0.0;
    let mut elev_gain = 0.0;
    let mut elev_loss = 0.0;
    let mut elev_sum = 0.0;
    let mut max_slope: f64 = 0.0;
    let mut slope_sum: f64 = 0.0;
    let mut prev_elev: Option<f64> = None;
    let mut prev_dist: f64 = 0.0;

    for (i, &(dist, lon, lat)) in sample_pts.iter().enumerate() {
        let elev = parsed
            .elevation
            .get(i)
            .and_then(|&e| e)
            .unwrap_or(0.0);

        min_elev = min_elev.min(elev);
        if elev > max_elev {
            max_elev = elev;
            peak_distance_m = dist;
        }
        elev_sum += elev;

        let mut current_slope: Option<f64> = None;

        if let Some(prev) = prev_elev {
            let diff = elev - prev;
            if diff > 0.0 {
                elev_gain += diff;
            } else {
                elev_loss += diff.abs();
            }

            let delta_d = dist - prev_dist;
            if delta_d > 0.1 {
                let slope = (diff / delta_d) * 100.0;
                current_slope = Some((slope * 10.0).round() / 10.0);
                max_slope = max_slope.max(slope.abs());
                slope_sum += slope.abs();
            }
        }
        prev_elev = Some(elev);
        prev_dist = dist;

        samples.push(ElevationSample {
            distance_m: (dist * 10.0).round() / 10.0,
            lon: (lon * 100_000.0).round() / 100_000.0,
            lat: (lat * 100_000.0).round() / 100_000.0,
            elevation_m: (elev * 10.0).round() / 10.0,
            slope_pct: current_slope,
        });
    }

    let first_elev = samples.first().map(|s| s.elevation_m).unwrap_or(0.0);
    let last_elev = samples.last().map(|s| s.elevation_m).unwrap_or(0.0);
    let count = samples.len().max(1) as f64;

    Ok(ElevationProfileResult {
        total_distance_m: (total_dist * 10.0).round() / 10.0,
        min_elevation_m: if min_elev.is_infinite() { 0.0 } else { min_elev },
        max_elevation_m: if max_elev.is_infinite() { 0.0 } else { max_elev },
        elevation_gain_m: (elev_gain * 10.0).round() / 10.0,
        elevation_loss_m: (elev_loss * 10.0).round() / 10.0,
        net_elevation_m: Some(((last_elev - first_elev) * 10.0).round() / 10.0),
        avg_elevation_m: Some((elev_sum / count * 10.0).round() / 10.0),
        max_slope_pct: Some((max_slope * 10.0).round() / 10.0),
        avg_slope_pct: if count > 1.0 {
            Some((slope_sum / (count - 1.0) * 10.0).round() / 10.0)
        } else {
            Some(0.0)
        },
        peak_distance_m: Some((peak_distance_m * 10.0).round() / 10.0),
        samples,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_measure_geodesic_distance_and_bearings() {
        let paris = (2.3522, 48.8566);
        let london = (-0.1276, 51.5074);
        let res = measure_geodesic(&[paris, london], false).unwrap();

        assert!(res.total_distance_m > 340_000.0 && res.total_distance_m < 350_000.0);
        assert_eq!(res.segments.len(), 1);
        assert!(res.segments[0].forward_bearing_deg > 325.0 && res.segments[0].forward_bearing_deg < 340.0);
    }

    #[test]
    fn test_measure_geodesic_polygon_area() {
        let square = vec![
            (0.0, 0.0),
            (1.0, 0.0),
            (1.0, 1.0),
            (0.0, 1.0),
        ];
        let res = measure_geodesic(&square, true).unwrap();

        assert!(res.area_sq_m.is_some());
        let area = res.area_sq_m.unwrap();
        assert!(area > 1.2e10 && area < 1.3e10);
    }

    #[test]
    fn test_geodesic_buffer_generation() {
        let poly = create_geodesic_buffer_polygon(0.0, 0.0, 10_000.0, 64);
        assert_eq!(poly.exterior().coords().count(), 65);
    }

    #[test]
    fn test_measure_geodesic_polygon_non_uniform_centroid() {
        let non_uniform = vec![
            (0.0, 0.0),
            (0.1, 0.0),
            (0.2, 0.0),
            (0.3, 0.0),
            (0.4, 0.0),
            (0.5, 0.0),
            (0.6, 0.0),
            (0.7, 0.0),
            (0.8, 0.0),
            (0.9, 0.0),
            (1.0, 0.0),
            (1.0, 1.0),
            (0.0, 1.0),
        ];
        let res = measure_geodesic(&non_uniform, true).unwrap();
        let (cx, cy) = res.centroid.unwrap();
        assert!((cx - 0.5).abs() < 1e-4, "Centroid X should be 0.5, got {}", cx);
        assert!((cy - 0.5).abs() < 1e-4, "Centroid Y should be 0.5, got {}", cy);
    }

    #[test]
    fn test_geodesic_sector_generation() {
        // 60-degree wedge from 45 to 105 degrees with 0 inner radius
        let poly = create_geodesic_sector_polygon(0.0, 0.0, 5_000.0, 45.0, 105.0, 0.0, 64);
        assert!(poly.exterior().coords().count() >= 10);
        let first = poly.exterior().coords().next().unwrap();
        let last = poly.exterior().coords().last().unwrap();
        assert_eq!(first, last, "Sector ring must be closed");

        // Doughnut / band sector with inner radius
        let doughnut = create_geodesic_sector_polygon(0.0, 0.0, 5_000.0, 45.0, 105.0, 1_000.0, 64);
        assert!(doughnut.exterior().coords().count() >= 20);
    }

    #[test]
    fn test_spatial_buffer_area_calculation() {
        let poly = create_geodesic_buffer_polygon(0.0, 0.0, 1_000.0, 64);
        let area = poly.geodesic_area_signed().abs();
        // pi * 1000^2 ~ 3,141,592 m^2
        assert!(area > 3.1e6 && area < 3.2e6, "Buffer area should be ~3.14e6, got {}", area);
    }
}

