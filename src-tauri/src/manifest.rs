use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub path: String,
    #[serde(default)]
    pub objects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetStyle {
    pub geometry_type: String,
    #[serde(default)]
    pub point_color: Option<String>,
    #[serde(default)]
    pub stroke_color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub cluster_below_zoom: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetManifestEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub license: String,
    pub attribution: String,
    #[serde(default)]
    pub requires_api_key: bool,
    #[serde(default = "default_min_zoom")]
    pub min_zoom: u32,
    #[serde(default = "default_crs")]
    pub default_crs: String,
    pub source: DatasetSource,
    pub style: DatasetStyle,
}

fn default_min_zoom() -> u32 {
    2
}

fn default_crs() -> String {
    "EPSG:4326".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(rename = "dataset")]
    pub datasets: Vec<DatasetManifestEntry>,
}

impl Manifest {
    pub fn load_embedded() -> Result<Self, String> {
        let content = include_str!("../datasets.toml");
        toml::from_str(content).map_err(|e| format!("Failed to parse datasets.toml: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_embedded_manifest() {
        let manifest = Manifest::load_embedded().expect("datasets.toml must parse successfully");
        assert!(!manifest.datasets.is_empty());
        let cctv = manifest.datasets.iter().find(|d| d.id == "cctv_cameras");
        assert!(cctv.is_some());
    }
}
