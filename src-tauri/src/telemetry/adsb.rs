use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlightTarget {
    pub icao24: String,
    pub callsign: String,
    pub origin_country: String,
    pub lon: f64,
    pub lat: f64,
    pub altitude_m: Option<f64>,
    pub velocity_mps: Option<f64>,
    pub heading_deg: Option<f64>,
    pub vertical_rate_mps: Option<f64>,
    pub on_ground: bool,
    pub last_contact_epoch: i64,
    pub simulated: bool,
}

fn http_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let built = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent("Strata-GIS/0.1.0")
        .build()
        .map_err(|e| e.to_string())?;
    Ok(CLIENT.get_or_init(|| built))
}

fn warn_once(msg: &str) {
    static WARNED: AtomicBool = AtomicBool::new(false);
    if !WARNED.swap(true, Ordering::Relaxed) {
        eprintln!(
            "OpenSky ADS-B warning ({}), using synthetic corridor fallback",
            msg
        );
    }
}

#[derive(Debug, Deserialize)]
struct OpenSkyTokenResponse {
    access_token: String,
    expires_in: u64,
}

static TOKEN_CACHE: OnceLock<tokio::sync::RwLock<Option<(String, std::time::Instant)>>> = OnceLock::new();

fn token_cache() -> &'static tokio::sync::RwLock<Option<(String, std::time::Instant)>> {
    TOKEN_CACHE.get_or_init(|| tokio::sync::RwLock::new(None))
}

pub async fn get_opensky_auth_token(client: &reqwest::Client) -> Option<String> {
    let client_id = std::env::var("OPENSKY_CLIENT_ID").ok()?;
    let client_secret = std::env::var("OPENSKY_CLIENT_SECRET").ok()?;
    let cid = client_id.trim();
    let csec = client_secret.trim();

    if cid.is_empty() || csec.is_empty() {
        return None;
    }

    // Check cached token
    {
        let guard = token_cache().read().await;
        if let Some((ref tok, expiry)) = *guard {
            if std::time::Instant::now() < expiry {
                return Some(tok.clone());
            }
        }
    }

    // Request new token
    let params = [
        ("grant_type", "client_credentials"),
        ("client_id", cid),
        ("client_secret", csec),
    ];

    let resp = client
        .post("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token")
        .form(&params)
        .send()
        .await
        .ok()?;

    if resp.status().is_success() {
        if let Ok(data) = resp.json::<OpenSkyTokenResponse>().await {
            let expiry = std::time::Instant::now() + Duration::from_secs(data.expires_in.saturating_sub(60));
            let mut guard = token_cache().write().await;
            *guard = Some((data.access_token.clone(), expiry));
            return Some(data.access_token);
        }
    }

    None
}

pub async fn fetch_live_flights(
    bbox: Option<(f64, f64, f64, f64)>,
) -> Result<Vec<FlightTarget>, String> {
    let client = http_client()?;

    let mut url = "https://opensky-network.org/api/states/all".to_string();
    if let Some((min_lon, min_lat, max_lon, max_lat)) = bbox {
        let lomin = min_lon.clamp(-180.0, 180.0);
        let lamin = min_lat.clamp(-90.0, 90.0);
        let lomax = max_lon.clamp(-180.0, 180.0);
        let lamax = max_lat.clamp(-90.0, 90.0);

        if lomin <= lomax && lamin <= lamax {
            url = format!(
                "{}?lomin={}&lamin={}&lomax={}&lamax={}",
                url, lomin, lamin, lomax, lamax
            );
        }
    }

    let mut request_builder = client.get(&url);
    if let Some(token) = get_opensky_auth_token(client).await {
        request_builder = request_builder.bearer_auth(token);
    }

    match request_builder.send().await {
        Ok(resp) => {
            if !resp.status().is_success() {
                warn_once(&format!("HTTP {}", resp.status()));
                return Ok(generate_corridor_flights(bbox));
            }

            match resp.json::<Value>().await {
                Ok(json) => {
                    // OpenSky returns {"time": ..., "states": null} when a valid bbox is empty
                    let Some(states_val) = json.get("states") else {
                        warn_once("Malformed OpenSky response: missing 'states' key");
                        return Ok(generate_corridor_flights(bbox));
                    };

                    if states_val.is_null() {
                        return Ok(Vec::new());
                    }

                    if let Some(states) = states_val.as_array() {
                        let mut targets = Vec::with_capacity(states.len());
                        for s in states {
                            if let Some(arr) = s.as_array() {
                                if arr.len() >= 12 {
                                    let (Some(lon), Some(lat)) = (arr[5].as_f64(), arr[6].as_f64())
                                    else {
                                        continue;
                                    };

                                    let icao = arr[0].as_str().unwrap_or("").to_string();
                                    let callsign = arr[1].as_str().unwrap_or("").trim();
                                    let country = arr[2].as_str().unwrap_or("").to_string();
                                    let last_contact = arr[4].as_i64().unwrap_or(0);
                                    // Prefer baro_altitude (7), fallback to geo_altitude (13)
                                    let altitude = arr[7]
                                        .as_f64()
                                        .or_else(|| arr.get(13).and_then(|v| v.as_f64()));
                                    let on_ground = arr[8].as_bool().unwrap_or(false);
                                    let velocity = arr[9].as_f64();
                                    let heading = arr[10].as_f64();
                                    let v_rate = arr[11].as_f64();

                                    targets.push(FlightTarget {
                                        icao24: icao,
                                        callsign: if callsign.is_empty() {
                                            "UNKNOWN".to_string()
                                        } else {
                                            callsign.to_string()
                                        },
                                        origin_country: country,
                                        lon,
                                        lat,
                                        altitude_m: altitude,
                                        velocity_mps: velocity,
                                        heading_deg: heading,
                                        vertical_rate_mps: v_rate,
                                        on_ground,
                                        last_contact_epoch: last_contact,
                                        simulated: false,
                                    });
                                }
                            }
                        }
                        return Ok(targets);
                    }
                }
                Err(err) => warn_once(&format!("JSON parse error: {}", err)),
            }
        }
        Err(err) => warn_once(&err.to_string()),
    }

    Ok(generate_corridor_flights(bbox))
}

