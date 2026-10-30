use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use rstar::{RTree, RTreeObject, AABB};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::math::{lon_lat_to_epsg3857, project_to_tile, project_to_tile_f64, tile_to_bbox_epsg3857, EXTENT};
use fast_mvt::{MvtGeometry, MvtLayerBuilder};
use geo::{Coord, LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon, Simplify};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Geometry3857 {
    Point([f64; 2]),
    MultiPoint(Vec<[f64; 2]>),
    LineString(Vec<[f64; 2]>),
    MultiLineString(Vec<Vec<[f64; 2]>>),
    Polygon(Vec<Vec<[f64; 2]>>),
    MultiPolygon(Vec<Vec<Vec<[f64; 2]>>>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexedFeature {
    pub id: String,
    pub geometry: Geometry3857,
    pub properties: serde_json::Map<String, Value>,
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl RTreeObject for IndexedFeature {
    type Envelope = AABB<[f64; 2]>;

    fn envelope(&self) -> Self::Envelope {
        AABB::from_corners([self.min_x, self.min_y], [self.max_x, self.max_y])
    }
}

pub struct Dataset {
    pub id: String,
    pub name: String,
    pub tree: RTree<IndexedFeature>,
    pub features: Vec<IndexedFeature>,
}

pub struct DatasetStore {
    datasets: HashMap<String, Dataset>,
    tile_cache: moka::sync::Cache<(String, u32, u32, u32), Arc<Vec<u8>>>,
}

pub type SharedDatasetStore = Arc<RwLock<DatasetStore>>;

impl Default for DatasetStore {
    fn default() -> Self {
        Self::new()
    }
}

impl DatasetStore {
    pub fn new() -> Self {
        Self {
            datasets: HashMap::new(),
            tile_cache: moka::sync::Cache::builder()
                .max_capacity(10_000)
                .time_to_idle(std::time::Duration::from_secs(600))
                .build(),
        }
    }

    pub fn insert_geojson(&mut self, dataset_id: &str, geojson_str: &str) -> Result<usize, String> {
        let parsed: Value = serde_json::from_str(geojson_str)
            .map_err(|e| format!("Invalid GeoJSON: {e}"))?;

        let raw_features = match parsed.get("features").and_then(|f| f.as_array()) {
            Some(f) => f.clone(),
            None => {
                if parsed.get("type").and_then(|t| t.as_str()) == Some("Feature") {
                    vec![parsed]
                } else {
                    return Err("Expected FeatureCollection or Feature".into());
                }
            }
        };

        let mut indexed_features = Vec::with_capacity(raw_features.len());

        for (idx, feat) in raw_features.iter().enumerate() {
            let id = feat.get("id")
                .map(|id| match id {
                    Value::String(s) => s.clone(),
                    Value::Number(n) => n.to_string(),
                    _ => format!("{idx}"),
                })
                .unwrap_or_else(|| format!("{idx}"));

            let properties = feat.get("properties")
                .and_then(|p| p.as_object())
                .cloned()
                .unwrap_or_default();

            let geom = match feat.get("geometry").and_then(|g| g.as_object()) {
                Some(g) => g,
                None => continue,
            };

            let geom_type = geom.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let coords = match geom.get("coordinates") {
                Some(c) => c,
                None => continue,
            };

            let parsed_geom = parse_and_project_geometry(geom_type, coords)?;
            let (min_x, min_y, max_x, max_y) = compute_bounds(&parsed_geom);

            indexed_features.push(IndexedFeature {
                id,
                geometry: parsed_geom,
                properties,
                min_x,
                min_y,
                max_x,
                max_y,
            });
        }

        let count = indexed_features.len();
        let tree = RTree::bulk_load(indexed_features.clone());

        self.tile_cache.invalidate_all();
        self.datasets.insert(
            dataset_id.to_string(),
            Dataset {
                id: dataset_id.to_string(),
                name: dataset_id.to_string(),
                tree,
                features: indexed_features,
            },
        );

        Ok(count)
    }

    pub fn insert_indexed_features(&mut self, dataset_id: &str, indexed_features: Vec<IndexedFeature>) -> usize {
        let count = indexed_features.len();
        let tree = RTree::bulk_load(indexed_features.clone());

        self.tile_cache.invalidate_all();
        self.datasets.insert(
            dataset_id.to_string(),
            Dataset {
                id: dataset_id.to_string(),
                name: dataset_id.to_string(),
                tree,
                features: indexed_features,
            },
        );

        count
    }

    pub fn insert_gpkg(&mut self, dataset_id: &str, file_path: &str) -> Result<usize, String> {
        let features = super::gpkg::read_gpkg_file(file_path)?;
        Ok(self.insert_indexed_features(dataset_id, features))
    }

    pub fn insert_shapefile(&mut self, dataset_id: &str, file_path: &str) -> Result<usize, String> {
        let features = super::shapefile_reader::read_shapefile(file_path)?;
        Ok(self.insert_indexed_features(dataset_id, features))
    }

    pub fn insert_spatial_file(&mut self, dataset_id: &str, file_path: &str) -> Result<usize, String> {
        let path = std::path::Path::new(file_path);
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

        match ext.as_str() {
            "gpkg" => self.insert_gpkg(dataset_id, file_path),
            "shp" => self.insert_shapefile(dataset_id, file_path),
            "parquet" | "geoparquet" => {
                let load_res = crate::analysis::load_geoparquet_as_geojson(file_path, None)?;
                let geojson_str = serde_json::to_string(&load_res.feature_collection)
                    .map_err(|e| e.to_string())?;
                self.insert_geojson(dataset_id, &geojson_str)
            }
            "geojson" | "json" => {
                let content = std::fs::read_to_string(file_path)
                    .map_err(|e| format!("Could not read file '{file_path}': {e}"))?;
                self.insert_geojson(dataset_id, &content)
            }
            _ => Err(format!("Unsupported spatial format: '.{}'", ext)),
        }
    }

    pub fn get_dataset_bounds_4326(&self, dataset_id: &str) -> Option<[f64; 4]> {
        let dataset = self.datasets.get(dataset_id)?;
        if dataset.features.is_empty() {
            return None;
        }
        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        for f in &dataset.features {
            if f.min_x < min_x { min_x = f.min_x; }
            if f.min_y < min_y { min_y = f.min_y; }
            if f.max_x > max_x { max_x = f.max_x; }
            if f.max_y > max_y { max_y = f.max_y; }
        }
        let (min_lon, min_lat) = super::math::epsg3857_to_lon_lat(min_x, min_y);
        let (max_lon, max_lat) = super::math::epsg3857_to_lon_lat(max_x, max_y);
        Some([min_lon, min_lat, max_lon, max_lat])
    }

    pub fn get_dataset_feature_collection(&self, dataset_id: &str) -> Option<Value> {
        let dataset = self.datasets.get(dataset_id)?;
        Some(dataset_to_geojson_feature_collection(dataset))
    }

    pub fn has_dataset(&self, dataset_id: &str) -> bool {
        self.datasets.contains_key(dataset_id)
    }

    pub fn clear_dataset(&mut self, dataset_id: &str) -> bool {
        self.tile_cache.invalidate_all();
        self.datasets.remove(dataset_id).is_some()
    }

    pub fn query_bbox(
        &self,
        min_x: f64,
        min_y: f64,
        max_x: f64,
        max_y: f64,
        dataset_ids: Option<&[String]>,
    ) -> Vec<(&str, &IndexedFeature)> {
        let envelope = AABB::from_corners([min_x, min_y], [max_x, max_y]);
        let mut results = Vec::new();
        for (id, dataset) in &self.datasets {
            if let Some(target_ids) = dataset_ids {
                if !target_ids.is_empty() && !target_ids.iter().any(|t| t == id) {
                    continue;
                }
            }
            for feat in dataset.tree.locate_in_envelope_intersecting(envelope) {
                results.push((id.as_str(), feat));
            }
        }
        results
    }

    /// Renders an MVT tile for a dataset at (z, x, y), utilizing LRU memory caching.
    pub fn render_tile(&self, dataset_id: &str, z: u32, x: u32, y: u32) -> Result<Vec<u8>, String> {
        let cache_key = (dataset_id.to_string(), z, x, y);
        if let Some(cached) = self.tile_cache.get(&cache_key) {
            return Ok((*cached).clone());
        }

        let dataset = self.datasets.get(dataset_id)
            .ok_or_else(|| format!("Dataset '{dataset_id}' not found"))?;

        let bbox = tile_to_bbox_epsg3857(z, x, y);
        // Add a 5% buffer around the tile bbox to ensure overlapping line/polygon geometry renders cleanly
        let buffered_bbox = bbox.buffer(0.05);

        let query_envelope = AABB::from_corners(
            [buffered_bbox.min_x, buffered_bbox.min_y],
            [buffered_bbox.max_x, buffered_bbox.max_y],
        );

        let matching_features: Vec<&IndexedFeature> = dataset.tree
            .locate_in_envelope_intersecting(query_envelope)
            .collect();

        let layer = MvtLayerBuilder::new(dataset_id)
            .map_err(|e| format!("Failed to create MVT layer: {e}"))?;

        let mut current_layer = layer;

        for feat in matching_features {
            let mvt_geom = match &feat.geometry {
                Geometry3857::Point(pt) => {
                    let (px, py) = project_to_tile(pt[0], pt[1], &bbox, EXTENT);
                    MvtGeometry::Point((px, py).into())
                }
                Geometry3857::MultiPoint(pts) => {
                    let tile_pts: Vec<Point<i32>> = pts.iter()
                        .map(|p| {
                            let (px, py) = project_to_tile(p[0], p[1], &bbox, EXTENT);
                            (px, py).into()
                        })
                        .collect();
                    MvtGeometry::MultiPoint(MultiPoint::new(tile_pts))
                }
                Geometry3857::LineString(line) => {
                    let tile_f64: Vec<Coord<f64>> = line.iter()
                        .map(|p| {
                            let (px, py) = project_to_tile_f64(p[0], p[1], &bbox, EXTENT);
                            Coord { x: px, y: py }
                        })
                        .collect();
                    let simplified = LineString::new(tile_f64).simplify(1.0);
                    let tile_line: Vec<Coord<i32>> = simplified.into_iter()
                        .map(|c| Coord { x: c.x.round() as i32, y: c.y.round() as i32 })
                        .collect();
                    if tile_line.len() < 2 {
                        continue;
                    }
                    MvtGeometry::LineString(LineString::new(tile_line))
                }
                Geometry3857::MultiLineString(lines) => {
                    let mut tile_lines = Vec::new();
                    for l in lines {
                        let tile_f64: Vec<Coord<f64>> = l.iter()
                            .map(|p| {
                                let (px, py) = project_to_tile_f64(p[0], p[1], &bbox, EXTENT);
                                Coord { x: px, y: py }
                            })
                            .collect();
                        let simplified = LineString::new(tile_f64).simplify(1.0);
                        let coords: Vec<Coord<i32>> = simplified.into_iter()
                            .map(|c| Coord { x: c.x.round() as i32, y: c.y.round() as i32 })
                            .collect();
                        if coords.len() >= 2 {
                            tile_lines.push(LineString::new(coords));
                        }
                    }
                    if tile_lines.is_empty() {
                        continue;
                    }
                    MvtGeometry::MultiLineString(MultiLineString::new(tile_lines))
                }
                Geometry3857::Polygon(rings) => {
                    if rings.is_empty() {
                        continue;
                    }
                    let ext_f64: Vec<Coord<f64>> = rings[0].iter()
                        .map(|p| {
                            let (px, py) = project_to_tile_f64(p[0], p[1], &bbox, EXTENT);
                            Coord { x: px, y: py }
                        })
                        .collect();
                    let int_f64: Vec<LineString<f64>> = rings.iter().skip(1)
                        .map(|r| {
                            let coords = r.iter()
                                .map(|p| {
                                    let (px, py) = project_to_tile_f64(p[0], p[1], &bbox, EXTENT);
                                    Coord { x: px, y: py }
                                })
                                .collect();
                            LineString::new(coords)
                        })
                        .collect();

                    let simplified_poly = Polygon::new(LineString::new(ext_f64), int_f64).simplify(1.0);
                    let ext_coords: Vec<Coord<i32>> = simplified_poly.exterior().coords()
                        .map(|c| Coord { x: c.x.round() as i32, y: c.y.round() as i32 })
                        .collect();
                    if ext_coords.len() < 4 {
                        continue;
                    }
                    let int_rings: Vec<LineString<i32>> = simplified_poly.interiors().iter()
                        .filter_map(|r| {
                            let coords: Vec<Coord<i32>> = r.coords()
                                .map(|c| Coord { x: c.x.round() as i32, y: c.y.round() as i32 })
                                .collect();
                            if coords.len() >= 4 {
                                Some(LineString::new(coords))
                            } else {
                                None
                            }
                        })
                        .collect();

                    MvtGeometry::Polygon(Polygon::new(LineString::new(ext_coords), int_rings))
                }
                Geometry3857::MultiPolygon(polys) => {
                    let mut tile_polys = Vec::new();
                    for rings in polys {
                        if rings.is_empty() {
                            continue;
                        }
                        let ext_f64: Vec<Coord<f64>> = rings[0].iter()
                            .map(|p| {
                                let (px, py) = project_to_tile_f64(p[0], p[1], &bbox, EXTENT);
                                Coord { x: px, y: py }
                            })
                            .collect();
                        let int_f64: Vec<LineString<f64>> = rings.iter().skip(1)
                            .map(|r| {
                                let coords = r.iter()
                                    .map(|p| {
                                        let (px, py) = project_to_tile_f64(p[0], p[1], &bbox, EXTENT);
                                        Coord { x: px, y: py }
                                    })
                                    .collect();
                                LineString::new(coords)
                            })
                            .collect();

                        let simplified_poly = Polygon::new(LineString::new(ext_f64), int_f64).simplify(1.0);
                        let ext_coords: Vec<Coord<i32>> = simplified_poly.exterior().coords()
                            .map(|c| Coord { x: c.x.round() as i32, y: c.y.round() as i32 })
                            .collect();
                        if ext_coords.len() < 4 {
                            continue;
                        }
                        let int_rings: Vec<LineString<i32>> = simplified_poly.interiors().iter()
                            .filter_map(|r| {
                                let coords: Vec<Coord<i32>> = r.coords()
                                    .map(|c| Coord { x: c.x.round() as i32, y: c.y.round() as i32 })
                                    .collect();
                                if coords.len() >= 4 {
                                    Some(LineString::new(coords))
                                } else {
                                    None
                                }
                            })
                            .collect();

                        tile_polys.push(Polygon::new(LineString::new(ext_coords), int_rings));
                    }
                    if tile_polys.is_empty() {
                        continue;
                    }
                    MvtGeometry::MultiPolygon(MultiPolygon::new(tile_polys))
                }
            };

            let mut mvt_feature = current_layer.feature(&mvt_geom)
                .map_err(|e| format!("Failed to create MVT feature: {e}"))?;

            // Tag feature ID
            let _ = mvt_feature.tag("_id", feat.id.as_str());
            let _ = mvt_feature.tag("id", feat.id.as_str());

            // Add properties as tags
            for (k, v) in &feat.properties {
                match v {
                    Value::String(s) => {
                        let _ = mvt_feature.tag(k.as_str(), s.as_str());
                    }
                    Value::Number(n) => {
                        if let Some(i) = n.as_i64() {
                            let _ = mvt_feature.tag(k.as_str(), i);
                        } else if let Some(f) = n.as_f64() {
                            let _ = mvt_feature.tag(k.as_str(), f as f32);
                        }
                    }
                    Value::Bool(b) => {
                        let _ = mvt_feature.tag(k.as_str(), *b);
                    }
                    _ => {
                        let _ = mvt_feature.tag(k.as_str(), v.to_string().as_str());
                    }
                }
            }

            current_layer = mvt_feature.end();
        }

        let bytes = current_layer.encode();
        self.tile_cache.insert(cache_key, Arc::new(bytes.clone()));
        Ok(bytes)
    }

    /// Fast paginated attribute table rows
    pub fn get_records(&self, dataset_id: &str, offset: usize, limit: usize, filter: Option<&str>) -> Result<Value, String> {
        let dataset = self.datasets.get(dataset_id)
            .ok_or_else(|| format!("Dataset '{dataset_id}' not found"))?;

        let filtered: Vec<&IndexedFeature> = match filter {
            Some(q) if !q.trim().is_empty() => {
                let query = q.to_lowercase();
                dataset.features.iter()
                    .filter(|f| {
                        f.id.to_lowercase().contains(&query) ||
                        f.properties.values().any(|v| {
                            v.as_str().map(|s| s.to_lowercase().contains(&query)).unwrap_or(false)
                        })
                    })
                    .collect()
            }
            _ => dataset.features.iter().collect(),
        };

        let total = filtered.len();
        let page: Vec<Value> = filtered.into_iter()
            .skip(offset)
            .take(limit)
            .map(|f| {
                serde_json::json!({
                    "id": f.id,
                    "properties": f.properties,
                })
            })
            .collect();

        Ok(serde_json::json!({
            "total": total,
            "offset": offset,
            "limit": limit,
            "records": page,
        }))
    }
}

fn parse_and_project_geometry(geom_type: &str, coords: &Value) -> Result<Geometry3857, String> {
    match geom_type {
        "Point" => {
            let pt = parse_coord(coords)?;
            let (x, y) = lon_lat_to_epsg3857(pt[0], pt[1]);
            Ok(Geometry3857::Point([x, y]))
        }
        "MultiPoint" => {
            let list = coords.as_array().ok_or("Invalid MultiPoint")?;
            let mut out = Vec::with_capacity(list.len());
            for c in list {
                let pt = parse_coord(c)?;
                let (x, y) = lon_lat_to_epsg3857(pt[0], pt[1]);
                out.push([x, y]);
            }
            Ok(Geometry3857::MultiPoint(out))
        }
        "LineString" => {
            let list = coords.as_array().ok_or("Invalid LineString")?;
            let mut out = Vec::with_capacity(list.len());
            for c in list {
                let pt = parse_coord(c)?;
                let (x, y) = lon_lat_to_epsg3857(pt[0], pt[1]);
                out.push([x, y]);
            }
            Ok(Geometry3857::LineString(out))
        }
        "MultiLineString" => {
            let list = coords.as_array().ok_or("Invalid MultiLineString")?;
            let mut out = Vec::with_capacity(list.len());
            for line in list {
                let line_arr = line.as_array().ok_or("Invalid line in MultiLineString")?;
                let mut line_coords = Vec::with_capacity(line_arr.len());
                for c in line_arr {
                    let pt = parse_coord(c)?;
                    let (x, y) = lon_lat_to_epsg3857(pt[0], pt[1]);
                    line_coords.push([x, y]);
                }
                out.push(line_coords);
            }
            Ok(Geometry3857::MultiLineString(out))
        }
        "Polygon" => {
            let rings = coords.as_array().ok_or("Invalid Polygon")?;
            let mut out = Vec::with_capacity(rings.len());
            for ring in rings {
                let ring_arr = ring.as_array().ok_or("Invalid ring in Polygon")?;
                let mut ring_coords = Vec::with_capacity(ring_arr.len());
                for c in ring_arr {
                    let pt = parse_coord(c)?;
                    let (x, y) = lon_lat_to_epsg3857(pt[0], pt[1]);
                    ring_coords.push([x, y]);
                }
                out.push(ring_coords);
            }
            Ok(Geometry3857::Polygon(out))
        }
        "MultiPolygon" => {
            let polys = coords.as_array().ok_or("Invalid MultiPolygon")?;
            let mut out = Vec::with_capacity(polys.len());
            for poly in polys {
                let rings = poly.as_array().ok_or("Invalid polygon in MultiPolygon")?;
                let mut poly_rings = Vec::with_capacity(rings.len());
                for ring in rings {
                    let ring_arr = ring.as_array().ok_or("Invalid ring")?;
                    let mut ring_coords = Vec::with_capacity(ring_arr.len());
                    for c in ring_arr {
                        let pt = parse_coord(c)?;
                        let (x, y) = lon_lat_to_epsg3857(pt[0], pt[1]);
                        ring_coords.push([x, y]);
                    }
                    poly_rings.push(ring_coords);
                }
                out.push(poly_rings);
            }
            Ok(Geometry3857::MultiPolygon(out))
        }
        _ => Err(format!("Unsupported geometry type: {geom_type}")),
    }
}

fn parse_coord(c: &Value) -> Result<[f64; 2], String> {
    let arr = c.as_array().ok_or("Coordinate is not an array")?;
    if arr.len() < 2 {
        return Err("Coordinate has fewer than 2 elements".into());
    }
    let lon = arr[0].as_f64().ok_or("Invalid lon")?;
    let lat = arr[1].as_f64().ok_or("Invalid lat")?;
    Ok([lon, lat])
}

pub fn compute_bounds(geom: &Geometry3857) -> (f64, f64, f64, f64) {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;

    let mut update = |p: &[f64; 2]| {
        if p[0] < min_x { min_x = p[0]; }
        if p[1] < min_y { min_y = p[1]; }
        if p[0] > max_x { max_x = p[0]; }
        if p[1] > max_y { max_y = p[1]; }
    };

    match geom {
        Geometry3857::Point(p) => update(p),
        Geometry3857::MultiPoint(pts) => pts.iter().for_each(&mut update),
        Geometry3857::LineString(line) => line.iter().for_each(&mut update),
        Geometry3857::MultiLineString(lines) => {
            for l in lines { l.iter().for_each(&mut update); }
        }
        Geometry3857::Polygon(rings) => {
            for r in rings { r.iter().for_each(&mut update); }
        }
        Geometry3857::MultiPolygon(polys) => {
            for poly in polys {
                for r in poly { r.iter().for_each(&mut update); }
            }
        }
    }

    (min_x, min_y, max_x, max_y)
}

pub fn geometry3857_to_geojson_4326(geom: &Geometry3857) -> Value {
    match geom {
        Geometry3857::Point(pt) => {
            let (lon, lat) = super::math::epsg3857_to_lon_lat(pt[0], pt[1]);
            serde_json::json!({
                "type": "Point",
                "coordinates": [lon, lat]
            })
        }
        Geometry3857::MultiPoint(pts) => {
            let coords: Vec<[f64; 2]> = pts.iter()
                .map(|p| {
                    let (lon, lat) = super::math::epsg3857_to_lon_lat(p[0], p[1]);
                    [lon, lat]
                })
                .collect();
            serde_json::json!({
                "type": "MultiPoint",
                "coordinates": coords
            })
        }
        Geometry3857::LineString(line) => {
            let coords: Vec<[f64; 2]> = line.iter()
                .map(|p| {
                    let (lon, lat) = super::math::epsg3857_to_lon_lat(p[0], p[1]);
                    [lon, lat]
                })
                .collect();
            serde_json::json!({
                "type": "LineString",
                "coordinates": coords
            })
        }
        Geometry3857::MultiLineString(lines) => {
            let coords: Vec<Vec<[f64; 2]>> = lines.iter()
                .map(|line| {
                    line.iter()
                        .map(|p| {
                            let (lon, lat) = super::math::epsg3857_to_lon_lat(p[0], p[1]);
                            [lon, lat]
                        })
                        .collect()
                })
                .collect();
            serde_json::json!({
                "type": "MultiLineString",
                "coordinates": coords
            })
        }
        Geometry3857::Polygon(rings) => {
            let coords: Vec<Vec<[f64; 2]>> = rings.iter()
                .map(|ring| {
                    ring.iter()
                        .map(|p| {
                            let (lon, lat) = super::math::epsg3857_to_lon_lat(p[0], p[1]);
                            [lon, lat]
                        })
                        .collect()
                })
                .collect();
            serde_json::json!({
                "type": "Polygon",
                "coordinates": coords
            })
        }
        Geometry3857::MultiPolygon(polys) => {
            let coords: Vec<Vec<Vec<[f64; 2]>>> = polys.iter()
                .map(|poly| {
                    poly.iter()
                        .map(|ring| {
                            ring.iter()
                                .map(|p| {
                                    let (lon, lat) = super::math::epsg3857_to_lon_lat(p[0], p[1]);
                                    [lon, lat]
                                })
                                .collect()
                        })
                        .collect()
                })
                .collect();
            serde_json::json!({
                "type": "MultiPolygon",
                "coordinates": coords
            })
        }
    }
}

pub fn dataset_to_geojson_feature_collection(dataset: &Dataset) -> Value {
    let features: Vec<Value> = dataset.features.iter()
        .map(|f| {
            serde_json::json!({
                "type": "Feature",
                "id": f.id,
                "geometry": geometry3857_to_geojson_4326(&f.geometry),
                "properties": f.properties,
            })
        })
        .collect();

    serde_json::json!({
        "type": "FeatureCollection",
        "features": features,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_insert_and_render_tile() {
        let mut store = DatasetStore::new();
        let sample_geojson = r#"{
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": "camera-1",
                    "geometry": { "type": "Point", "coordinates": [90.4125, 23.8103] },
                    "properties": { "name": "Dhaka Sensor 1", "status": "active" }
                },
                {
                    "type": "Feature",
                    "id": "corridor-1",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[90.40, 23.80], [90.42, 23.82]]
                    },
                    "properties": { "name": "Fibre Trunk" }
                }
            ]
        }"#;

        let count = store.insert_geojson("infra_test", sample_geojson).expect("Insert failed");
        assert_eq!(count, 2);

        // Tile (0, 0, 0) covers the whole world, so it should include both features
        let tile_bytes = store.render_tile("infra_test", 0, 0, 0).expect("Render tile failed");
        assert!(!tile_bytes.is_empty(), "MVT tile bytes should not be empty");

        // Subsequent tile request should hit the LRU cache and return identical bytes
        let cached_bytes = store.render_tile("infra_test", 0, 0, 0).expect("Cached render tile failed");
        assert_eq!(tile_bytes, cached_bytes, "Cached tile bytes must match original");

        // Test pagination
        let records = store.get_records("infra_test", 0, 10, None).expect("Get records failed");
        assert_eq!(records["total"], 2);
        assert_eq!(records["records"].as_array().unwrap().len(), 2);
    }
}
