use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::RwLock;

// ─────────────────────────────────────────────────────────────────────────────
// ADS-B / OpenSky Data Model
// ─────────────────────────────────────────────────────────────────────────────
// Existing crates evaluated (2026-10):
//   - `opensky-network` (crates.io): Thin REST wrapper, no built-in OAuth2
//     client-credentials flow, no adaptive TTL / credit governor, no caching.
//   - `opensky` (crates.io): Focused on historical Trino DB queries with
//     Polars DataFrames — wrong abstraction for real-time state vectors.
// Verdict: Our hand-rolled reqwest impl gives full control over OAuth2 token
// lifecycle, adaptive polling, serve-stale cache, and credit governor — all
// patterns proven in gods-eye-view's production Node.js proxy. No crate
// provides this level of resilience out of the box.
// ─────────────────────────────────────────────────────────────────────────────

/// Complete ADS-B flight target with all OpenSky extended=1 state vector fields.
///
/// Field mapping follows ICAO Annex 10 / DO-260B standards:
///   Index 0:  icao24           Index 9:  velocity (m/s ground speed)
///   Index 1:  callsign         Index 10: true_track (heading deg)
///   Index 2:  origin_country   Index 11: vertical_rate (m/s)
///   Index 3:  time_position    Index 12: sensors (ignored)
///   Index 4:  last_contact     Index 13: geo_altitude (m)
///   Index 5:  longitude        Index 14: squawk
///   Index 6:  latitude         Index 15: spi (special purpose indicator)
///   Index 7:  baro_altitude    Index 16: position_source (0=ADS-B, 1=ASTERIX, 2=MLAT, 3=FLARM)
///   Index 8:  on_ground        Index 17: category (emitter category, extended=1 only)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlightTarget {
    pub icao24: String,
    pub callsign: String,
    pub origin_country: String,
    pub lon: f64,
    pub lat: f64,
    pub altitude_m: Option<f64>,
    /// Geometric (GNSS) altitude in meters — more accurate than barometric
    /// for weather-independent altitude display.
    pub geo_altitude_m: Option<f64>,
    pub velocity_mps: Option<f64>,
    pub heading_deg: Option<f64>,
    pub vertical_rate_mps: Option<f64>,
    pub on_ground: bool,
    pub last_contact_epoch: i64,
    /// Unix timestamp of the last position report from the transponder.
    pub position_time_epoch: Option<i64>,
    pub simulated: bool,
    /// 4-digit octal transponder code (e.g. "7700" for emergency).
    pub squawk: Option<String>,
    /// Special Purpose Indicator — pilot pressed "Ident" for ATC.
    pub spi: bool,
    /// Position source: 0=ADS-B, 1=ASTERIX, 2=MLAT, 3=FLARM.
    pub position_source: u8,
    /// ICAO DO-260B emitter category (0-18). See `emitter_category_label()`.
    pub category: u8,
    /// Human-readable emergency status derived from squawk code.
    pub emergency: Option<String>,
}

/// Maps the ICAO DO-260B emitter category code to a human-readable label.
pub fn emitter_category_label(code: u8) -> &'static str {
    match code {
        0 => "Unknown",
        1 => "No Category Info",
        2 => "Light (< 15,500 lbs)",
        3 => "Small (15,500–75,000 lbs)",
        4 => "Large (75,000–300,000 lbs)",
        5 => "High Vortex Large (B757)",
        6 => "Heavy (> 300,000 lbs)",
        7 => "High Performance (> 5g, > 400 kts)",
        8 => "Rotorcraft",
        9 => "Glider / Sailplane",
        10 => "Lighter-than-Air",
        11 => "Parachutist / Skydiver",
        12 => "Ultralight / Hang Glider",
        13 => "Reserved",
        14 => "UAV / Drone",
        15 => "Space / Transatmospheric",
        16 => "Surface Emergency Vehicle",
        17 => "Surface Service Vehicle",
        18 => "Point Obstacle",
        _ => "Unknown",
    }
}

/// Decodes a squawk code into an emergency status string, if applicable.
fn decode_squawk_emergency(squawk: &str) -> Option<String> {
    match squawk.trim() {
        "7500" => Some("HIJACK".to_string()),
        "7600" => Some("RADIO FAILURE".to_string()),
        "7700" => Some("EMERGENCY".to_string()),
        "7777" => Some("MILITARY INTERCEPT".to_string()),
        _ => None,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Client & Warning Infrastructure
// ─────────────────────────────────────────────────────────────────────────────

fn http_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let built = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(8))
        .user_agent("Strata-GIS/0.1.0 (Desktop GIS; https://github.com/strata-gis)")
        .build()
        .map_err(|e| e.to_string())?;
    Ok(CLIENT.get_or_init(|| built))
}