/// Wraps longitude into [-180.0, 180.0]
fn wrap_lon(lon: f64) -> f64 {
    ((lon + 180.0).rem_euclid(360.0)) - 180.0
}

/// Calculates initial true bearing (0..360 deg) between two lat/lon points
fn initial_bearing_deg(lat1_deg: f64, lon1_deg: f64, lat2_deg: f64, lon2_deg: f64) -> f64 {
    let lat1 = lat1_deg.to_radians();
    let lat2 = lat2_deg.to_radians();
    let d_lon = (lon2_deg - lon1_deg).to_radians();

    let y = d_lon.sin() * lat2.cos();
    let x = lat1.cos() * lat2.sin() - lat1.sin() * lat2.cos() * d_lon.cos();
    (y.atan2(x).to_degrees() + 360.0) % 360.0
}

fn generate_corridor_flights(bbox: Option<(f64, f64, f64, f64)>) -> Vec<FlightTarget> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let now_sec = (now_ms as f64) / 1000.0;

    let corridors = [
        (
            "4840e4",
            "KLM685",
            "Netherlands",
            4.76,
            52.31,
            -73.78,
            40.64,
            10600.0,
            240.0,
        ),
        (
            "a12b34",
            "UAL100",
            "United States",
            -73.78,
            40.64,
            -0.45,
            51.47,
            11200.0,
            255.0,
        ),
        (
            "3c65c2", "DLH400", "Germany", 8.57, 50.03, -73.78, 40.64, 10900.0, 245.0,
        ),
        (
            "896172", "ANA008", "Japan", 139.78, 35.55, -122.37, 37.62, 11800.0, 260.0,
        ),
        (
            "7809a1", "CSN327", "China", 113.30, 23.39, -118.41, 33.94, 11500.0, 250.0,
        ),
        (
            "06a0df",
            "QFA011",
            "Australia",
            151.18,
            -33.95,
            -118.41,
            33.94,
            12000.0,
            258.0,
        ),
        (
            "400a12",
            "BAW178",
            "United Kingdom",
            -73.78,
            40.64,
            -0.45,
            51.47,
            10800.0,
            242.0,
        ),
        (
            "8001fa", "AIC101", "India", 77.10, 28.56, -73.78, 40.64, 11400.0, 248.0,
        ),
        (
            "c051a2", "ACA850", "Canada", -79.62, 43.68, -0.45, 51.47, 10700.0, 245.0,
        ),
        (
            "7c6d12",
            "JST201",
            "Australia",
            144.84,
            -37.67,
            151.18,
            -33.95,
            8500.0,
            210.0,
        ),
        (
            "e08812", "TAM8070", "Brazil", -46.47, -23.43, 8.57, 50.03, 11600.0, 252.0,
        ),
        (
            "020084", "RAM202", "Morocco", -7.58, 33.36, -73.78, 40.64, 11000.0, 246.0,
        ),
    ];

    let mut flights = Vec::with_capacity(corridors.len());
    // Realistic 8-hour (28,800s) cycle instead of 20-minute teleportation
    let cycle_duration_sec = 28_800.0;

    for (i, &(icao, callsign, country, x1, y1, x2, y2, alt, speed)) in corridors.iter().enumerate()
    {
        let phase_offset = (i as f64) / (corridors.len() as f64);
        let progress = ((now_sec / cycle_duration_sec) + phase_offset).rem_euclid(1.0);

        // Shortest-path longitude delta across the ±180 antimeridian
        let mut d_lon = x2 - x1;
        if d_lon > 180.0 {
            d_lon -= 360.0;
        } else if d_lon < -180.0 {
            d_lon += 360.0;
        }

        let lon = wrap_lon(x1 + d_lon * progress);
        let lat = y1 + (y2 - y1) * progress;
        let heading = initial_bearing_deg(lat, lon, y2, x2);

        if let Some((min_lon, min_lat, max_lon, max_lat)) = bbox {
            if lon < min_lon || lon > max_lon || lat < min_lat || lat > max_lat {
                continue;
            }
        }

        flights.push(FlightTarget {
            icao24: icao.to_string(),
            callsign: callsign.to_string(),
            origin_country: country.to_string(),
            lon: (lon * 10000.0).round() / 10000.0,
            lat: (lat * 10000.0).round() / 10000.0,
            altitude_m: Some(alt),
            velocity_mps: Some(speed),
            heading_deg: Some((heading * 10.0).round() / 10.0),
            vertical_rate_mps: Some(0.0),
            on_ground: false,
            last_contact_epoch: now_ms / 1000,
            simulated: true,
        });
    }

    flights
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_corridor_flights_generation() {
        let flights = generate_corridor_flights(None);
        assert!(!flights.is_empty(), "Should generate corridor flight targets");
        let first = &flights[0];
        assert!(!first.callsign.is_empty());
        assert!(first.lon >= -180.0 && first.lon <= 180.0);
        assert!(first.lat >= -90.0 && first.lat <= 90.0);
    }
}
