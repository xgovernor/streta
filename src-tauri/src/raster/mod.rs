pub mod cache;

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use serde::{Deserialize, Serialize};

pub use cache::ByteRangeCache;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum CogSource {
    Local(PathBuf),
    Remote(String),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RasterLayer {
    pub id: String,
    pub name: String,
    pub bands: HashMap<String, CogSource>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CogPresetInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub kind: String, // "multispectral" | "elevation"
    pub bands: Vec<String>,
    pub default_formula: String,
    pub center: [f64; 2],
    pub zoom: f64,
}

pub struct RasterRegistry {
    layers: RwLock<HashMap<String, RasterLayer>>,
    cache: Arc<ByteRangeCache>,
    client: reqwest::Client,
}

pub type SharedRasterRegistry = Arc<RasterRegistry>;

impl Default for RasterRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl RasterRegistry {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .pool_idle_timeout(Duration::from_secs(60))
            .timeout(Duration::from_secs(30))
            .user_agent("Strata/0.1.0 (Strict strata://cog)")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        // 128 MB cache, up to 4000 chunks
        let cache = Arc::new(ByteRangeCache::new(128 * 1024 * 1024, 4000));
        let registry = Self {
            layers: RwLock::new(HashMap::new()),
            cache,
            client,
        };

        registry.seed_presets();
        registry
    }

    fn seed_presets(&self) {
        // Preset 1: Copernicus Global DEM 30m around Mt. Rainier / Cascades
        let mut dem_bands = HashMap::new();
        dem_bands.insert(
            "elevation".to_string(),
            CogSource::Remote(
                "https://copernicus-dem-30m.s3.amazonaws.com/2019/Copernicus_DSM_COG_10_N46_00_W122_00_DEM.tif".to_string(),
            ),
        );
        self.register_layer(
            "copernicus_dem_rainier".to_string(),
            "Copernicus DEM 30m (Mt. Rainier)".to_string(),
            dem_bands,
        );

        // Preset 2: Sentinel-2 Multispectral Scene (Lake Tahoe, CA/NV)
        // AWS Earth Search open STAC COGs for Sentinel-2 L2A
        let base_s2 = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/10/S/FH/2023/8/S2A_10SFH_20230825_0_L2A";
        let mut s2_bands = HashMap::new();
        s2_bands.insert("B02".to_string(), CogSource::Remote(format!("{}/B02.tif", base_s2)));
        s2_bands.insert("B03".to_string(), CogSource::Remote(format!("{}/B03.tif", base_s2)));
        s2_bands.insert("B04".to_string(), CogSource::Remote(format!("{}/B04.tif", base_s2)));
        s2_bands.insert("B08".to_string(), CogSource::Remote(format!("{}/B08.tif", base_s2)));
        s2_bands.insert("B11".to_string(), CogSource::Remote(format!("{}/B11.tif", base_s2)));
        s2_bands.insert("B12".to_string(), CogSource::Remote(format!("{}/B12.tif", base_s2)));

        self.register_layer(
            "sentinel2_tahoe".to_string(),
            "Sentinel-2 L2A (Lake Tahoe & Sierra Nevada)".to_string(),
            s2_bands,
        );
    }

    pub fn register_layer(
        &self,
        id: String,
        name: String,
        bands: HashMap<String, CogSource>,
    ) {
        if let Ok(mut lock) = self.layers.write() {
            lock.insert(
                id.clone(),
                RasterLayer {
                    id,
                    name,
                    bands,
                },
            );
        }
    }

    pub fn get_layer(&self, id: &str) -> Option<RasterLayer> {
        self.layers.read().ok()?.get(id).cloned()
    }

    pub fn resolve_source(&self, layer_id: &str, band_id: &str) -> Option<CogSource> {
        let lock = self.layers.read().ok()?;
        let layer = lock.get(layer_id)?;
        layer.bands.get(band_id).cloned()
    }

    pub fn get_presets(&self) -> Vec<CogPresetInfo> {
        vec![
            CogPresetInfo {
                id: "sentinel2_tahoe".to_string(),
                name: "Sentinel-2 Multispectral (Lake Tahoe)".to_string(),
                description: "6-band Sentinel-2 L2A tile over Lake Tahoe and the Sierra Nevada. Real-time GPU NDVI, NDWI, NDBI, NBR, and CIR computation.".to_string(),
                kind: "multispectral".to_string(),
                bands: vec![
                    "B02".to_string(),
                    "B03".to_string(),
                    "B04".to_string(),
                    "B08".to_string(),
                    "B11".to_string(),
                    "B12".to_string(),
                ],
                default_formula: "NDVI".to_string(),
                center: [-120.0324, 39.0968],
                zoom: 10.5,
            },
            CogPresetInfo {
                id: "copernicus_dem_rainier".to_string(),
                name: "Copernicus DEM 30m (Mt. Rainier)".to_string(),
                description: "30-meter global elevation raster of Mount Rainier and the Pacific Northwest Cascades. Hypsometric relief shading.".to_string(),
                kind: "elevation".to_string(),
                bands: vec!["elevation".to_string()],
                default_formula: "Elevation".to_string(),
                center: [-121.7603, 46.8523],
                zoom: 10.0,
            },
        ]
    }

    pub fn read_local_range(
        &self,
        path: &Path,
        start: u64,
        end: u64,
    ) -> Result<(Vec<u8>, u64), String> {
        if start > end {
            return Err(format!("Invalid byte range: start {} > end {}", start, end));
        }

        let mut file = File::open(path)
            .map_err(|e| format!("Failed to open local file {}: {}", path.display(), e))?;

        let metadata = file
            .metadata()
            .map_err(|e| format!("Failed to read metadata for {}: {}", path.display(), e))?;
        let total_len = metadata.len();

        if total_len == 0 {
            return Err("Local file is empty".to_string());
        }

        if start >= total_len {
            return Err(format!(
                "Requested start byte {} exceeds total file size {}",
                start, total_len
            ));
        }

        let clamped_end = end.min(total_len.saturating_sub(1));
        if start > clamped_end {
            return Err(format!(
                "Requested start byte {} exceeds file extent {}",
                start, clamped_end
            ));
        }
        let count = (clamped_end - start + 1) as usize;

        file.seek(SeekFrom::Start(start))
            .map_err(|e| format!("Failed to seek to byte {}: {}", start, e))?;

        let mut buffer = vec![0u8; count];
        file.read_exact(&mut buffer)
            .map_err(|e| format!("Failed to read {} bytes: {}", count, e))?;

        Ok((buffer, total_len))
    }

    pub async fn fetch_remote_range(
        &self,
        url: &str,
        layer_id: &str,
        band_id: &str,
        start: u64,
        end: u64,
    ) -> Result<(Vec<u8>, u64), String> {
        // 1. Check Moka Cache
        if let Some((cached_data, total_len)) = self.cache.get(layer_id, band_id, start, end).await {
            return Ok((cached_data, total_len));
        }

        // 2. Fetch via reqwest with Range header
        let range_header = format!("bytes={}-{}", start, end);
        let resp = self
            .client
            .get(url)
            .header("Range", &range_header)
            .send()
            .await
            .map_err(|e| format!("Reqwest range fetch failed for {}: {}", url, e))?;

        let status = resp.status();
        if !status.is_success() && status.as_u16() != 206 {
            return Err(format!(
                "Remote server returned HTTP {} for range {}: {}",
                status, range_header, url
            ));
        }

        // Extract total length from Content-Range header if present: "bytes 0-1023/5000000"
        let mut total_len = 0u64;
        if let Some(cr_str) = resp
            .headers()
            .get("Content-Range")
            .and_then(|cr| cr.to_str().ok())
        {
            if let Some(slash_pos) = cr_str.rfind('/') {
                let total_str = cr_str[slash_pos + 1..].trim();
                if let Ok(parsed_total) = total_str.parse::<u64>() {
                    total_len = parsed_total;
                }
            }
        }

        let body_bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Failed to read response body from {}: {}", url, e))?
            .to_vec();

        if body_bytes.is_empty() {
            return Ok((Vec::new(), total_len));
        }

        // If server responded with 200 OK instead of 206, slice body to requested range
        let chunk = if status.as_u16() == 200 {
            if total_len == 0 {
                total_len = body_bytes.len() as u64;
            }
            let max_idx = body_bytes.len().saturating_sub(1);
            let clamped_end = (end as usize).min(max_idx);
            let s = (start as usize).min(clamped_end);
            body_bytes[s..=clamped_end].to_vec()
        } else {
            if total_len == 0 {
                total_len = start + body_bytes.len() as u64;
            }
            body_bytes
        };

        // Cache the chunk in our Moka cache
        self.cache
            .put(
                layer_id.to_string(),
                band_id.to_string(),
                start,
                end,
                chunk.clone(),
                total_len,
            )
            .await;

        Ok((chunk, total_len))
    }

    pub fn cache(&self) -> &Arc<ByteRangeCache> {
        &self.cache
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_read_local_range() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("strata_test_cog_slice.bin");
        {
            let mut f = File::create(&file_path).unwrap();
            f.write_all(b"0123456789ABCDEF").unwrap();
        }

        let registry = RasterRegistry::new();
        let (slice, total) = registry.read_local_range(&file_path, 2, 6).unwrap();
        assert_eq!(total, 16);
        assert_eq!(slice, b"23456");

        let _ = std::fs::remove_file(file_path);
    }

    #[test]
    fn test_presets_initialized() {
        let registry = RasterRegistry::new();
        let presets = registry.get_presets();
        assert_eq!(presets.len(), 2);
        assert!(registry.resolve_source("sentinel2_tahoe", "B04").is_some());
        assert!(registry.resolve_source("copernicus_dem_rainier", "elevation").is_some());
    }
}