fn warn_once(msg: &str) {
    static WARNED: AtomicBool = AtomicBool::new(false);
    if !WARNED.swap(true, Ordering::Relaxed) {
        eprintln!(
            "[OpenSky ADS-B] Warning ({}), using synthetic corridor fallback",
            msg
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth2 Client Credentials Flow
// ─────────────────────────────────────────────────────────────────────────────
// OpenSky retired Basic Auth (username/password) on 2026-03-18.
// The only supported authentication method is OAuth2 client_credentials.
// Token endpoint: https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token
// Tokens expire in ~1800s (30 min); we refresh 60s early.

#[derive(Debug, Deserialize)]
struct OpenSkyTokenResponse {
    access_token: String,
    expires_in: u64,
}

static TOKEN_CACHE: OnceLock<RwLock<Option<(String, std::time::Instant)>>> = OnceLock::new();

fn token_cache() -> &'static RwLock<Option<(String, std::time::Instant)>> {
    TOKEN_CACHE.get_or_init(|| RwLock::new(None))
}

pub async fn get_opensky_auth_token(client: &reqwest::Client) -> Option<String> {
    let client_id = std::env::var("OPENSKY_CLIENT_ID").ok()?;
    let client_secret = std::env::var("OPENSKY_CLIENT_SECRET").ok()?;
    let cid = client_id.trim();
    let csec = client_secret.trim();

    if cid.is_empty() || csec.is_empty() {
        return None;
    }

    // Check cached token (with 60s safety margin)
    {
        let guard = token_cache().read().await;
        if let Some((ref tok, expiry)) = *guard {
            if std::time::Instant::now() < expiry {
                return Some(tok.clone());
            }
        }
    }

    // Request new token via OAuth2 client_credentials grant
    let params = [
        ("grant_type", "client_credentials"),
        ("client_id", cid),
        ("client_secret", csec),
    ];

    let resp = client
        .post("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token")
        .form(&params)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .ok()?;

    if resp.status().is_success() {
        if let Ok(data) = resp.json::<OpenSkyTokenResponse>().await {
            // Default to 1800s if expires_in is missing/non-finite, minus 60s safety margin
            let ttl_secs = if data.expires_in > 60 {
                data.expires_in - 60
            } else {
                data.expires_in
            };
            let expiry = std::time::Instant::now() + Duration::from_secs(ttl_secs);
            let mut guard = token_cache().write().await;
            *guard = Some((data.access_token.clone(), expiry));
            return Some(data.access_token);
        }
    }

    None
}

// ─────────────────────────────────────────────────────────────────────────────
// Serve-Stale Response Cache
// ─────────────────────────────────────────────────────────────────────────────
// Mirrors gods-eye-view's proven pattern: when OpenSky returns 429 (rate
// limited), 5xx (upstream error), or network timeout, we serve the last
// successful response instead of falling back to synthetic data. The layer
// keeps rendering (marked stale) instead of dying.

struct CachedSnapshot {
    flights: Vec<FlightTarget>,
    cached_at: std::time::Instant,
    /// Remaining credits from last successful response's X-Rate-Limit-Remaining header.
    credits_remaining: Option<u32>,
}

static RESPONSE_CACHE: OnceLock<RwLock<Option<CachedSnapshot>>> = OnceLock::new();

fn response_cache() -> &'static RwLock<Option<CachedSnapshot>> {
    RESPONSE_CACHE.get_or_init(|| RwLock::new(None))
}

/// Adaptive TTL based on remaining daily credit budget.
/// OpenSky credit tiers per /states/all call:
///   ≤25 deg²: 1 credit | 25-100 deg²: 2 credits | 100-400 deg²: 3 credits | >400 deg² / global: 4 credits
/// Registered users get 4,000 credits/day. Active feeders get 8,000.
static ADAPTIVE_TTL_MS: OnceLock<tokio::sync::RwLock<u64>> = OnceLock::new();

fn adaptive_ttl() -> &'static tokio::sync::RwLock<u64> {
    ADAPTIVE_TTL_MS.get_or_init(|| tokio::sync::RwLock::new(9_000)) // Base: 9 seconds
}

/// Compute adaptive TTL from remaining credit budget.
/// As credits drop, we slow down polling to stretch the budget across the day.
fn compute_adaptive_ttl_ms(remaining: Option<u32>) -> u64 {
    match remaining {
        Some(r) if r > 2000 => 9_000,      // >2000 credits: poll every 9s (base)
        Some(r) if r > 1000 => 15_000,     // 1000-2000: every 15s
        Some(r) if r > 500 => 30_000,      // 500-1000: every 30s
        Some(r) if r > 100 => 60_000,      // 100-500: every 60s
        Some(_) => 120_000,                 // <100: every 2 min (conservation mode)
        None => 9_000,                      // Unknown (anonymous): base rate
    }
}

