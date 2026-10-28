use std::f64::consts::PI;

pub const HALF_CIRCUMFERENCE: f64 = 20_037_508.342789244;
pub const EXTENT: f64 = 4096.0;

/// Bounding box in EPSG:3857 coordinates: [min_x, min_y, max_x, max_y]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BBox3857 {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl BBox3857 {
    pub fn new(min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Self {
        Self {
            min_x,
            min_y,
            max_x,
            max_y,
        }
    }

    pub fn width(&self) -> f64 {
        self.max_x - self.min_x
    }

    pub fn height(&self) -> f64 {
        self.max_y - self.min_y
    }

    /// Expands the bbox by a buffer ratio (e.g. 0.05 for 5% buffer to avoid clipping boundary artifacts)
    pub fn buffer(&self, ratio: f64) -> Self {
        let dx = self.width() * ratio;
        let dy = self.height() * ratio;
        Self {
            min_x: self.min_x - dx,
            min_y: self.min_y - dy,
            max_x: self.max_x + dx,
            max_y: self.max_y + dy,
        }
    }
}

/// Convert longitude & latitude (EPSG:4326) to Web Mercator (EPSG:3857) meters
pub fn lon_lat_to_epsg3857(lon: f64, lat: f64) -> (f64, f64) {
    let x = lon * HALF_CIRCUMFERENCE / 180.0;
    let clamped_lat = lat.clamp(-85.0511287798066, 85.0511287798066);
    let rad = clamped_lat * PI / 180.0;
    let y = ((rad / 2.0 + PI / 4.0).tan()).ln() * (HALF_CIRCUMFERENCE / PI);
    (x, y)
}

/// Convert Web Mercator (EPSG:3857) meters to longitude & latitude (EPSG:4326)
pub fn epsg3857_to_lon_lat(x: f64, y: f64) -> (f64, f64) {
    let lon = (x / HALF_CIRCUMFERENCE) * 180.0;
    let lat = ((y / (HALF_CIRCUMFERENCE / PI)).exp().atan() - PI / 4.0) * 2.0 * 180.0 / PI;
    (lon, lat)
}

/// Calculates the EPSG:3857 bounding box for a Slippy map tile (z, x, y).
pub fn tile_to_bbox_epsg3857(z: u32, x: u32, y: u32) -> BBox3857 {
    let n = (1_u64 << z) as f64;
    let tile_size = (2.0 * HALF_CIRCUMFERENCE) / n;

    let min_x = x as f64 * tile_size - HALF_CIRCUMFERENCE;
    let max_x = (x as f64 + 1.0) * tile_size - HALF_CIRCUMFERENCE;

    let max_y = HALF_CIRCUMFERENCE - y as f64 * tile_size;
    let min_y = HALF_CIRCUMFERENCE - (y as f64 + 1.0) * tile_size;

    BBox3857::new(min_x, min_y, max_x, max_y)
}

/// Projects a 3857 coordinate (x, y) to integer tile space [0, 4096].
/// Note: Tile Y increases downwards.
pub fn project_to_tile(x: f64, y: f64, bbox: &BBox3857, extent: f64) -> (i32, i32) {
    let px = ((x - bbox.min_x) / bbox.width() * extent).round() as i32;
    let py = ((bbox.max_y - y) / bbox.height() * extent).round() as i32;
    (px, py)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lon_lat_roundtrip() {
        let (x, y) = lon_lat_to_epsg3857(90.4125, 23.8103);
        let (lon, lat) = epsg3857_to_lon_lat(x, y);
        assert!((lon - 90.4125).abs() < 1e-6);
        assert!((lat - 23.8103).abs() < 1e-6);
    }

    #[test]
    fn test_tile_to_bbox() {
        let bbox = tile_to_bbox_epsg3857(0, 0, 0);
        assert!((bbox.min_x + HALF_CIRCUMFERENCE).abs() < 1e-3);
        assert!((bbox.max_x - HALF_CIRCUMFERENCE).abs() < 1e-3);
        assert!((bbox.min_y + HALF_CIRCUMFERENCE).abs() < 1e-3);
        assert!((bbox.max_y - HALF_CIRCUMFERENCE).abs() < 1e-3);
    }
}
