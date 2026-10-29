use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FireTarget {
    pub id: String,
    pub lon: f64,
    pub lat: f64,
    pub brightness_k: f64,
    pub frp_mw: f64,
    pub confidence: String,
    pub acq_date: String,
    pub acq_time: String,
    pub satellite: String,
    pub day_night: String,
}

fn http_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let built = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("Strata-GIS/0.1.0")
        .build()
        .map_err(|e| e.to_string())?;
    Ok(CLIENT.get_or_init(|| built))
}

pub async fn fetch_live_fires(
    bbox: Option<(f64, f64, f64, f64)>,
) -> Result<Vec<FireTarget>, String> {
    let map_key = std::env::var("FIRMS_MAP_KEY").unwrap_or_default();
    let map_key = map_key.trim();

    if map_key.is_empty() {
        return Ok(Vec::new());
    }

    let client = http_client()?;
    let url = if let Some((min_lon, min_lat, max_lon, max_lat)) = bbox {
        let lomin = min_lon.clamp(-180.0, 180.0);
        let lamin = min_lat.clamp(-90.0, 90.0);
        let lomax = max_lon.clamp(-180.0, 180.0);
        let lamax = max_lat.clamp(-90.0, 90.0);
        format!(
            "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{}/VIIRS_SNPP_NRT/{:.2},{:.2},{:.2},{:.2}/1",
            map_key, lomin, lamin, lomax, lamax
        )
    } else {
        // Global sample covering active fire zones
        format!(
            "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{}/VIIRS_SNPP_NRT/-130,20,-60,55/1",
            map_key
        )
    };

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("NASA FIRMS API error: HTTP {}", resp.status()));
    }

    let csv_text = resp.text().await.map_err(|e| e.to_string())?;
    let mut targets = Vec::new();

    // Format: latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
    for (idx, line) in csv_text.lines().enumerate() {
        if idx == 0 || line.trim().is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.split(',').collect();
        if cols.len() < 14 {
            continue;
        }

        let lat = cols[0].trim().parse::<f64>().unwrap_or(f64::NAN);
        let lon = cols[1].trim().parse::<f64>().unwrap_or(f64::NAN);
        if !lat.is_finite() || !lon.is_finite() {
            continue;
        }

        let bright_ti4 = cols[2].trim().parse::<f64>().unwrap_or(0.0);
        let acq_date = cols[5].trim().to_string();
        let acq_time = cols[6].trim().to_string();
        let satellite = cols[7].trim().to_string();
        let confidence = cols[9].trim().to_string();
        let frp = cols[12].trim().parse::<f64>().unwrap_or(0.0);
        let day_night = cols[13].trim().to_string();

        targets.push(FireTarget {
            id: format!("fire_{}_{}", idx, acq_time),
            lon,
            lat,
            brightness_k: bright_ti4,
            frp_mw: frp,
            confidence,
            acq_date,
            acq_time,
            satellite,
            day_night,
        });
    }

    Ok(targets)
}