/// Returns the remaining OpenSky API credits from the last successful response, if any.
pub async fn get_cached_credits() -> Option<u32> {
    let cache = response_cache().read().await;
    cache.as_ref().and_then(|c| c.credits_remaining)
}

/// Returns the current adaptive polling TTL in milliseconds.
pub async fn get_current_ttl_ms() -> u64 {
    *adaptive_ttl().read().await
}

/// 429 cooldown state — epoch ms when we can next attempt an upstream request.
static COOLDOWN_UNTIL: OnceLock<tokio::sync::RwLock<u64>> = OnceLock::new();

fn cooldown_until() -> &'static tokio::sync::RwLock<u64> {
    COOLDOWN_UNTIL.get_or_init(|| tokio::sync::RwLock::new(0))
}

fn now_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Fetch: OpenSky /states/all?extended=1
// ─────────────────────────────────────────────────────────────────────────────

pub async fn fetch_live_flights(
    bbox: Option<(f64, f64, f64, f64)>,
) -> Result<Vec<FlightTarget>, String> {
    let client = http_client()?;

    // 1. Check 429 cooldown — don't even attempt upstream if cooling down
    {
        let cd = cooldown_until().read().await;
        if now_epoch_ms() < *cd {
            // Serve from cache if available
            let cache = response_cache().read().await;
            if let Some(ref snap) = *cache {
                return Ok(snap.flights.clone());
            }
            // No cache during cooldown — fall back to synthetic
            return Ok(generate_corridor_flights(bbox));
        }
    }

    // 2. Check adaptive TTL — serve from cache if still fresh
    {
        let cache = response_cache().read().await;
        if let Some(ref snap) = *cache {
            let ttl_ms = *adaptive_ttl().read().await;
            let age_ms = snap.cached_at.elapsed().as_millis() as u64;
            if age_ms < ttl_ms {
                return Ok(snap.flights.clone());
            }
        }
    }

    // 3. Build URL with extended=1 for full 18-field state vectors
    let mut url = "https://opensky-network.org/api/states/all?extended=1".to_string();
    if let Some((min_lon, min_lat, max_lon, max_lat)) = bbox {
        let lomin = min_lon.clamp(-180.0, 180.0);
        let lamin = min_lat.clamp(-90.0, 90.0);
        let lomax = max_lon.clamp(-180.0, 180.0);
        let lamax = max_lat.clamp(-90.0, 90.0);

        if lomin <= lomax && lamin <= lamax {
            url = format!(
                "{}&lomin={}&lamin={}&lomax={}&lamax={}",
                url, lomin, lamin, lomax, lamax
            );
        }
    }

    // 4. Attach OAuth2 bearer token if credentials are configured
    let mut request_builder = client.get(&url);
    if let Some(token) = get_opensky_auth_token(client).await {
        request_builder = request_builder.bearer_auth(token);
    }

    // 5. Execute request with full error recovery
    match request_builder.send().await {
        Ok(resp) => {
            let status = resp.status();

            // 5a. Handle 429 rate limit — start cooldown, serve stale
            if status.as_u16() == 429 {
                // Parse retry-after header (clamped 30s–30min, default 120s)
                let retry_after_secs = resp
                    .headers()
                    .get("x-rate-limit-retry-after-seconds")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.trim().parse::<u64>().ok())
                    .map(|s| s.clamp(30, 1800))
                    .unwrap_or(120);

                {
                    let mut cd = cooldown_until().write().await;
                    *cd = now_epoch_ms() + retry_after_secs * 1000;
                }

                eprintln!(
                    "[OpenSky] Rate limited (429). Cooling down for {}s.",
                    retry_after_secs
                );

                // Serve stale cache if available
                let cache = response_cache().read().await;
                if let Some(ref snap) = *cache {
                    return Ok(snap.flights.clone());
                }
                return Ok(generate_corridor_flights(bbox));
            }

            // 5b. Handle 5xx upstream errors — serve stale
            if status.is_server_error() {
                eprintln!(
                    "[OpenSky] Upstream error (HTTP {}). Serving stale cache.",
                    status
                );
                let cache = response_cache().read().await;
                if let Some(ref snap) = *cache {
                    return Ok(snap.flights.clone());
                }
                return Ok(generate_corridor_flights(bbox));
            }

            // 5c. Handle 401/403 — auth failure
            if status.as_u16() == 401 || status.as_u16() == 403 {
                warn_once(&format!("Auth failure (HTTP {}). Check OPENSKY_CLIENT_ID/SECRET.", status));
                return Ok(generate_corridor_flights(bbox));
            }

            if !status.is_success() {
                warn_once(&format!("HTTP {}", status));
                return Ok(generate_corridor_flights(bbox));
            }

            // 5d. Extract credit-governor metadata from response headers
            let credits_remaining = resp
                .headers()
                .get("x-rate-limit-remaining")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.trim().parse::<u32>().ok());

            // Update adaptive TTL based on remaining credits
            if credits_remaining.is_some() {
                let new_ttl = compute_adaptive_ttl_ms(credits_remaining);
                let mut ttl = adaptive_ttl().write().await;
                *ttl = new_ttl;
            }

            // Clear cooldown on success
            {
                let mut cd = cooldown_until().write().await;
                *cd = 0;
            }

            // 6. Parse JSON response
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
                        let targets = parse_opensky_states(states);

                        // Update serve-stale cache with successful response
                        {
                            let mut cache = response_cache().write().await;
                            *cache = Some(CachedSnapshot {
                                flights: targets.clone(),
                                cached_at: std::time::Instant::now(),
                                credits_remaining,
                            });
                        }

                        return Ok(targets);
                    }
                }
                Err(err) => warn_once(&format!("JSON parse error: {}", err)),
            }
        }
        Err(err) => {
            // Activate circuit-breaker cooldown for 60 seconds on network error / connection timeout
            {
                let mut cd = cooldown_until().write().await;
                *cd = now_epoch_ms() + 60_000;
            }
            warn_once(&format!("Network error: {}. Cooling down for 60s, serving cache/fallback", err));
            // Serve stale cache on network timeout / connection failure
            let cache = response_cache().read().await;
            if let Some(ref snap) = *cache {
                return Ok(snap.flights.clone());
            }
        }
    }

    Ok(generate_corridor_flights(bbox))
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenSky State Vector Parser (extended=1, 18 fields)
// ─────────────────────────────────────────────────────────────────────────────

fn parse_opensky_states(states: &[Value]) -> Vec<FlightTarget> {
    let mut targets = Vec::with_capacity(states.len());

    for s in states {
        let Some(arr) = s.as_array() else { continue };

        // Require at least 12 fields (basic state vector)
        if arr.len() < 12 {
            continue;
        }

        // Fields 5 (longitude) and 6 (latitude) are required — skip unpositioned contacts
        let (Some(lon), Some(lat)) = (arr[5].as_f64(), arr[6].as_f64()) else {
            continue;
        };

        // Validate coordinate ranges
        if lat.abs() > 90.0 || lon.abs() > 180.0 {
            continue;
        }

        let icao = arr[0].as_str().unwrap_or("").trim().to_lowercase();
        if icao.is_empty() {
            continue;
        }

        let callsign = arr[1].as_str().unwrap_or("").trim();
        let country = arr[2].as_str().unwrap_or("").to_string();
        let position_time = arr[3].as_i64();
        let last_contact = arr[4].as_i64().unwrap_or(0);

        // Prefer barometric altitude (index 7), fallback to geometric (index 13)
        let baro_altitude = arr[7].as_f64();
        let geo_altitude = arr.get(13).and_then(|v| v.as_f64());
        let altitude = baro_altitude.or(geo_altitude);

        let on_ground = arr[8].as_bool().unwrap_or(false);
        let velocity = arr[9].as_f64();
        let heading = arr[10].as_f64();
        let v_rate = arr[11].as_f64();

        // Extended fields (indices 14-17, available with extended=1)
        let squawk = arr
            .get(14)
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let spi = arr
            .get(15)
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let position_source = arr
            .get(16)
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u8;

        let category = arr
            .get(17)
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u8;

        // Derive emergency status from squawk code
        let emergency = squawk
            .as_deref()
            .and_then(decode_squawk_emergency);

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
            geo_altitude_m: geo_altitude,
            velocity_mps: velocity,
            heading_deg: heading,
            vertical_rate_mps: v_rate,
            on_ground,
            last_contact_epoch: last_contact,
            position_time_epoch: position_time,
            simulated: false,
            squawk,
            spi,
            position_source,
            category,
            emergency,
        });
    }

    targets
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic Corridor Flights (Fallback)
// ─────────────────────────────────────────────────────────────────────────────

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
            geo_altitude_m: Some(alt),
            velocity_mps: Some(speed),
            heading_deg: Some((heading * 10.0).round() / 10.0),
            vertical_rate_mps: Some(0.0),
            on_ground: false,
            last_contact_epoch: now_ms / 1000,
            position_time_epoch: Some(now_ms / 1000),
            simulated: true,
            squawk: None,
            spi: false,
            position_source: 0,
            category: 4, // Large aircraft for corridor flights
            emergency: None,
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
        assert_eq!(first.simulated, true);
        assert_eq!(first.category, 4);
    }

    #[test]
    fn test_emitter_category_labels() {
        assert_eq!(emitter_category_label(0), "Unknown");
        assert_eq!(emitter_category_label(2), "Light (< 15,500 lbs)");
        assert_eq!(emitter_category_label(6), "Heavy (> 300,000 lbs)");
        assert_eq!(emitter_category_label(8), "Rotorcraft");
        assert_eq!(emitter_category_label(14), "UAV / Drone");
        assert_eq!(emitter_category_label(16), "Surface Emergency Vehicle");
        assert_eq!(emitter_category_label(255), "Unknown");
    }

    #[test]
    fn test_squawk_emergency_decoding() {
        assert_eq!(decode_squawk_emergency("7700"), Some("EMERGENCY".to_string()));
        assert_eq!(decode_squawk_emergency("7600"), Some("RADIO FAILURE".to_string()));
        assert_eq!(decode_squawk_emergency("7500"), Some("HIJACK".to_string()));
        assert_eq!(decode_squawk_emergency("7777"), Some("MILITARY INTERCEPT".to_string()));
        assert_eq!(decode_squawk_emergency("1200"), None);
        assert_eq!(decode_squawk_emergency("7000"), None);
        assert_eq!(decode_squawk_emergency(""), None);
    }

    #[test]
    fn test_adaptive_ttl() {
        assert_eq!(compute_adaptive_ttl_ms(Some(3000)), 9_000);
        assert_eq!(compute_adaptive_ttl_ms(Some(1500)), 15_000);
        assert_eq!(compute_adaptive_ttl_ms(Some(800)), 30_000);
        assert_eq!(compute_adaptive_ttl_ms(Some(200)), 60_000);
        assert_eq!(compute_adaptive_ttl_ms(Some(50)), 120_000);
        assert_eq!(compute_adaptive_ttl_ms(None), 9_000);
    }

    #[test]
    fn test_parse_opensky_states() {
        use serde_json::json;

        let states = vec![
            json!([
                "abc123", "UAL100  ", "United States",
                1698765432, 1698765435,
                -73.78, 40.64,
                10668.0, false,
                245.5, 285.0, 1.5,
                null, 10700.0,
                "7700", false, 0, 4
            ]),
            // Unpositioned contact — should be skipped
            json!([
                "def456", "BAW200  ", "United Kingdom",
                null, 1698765435,
                null, null,
                null, false,
                0.0, 0.0, 0.0,
                null, null,
                null, false, 0, 0
            ]),
        ];

        let targets = parse_opensky_states(&states);
        assert_eq!(targets.len(), 1);

        let t = &targets[0];
        assert_eq!(t.icao24, "abc123");
        assert_eq!(t.callsign, "UAL100");
        assert_eq!(t.origin_country, "United States");
        assert!((t.lon - (-73.78)).abs() < 0.001);
        assert!((t.lat - 40.64).abs() < 0.001);
        assert_eq!(t.altitude_m, Some(10668.0));
        assert_eq!(t.geo_altitude_m, Some(10700.0));
        assert_eq!(t.velocity_mps, Some(245.5));
        assert_eq!(t.heading_deg, Some(285.0));
        assert_eq!(t.vertical_rate_mps, Some(1.5));
        assert_eq!(t.on_ground, false);
        assert_eq!(t.squawk, Some("7700".to_string()));
        assert_eq!(t.emergency, Some("EMERGENCY".to_string()));
        assert_eq!(t.spi, false);
        assert_eq!(t.position_source, 0);
        assert_eq!(t.category, 4);
        assert_eq!(t.simulated, false);
        assert_eq!(t.position_time_epoch, Some(1698765432));
    }

    #[test]
    fn test_parse_opensky_states_minimal() {
        use serde_json::json;

        // State vector with only 12 fields (no extended fields)
        let states = vec![json!([
            "abc123", "UAL100  ", "US",
            null, 1698765435,
            -73.78, 40.64,
            10668.0, false,
            245.5, 285.0, 0.0
        ])];

        let targets = parse_opensky_states(&states);
        assert_eq!(targets.len(), 1);
        let t = &targets[0];
        assert_eq!(t.squawk, None);
        assert_eq!(t.category, 0);
        assert_eq!(t.emergency, None);
    }
}
