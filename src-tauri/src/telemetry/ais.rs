//! AIS vessel telemetry via the aisstream.io websocket feed.
//!
//! The previous hard-coded corridor sample fleet is gone. A live source is
//! wired in its place: a minimal RFC 6455 websocket client (built on the
//! rustls/Tokio stack already in the dependency graph) subscribes to
//! `wss://stream.aisstream.io/v0/stream` with a bounding box covering the
//! globe and consumes position reports plus static voyage messages into a
//! process-lifetime vessel registry. `fetch_live_vessels` snapshots that
//! registry — filtered by bbox and recency — but never invents contacts.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::RwLock;
use tokio_rustls::client::TlsStream;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::rustls::RootCertStore;
use tokio_rustls::TlsConnector;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VesselTarget {
    pub mmsi: u32,
    pub name: String,
    pub callsign: String,
    pub ship_type: String,
    pub lon: f64,
    pub lat: f64,
    pub speed_knots: f64,
    pub course_deg: f64,
    pub heading_deg: Option<f64>,
    pub destination: String,
    pub status: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry: everything the stream has told us, keyed by MMSI
// ─────────────────────────────────────────────────────────────────────────────

/// Positions may arrive before the vessel's static voyage data and vice versa,
/// so both halves merge into one record: `f64::NAN` marks "no fix yet".
#[derive(Debug, Clone)]
struct VesselRecord {
    mmsi: u32,
    /// Static messages only (no fix observed): true until a position lands.
    name: String,
    callsign: String,
    ship_type: String,
    destination: String,
    lon: f64,
    lat: f64,
    speed_knots: f64,
    course_deg: f64,
    heading_deg: Option<f64>,
    status: String,
    /// Process-local epoch ms of the last position update, not AIS time.
    last_seen_ms: u64,
}

const POSITION_TTL_MS: u128 = 30 * 60 * 1000; // Keep a fix for 30 minutes.
const REGISTRY_CAP: usize = 120_000;
static REGISTRY: OnceLock<RwLock<HashMap<u32, VesselRecord>>> = OnceLock::new();
static STREAM_STARTED: AtomicBool = AtomicBool::new(false);

fn registry() -> &'static RwLock<HashMap<u32, VesselRecord>> {
    REGISTRY.get_or_init(|| RwLock::new(HashMap::new()))
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn aisstream_api_key() -> Option<String> {
    static LOAD_ENV: std::sync::Once = std::sync::Once::new();
    LOAD_ENV.call_once(|| {
        let _ = dotenvy::dotenv();
        let _ = dotenvy::from_path("../.env");
        let _ = dotenvy::from_path(".env");
    });
    let key = std::env::var("AISSTREAM_API_KEY").ok()?;
    let trimmed = key.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Live vessel positions from the AISStream registry, filtered by bbox and
/// recency. Spawns the (long-lived) websocket stream on first call; until the
/// first reports land this returns an empty set rather than inventing data.
pub async fn fetch_live_vessels(
    bbox: Option<(f64, f64, f64, f64)>,
) -> Result<Vec<VesselTarget>, String> {
    let has_key = aisstream_api_key().is_some();
    if has_key {
        ensure_stream_started();
    }

    let cutoff = now_ms().saturating_sub(POSITION_TTL_MS);
    let map = registry().read().await;
    if !has_key && map.is_empty() {
        return Ok(Vec::new()); // No key configured and no existing cached records.
    }

    let mut targets = Vec::with_capacity(map.len().min(2048));

    for record in map.values() {
        if record.lon.is_nan() || record.lat.is_nan() {
            continue; // Static data only; no position report seen yet.
        }
        if u128::from(record.last_seen_ms) < cutoff {
            continue; // Stale fix; keep reading instead of trusting it.
        }
        if let Some((min_lon, min_lat, max_lon, max_lat)) = bbox {
            if record.lon < min_lon
                || record.lon > max_lon
                || record.lat < min_lat
                || record.lat > max_lat
            {
                continue;
            }
        }

        targets.push(VesselTarget {
            mmsi: record.mmsi,
            name: if record.name.is_empty() {
                format!("MMSI {}", record.mmsi)
            } else {
                record.name.clone()
            },
            callsign: record.callsign.clone(),
            ship_type: if record.ship_type.is_empty() {
                "Vessel".to_string()
            } else {
                record.ship_type.clone()
            },
            lon: record.lon,
            lat: record.lat,
            speed_knots: record.speed_knots.max(0.0),
            course_deg: record.course_deg.max(0.0),
            heading_deg: record.heading_deg,
            destination: record.destination.clone(),
            status: if record.status.is_empty() {
                "Unknown".to_string()
            } else {
                record.status.clone()
            },
        });
    }

    Ok(targets)
}

fn ensure_stream_started() {
    if STREAM_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    // Detached task: the registry outlives any single connection.
    let _ = tokio::spawn(stream_task());
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection lifecycle with exponential backoff reconnects
// ─────────────────────────────────────────────────────────────────────────────

const WS_HOST: &str = "stream.aisstream.io";
const WS_PORT: u16 = 443;
const WS_PATH: &str = "/v0/stream";
const STALL_TIMEOUT: Duration = Duration::from_secs(180);

async fn stream_task() {
    let mut backoff_secs: u64 = 5;
    let mut logged_first_failure = false;
    loop {
        if aisstream_api_key().is_none() {
            return; // Key revoked — stop hammering the service.
        }
        match stream_session().await {
            Ok(()) => {
                eprintln!("[AISStream] Server closed the stream; reconnecting.");
            }
            Err(err) => {
                // Log every failure code once per distinct retry ladder so the
                // console does not fill with frantic repeats.
                if !logged_first_failure {
                    logged_first_failure = true;
                    eprintln!("[AISStream] Connection error (reconnecting with backoff): {}", err);
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(backoff_secs)).await;
        backoff_secs = (backoff_secs * 2).min(120);
    }
}

async fn stream_session() -> Result<(), String> {
    let key = aisstream_api_key().ok_or("no AISSTREAM_API_KEY configured")?;

    // ── TCP + TLS ──
    let tcp = TcpStream::connect((WS_HOST, WS_PORT))
        .await
        .map_err(|e| format!("tcp connect: {}", e))?;
    tcp.set_nodelay(true).ok();

    let mut root_store = RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls_config = rustls::ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    let connector = TlsConnector::from(Arc::new(tls_config));
    let server_name =
        ServerName::try_from(WS_HOST.to_string()).map_err(|e| format!("server name: {}", e))?;
    let mut tls: TlsStream<TcpStream> = connector
        .connect(server_name, tcp)
        .await
        .map_err(|e| format!("tls: {}", e))?;

    // ── RFC 6455 handshake ──
    let sec_key = base64_websocket_key();
    let request = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\
         Sec-WebSocket-Key: {}\r\nSec-WebSocket-Version: 13\r\n\r\n",
        WS_PATH, WS_HOST, sec_key
    );
    tls.write_all(request.as_bytes())
        .await
        .map_err(|e| format!("handshake write: {}", e))?;
    await_handshake_response(&mut tls).await?;

    // ── Subscribe (within the 3-second window) ──
    let subscription = serde_json::json!({
        "APIKey": key,
        // Bounding boxes are (lat, lon) corner pairs; the whole globe.
        "BoundingBoxes": [[[-90.0, -180.0], [90.0, 180.0]]],
        "FilterMessageTypes": ["PositionReport", "ShipStaticData", "StaticDataReport"],
    });
    write_ws_frame(&mut tls, 0x1, subscription.to_string().as_bytes()).await?;

    eprintln!("[AISStream] Subscribed to global feed (PositionReport + static).");

    // ── Read loop with stall watchdog ──
    let mut acc: Vec<u8> = Vec::new(); // Fragmented message payload accumulator.
    let mut frag_opcode: u8 = 0;

    loop {
        let frame_result = tokio::time::timeout(STALL_TIMEOUT, read_ws_frame(&mut tls)).await;
        let (fin, opcode, payload) = match frame_result {
            Ok(Ok(frame)) => frame,
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err(format!("no data for {}s; reconnecting", STALL_TIMEOUT.as_secs())),
        };

        match opcode {
            // Ping → respond with an identical masked pong.
            0x9 => {
                let _ = write_ws_frame(&mut tls, 0xA, &payload).await;
            }
            // Pong: ignore. Close: server is done with us.
            0xA => {}
            0x8 => return Ok(()),
            0x0 | 0x1 | 0x2 => {
                if opcode != 0x0 && fin {
                    // Most messages arrive as a single unfragmented frame.
                    handle_stream_payload(&payload).await;
                    continue;
                }
                // Fragmented sequence: start or continue accumulation.
                if opcode != 0x0 {
                    frag_opcode = opcode;
                    acc.clear();
                }
                acc.extend_from_slice(&payload);
                if fin {
                    let opcode_consumed = frag_opcode;
                    frag_opcode = 0;
                    let data = std::mem::take(&mut acc);
                    if opcode_consumed == 0x1 || opcode_consumed == 0x2 {
                        handle_stream_payload(&data).await;
                    }
                }
            }
            _ => {} // Reserved/unknown opcodes: skip.
        }
    }
}

/** Blocks until the HTTP 101 response terminator has arrived without consuming subsequent frames. */
async fn await_handshake_response(tls: &mut TlsStream<TcpStream>) -> Result<(), String> {
    let mut buf: Vec<u8> = Vec::with_capacity(512);
    let mut byte = [0u8; 1];
    loop {
        if buf.len() > 16 * 1024 {
            return Err("handshake response exceeds 16KiB".to_string());
        }
        let fut = tls.read_exact(&mut byte);
        tokio::time::timeout(Duration::from_secs(10), fut)
            .await
            .map_err(|_| "handshake timed out".to_string())?
            .map_err(|e| format!("handshake read: {}", e))?;
        buf.push(byte[0]);
        if buf.ends_with(b"\r\n\r\n") {
            let text = String::from_utf8_lossy(&buf);
            if text.contains(" 101 ") {
                return Ok(());
            }
            return Err(format!("handshake rejected: {}", text.lines().next().unwrap_or("?")));
        }
    }
}

/** Reads one raw websocket frame (header + optional extension + payload). */
async fn read_ws_frame(tls: &mut TlsStream<TcpStream>) -> Result<(bool, u8, Vec<u8>), String> {
    let mut header = [0u8; 2];
    read_exact_timeout(tls, &mut header).await?;

    let fin = header[0] & 0b1000_0000 != 0;
    let opcode = header[0] & 0b0000_1111;
    let masked = header[1] & 0b1000_0000 != 0;
    let mut len = u64::from(header[1] & 0b0111_1111);

    if len == 126 {
        let mut ext = [0u8; 2];
        read_exact_timeout(tls, &mut ext).await?;
        len = u64::from(u16::from_be_bytes(ext));
    } else if len == 127 {
        let mut ext = [0u8; 8];
        read_exact_timeout(tls, &mut ext).await?;
        len = u64::from_be_bytes(ext);
    }

    let mut mask = [0u8; 4];
    if masked {
        read_exact_timeout(tls, &mut mask).await?;
    }

    if len > (64 * 1024 * 1024) {
        return Err(format!("frame too large: {} bytes", len));
    }

    let mut payload = vec![0u8; len as usize];
    read_exact_timeout(tls, &mut payload).await?;

    if masked {
        for (i, b) in payload.iter_mut().enumerate() {
            *b ^= mask[i % 4];
        }
    }

    Ok((fin, opcode, payload))
}

async fn read_exact_timeout(tls: &mut TlsStream<TcpStream>, buf: &mut [u8]) -> Result<(), String> {
    let fut = tls.read_exact(buf);
    tokio::time::timeout(STALL_TIMEOUT, fut)
        .await
        .map_err(|_| "read stalled".to_string())
        .and_then(|n| n.map(|_| ()).map_err(|e| format!("read: {}", e)))
}

async fn write_ws_frame(tls: &mut TlsStream<TcpStream>, opcode: u8, payload: &[u8]) -> Result<(), String> {
    let mut frame = vec![(0b1000_0000 | opcode) as u8];
    let lam = payload.len();
    if lam < 126 {
        frame.push(0b1000_0000 | lam as u8);
    } else if lam <= u16::MAX as usize {
        frame.push(0b1000_0000 | 126);
        frame.extend_from_slice(&(lam as u16).to_be_bytes());
    } else {
        frame.push(0b1000_0000 | 127);
        frame.extend_from_slice(&(lam as u64).to_be_bytes());
    }

    // Client frames MUST be masked (RFC 6455 §5.3). The key is not required
    // to be cryptographically random — nanos+counter is fine for masking.
    // The mask MUST be exactly 4 bytes.
    static MASK_SEQ: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    let raw_mask = ((nanos.rotate_left(17) ^ 0x9E37_79B9_7F4A_7C15)
        ^ MASK_SEQ.fetch_add(1, Ordering::Relaxed)) as u32;
    let mask = raw_mask.to_be_bytes();
    frame.extend_from_slice(&mask);

    let mut masked_payload = payload.to_vec();
    for (i, b) in masked_payload.iter_mut().enumerate() {
        *b ^= mask[i % 4];
    }
    frame.extend_from_slice(&masked_payload);

    tls.write_all(&frame)
        .await
        .map_err(|e| format!("write: {}", e))
}

/** 16 pseudo-random bytes, base64 (the websocket handshake key). */
fn base64_websocket_key() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let mut state = seed.wrapping_add(SEQ.fetch_add(1, Ordering::Relaxed));
    let mut bytes = [0u8; 16];
    for slot in bytes.iter_mut() {
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        state = state.wrapping_mul(0x2545_F491_4F6C_DD1D);
        *slot = (state >> 32) as u8;
    }

    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(24);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let idx0 = (b0 >> 2) & 0x3F;
        let idx1 = ((b0 & 0x03) << 4) | (b1 >> 4);
        out.push(ALPHABET[idx0 as usize] as char);
        out.push(ALPHABET[idx1 as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[((b1 & 0x0F) << 2 | (b2 >> 6) & 0x03) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(b2 & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

// ─────────────────────────────────────────────────────────────────────────────
// Message parsing (aisstream.io JSON envelope per developer documentation)
// ─────────────────────────────────────────────────────────────────────────────

/** AIS_PADDED_STRING: names/callsigns are '@'-padded to fixed width. */
fn trim_ais_string(s: &str) -> String {
    s.replace('@', "").trim().to_string()
}

/// Case-insensitive first-hit lookup across plausible key spellings.
fn pick<'a>(obj: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    let map = obj.as_object()?;
    let lowered: Vec<String> = keys.iter().map(|k| k.to_ascii_lowercase()).collect();
    for (k, v) in map {
        if lowered.iter().any(|c| c == &k.to_ascii_lowercase()) {
            return Some(v);
        }
    }
    None
}

fn value_f64(v: Option<&Value>) -> Option<f64> {
    v.and_then(|x| x.as_f64())
}

fn value_u32(v: Option<&Value>) -> Option<u32> {
    let x = v?;
    x.as_u64()
        .or_else(|| x.as_str().and_then(|s| s.parse::<u64>().ok()))
        .map(|n| if n > u32::MAX as u64 { u32::MAX } else { n as u32 })
}

fn value_bool_flag(v: Option<&Value>) -> Option<bool> {
    v.and_then(|x| {
        x.as_bool()
            .or_else(|| x.as_str().map(|s| s.eq_ignore_ascii_case("true")))
    })
}

/// Depth-limited search for a (possibly nested) key inside the payload —
/// destinations arrive under "Destination" on ShipStaticData and can also
/// surface inside nested containers of StaticDataReport messages.
fn deep_find_string(obj: &Value, key: &str, depth: usize) -> Option<String> {
    if depth == 0 {
        return None;
    }
    if let Some(found) = pick(obj, &[key]) {
        if let Some(s) = found.as_str() {
            let trimmed = trim_ais_string(s);
            if !trimmed.is_empty() {
                return Some(trimmed.to_uppercase());
            }
        }
    }
    if let Some(map) = obj.as_object() {
        for (_, v) in map {
            if v.is_object() || v.is_array() {
                if let Some(hit) = deep_find_string(v, key, depth - 1) {
                    return Some(hit);
                }
            }
        }
    }
    if let Some(arr) = obj.as_array() {
        for v in arr {
            if v.is_object() && let Some(hit) = deep_find_string(v, key, depth - 1) {
                return Some(hit);
            }
        }
    }
    None
}

fn is_position_message(message_type: &str) -> bool {
    let t = message_type.to_ascii_lowercase();
    // Envelope types across protocol generations: classic aisstream names and
    // raw AIS message names alike.
    t.contains("positionreport") || t.contains("vesselposition") || t == "positionreport_18"
        || t == "positionreport_19"
}

fn is_static_message(message_type: &str) -> bool {
    let t = message_type.to_ascii_lowercase();
    t.contains("static") // ShipStaticData, StaticDataReport, VesselStatic...
}

/// Extracts the payload object bag for a message envelope, tolerating both
/// `{ Message: { <MessageType>: {...} } }` and `{ Message: {...} }` shapes.
fn payload_of<'a>(message: Option<&'a Value>, message_type: &str) -> Option<&'a Value> {
    let msg = message?;
    if let Some(inner) = msg.get(message_type) {
        if inner.is_object() {
            return Some(inner);
        }
    }
    if let Some(single) = msg.as_object().and_then(|m| {
        if m.len() == 1 {
            m.values().next()
        } else {
            None
        }
    }) {
        if single.is_object() {
            return Some(single);
        }
    }
    if msg.is_object() {
        return Some(msg);
    }
    None
}

/** Processes one stream payload (text or binary frame fully received). */
async fn handle_stream_payload(body: &[u8]) {
    match serde_json::from_slice::<Value>(body) {
        Ok(value) => handle_stream_value(&value).await,
        Err(_) => {} // Not JSON (keepalive/heartbeat): ignore.
    }
}

/** Pure ingest step against the process registry (unit-test subject). */
pub async fn handle_stream_value(value: &Value) {
    let message_type = value
        .get("MessageType")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if message_type.is_empty() || message_type.eq_ignore_ascii_case("SubscriptionConfirmation") {
        return;
    }

    let meta = value.get("MetaData");
    let payload = payload_of(value.get("Message"), &message_type);
    let Some(payload) = payload else { return };

    let mmsi = value_u32(pick(payload, &["UserID", "MMSI"]))
        .or_else(|| meta.and_then(|m| value_u32(m.get("MMSI"))))
        .or_else(|| meta.and_then(|m| value_u32(pick(m, &["UserID"]))));
    let Some(mmsi) = mmsi else { return };
    if mmsi == 0 {
        return;
    }

    let map = registry();

    if is_position_message(&message_type) {
        // AIS invalid-position sentinels (91/181°) and the (0,0) null-fix.
        let lon = value_f64(pick(payload, &["Longitude"]))
            .or_else(|| meta.and_then(|m| value_f64(m.get("Longitude"))));
        let lat = value_f64(pick(payload, &["Latitude"]))
            .or_else(|| meta.and_then(|m| value_f64(m.get("Latitude"))));
        let (Some(lon), Some(lat)) = (lon, lat) else { return };
        if lat.abs() > 90.0 || lon.abs() > 180.0 || (lat == 0.0 && lon == 0.0) {
            return;
        }
        if value_bool_flag(pick(payload, &["Valid"])) == Some(false) {
            return;
        }

        // SOG sentinel 102.3 = unavailable; COG 360 = unavailable; heading 511 = unavailable.
        let sog = value_f64(pick(payload, &["Sog", "SpeedOverGround"])).filter(|s| *s >= 0.0 && *s < 102.0);
        let cog = value_f64(pick(payload, &["Cog", "CourseOverGround"])).filter(|c| *c >= 0.0 && *c < 360.0);
        let heading = value_f64(pick(payload, &["TrueHeading"])).filter(|h| *h >= 0.0 && *h < 511.0);
        let nav_status = value_u32(pick(payload, &["NavigationalStatus"]));

        let mut map = map.write().await;
        let record = map.entry(mmsi).or_insert_with(|| VesselRecord {
            mmsi,
            name: String::new(),
            callsign: String::new(),
            ship_type: String::new(),
            destination: String::new(),
            lon: f64::NAN,
            lat: f64::NAN,
            speed_knots: 0.0,
            course_deg: 0.0,
            heading_deg: None,
            status: String::new(),
            last_seen_ms: 0,
        });

        record.lon = lon;
        record.lat = lat;
        if let Some(s) = sog {
            record.speed_knots = s;
        }
        if let Some(c) = cog {
            record.course_deg = c;
        }
        if heading.is_some() {
            record.heading_deg = heading;
        }
        if let Some(code) = nav_status {
            record.status = nav_status_label(code).to_string();
        }
        // MetaData rides along with names more often than the raw payload.
        let meta_name = meta
            .and_then(|m| value_str_field(m, &["ShipName", "Name"]))
            .unwrap_or_default();
        if !meta_name.is_empty() && record.name.is_empty() {
            record.name = meta_name;
        }
        record.last_seen_ms = now_ms() as u64;
        return;
    }

    if is_static_message(&message_type) {
        let destination = deep_find_string(payload, "Destination", 8)
            .or_else(|| meta.and_then(|m| deep_find_string(m, "Destination", 8)))
            .unwrap_or_default();
        let name = value_str_field(payload, &["ShipName", "Name"])
            .or_else(|| meta.and_then(|m| value_str_field(m, &["ShipName", "Name"])))
            .unwrap_or_default();
        let callsign = value_str_field(payload, &["CallSign"])
            .map(|s| trim_ais_string(&s).to_uppercase())
            .or_else(|| meta.and_then(|m| value_str_field(m, &["CallSign"])).map(|s| trim_ais_string(&s).to_uppercase()))
            .unwrap_or_default();
        let ship_type_code = value_u32(pick(payload, &["TypeOfShipAndCargoType", "ShipType"]))
            .or_else(|| meta.and_then(|m| value_u32(m.get("ShipType"))))
            .unwrap_or(0);

        if destination.is_empty() && name.is_empty() && callsign.is_empty() && ship_type_code == 0 {
            return;
        }

        let mut map = map.write().await;
        if map.len() >= REGISTRY_CAP && !map.contains_key(&mmsi) {
            // Prune expired to make room; if still at cap, drop this message.
            let cutoff = now_ms().saturating_sub(POSITION_TTL_MS);
            map.retain(|_, r| u128::from(r.last_seen_ms) >= cutoff);
            if map.len() >= REGISTRY_CAP {
                return;
            }
        }
        let record = map.entry(mmsi).or_insert_with(|| VesselRecord {
            mmsi,
            name: String::new(),
            callsign: String::new(),
            ship_type: String::new(),
            destination: String::new(),
            lon: f64::NAN,
            lat: f64::NAN,
            speed_knots: 0.0,
            course_deg: 0.0,
            heading_deg: None,
            status: String::new(),
            last_seen_ms: 0,
        });

        if !destination.is_empty() {
            record.destination = destination;
        }
        if !name.is_empty() {
            record.name = name;
        }
        if !callsign.is_empty() {
            record.callsign = callsign;
        }
        if ship_type_code > 0 {
            record.ship_type = ship_type_label(ship_type_code).to_string();
        }
    }
}

fn value_str_field(v: &Value, keys: &[&str]) -> Option<String> {
    pick(v, keys)
        .and_then(|x| x.as_str())
        .map(|s| trim_ais_string(s).to_uppercase())
        .filter(|s| !s.is_empty())
}

// ─────────────────────────────────────────────────────────────────────────────
// AIS code tables (ITU-R M.1371 nav status / ship-type groupings)
// ─────────────────────────────────────────────────────────────────────────────

/// Maps the AIS navigational status code to a display string. The client-side
/// moored/anchor deadband in `webglTelemetry.ts` matches on these literals.
pub fn nav_status_label(code: u32) -> &'static str {
    match code {
        0 => "Under way using engine",
        1 => "At anchor",
        2 => "Under way fishing",
        3 => "Restricted manouvribility",
        4 => "Restricted maneuverability",
        5 => "Moored",
        6 => "Aground",
        7 => "Engaged in fishing",
        8 => "Under way sailing",
        9 | 10 => "Reserved for future use",
        11 => "Towing astern",
        12 => "Towing ahead",
        13 => "Reserved",
        14 => "SART active",
        _ => "Unknown",
    }
}

/// Maps the AIS ship-and-cargo type code to the coarse categories the map
/// layer understands (see `getVesselStyle` matching in `telemetryIcons.ts`).
pub fn ship_type_label(code: u32) -> &'static str {
    match code {
        0..=29 => "Vessel",
        30 => "Fishing",
        31 | 32 | 52..=54 => "Tug",
        33 => "Dredging",
        34 => "Diving",
        35 => "Military",
        36 => "Sailing",
        37 => "Pleasure",
        40..=49 => "HSC",
        50 => "Pilot",
        51 => "SAR",
        55 => "Law Enforcement",
        58 => "Medical",
        61..=69 => "Passenger",
        70..=79 => "Container",
        80..=89 => "Tanker",
        90..=99 => "Other",
        _ => "Vessel",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_nav_status_labels() {
        assert_eq!(nav_status_label(0), "Under way using engine");
        assert_eq!(nav_status_label(1), "At anchor");
        assert_eq!(nav_status_label(5), "Moored");
        assert_eq!(nav_status_label(8), "Under way sailing");
        assert_eq!(nav_status_label(4242), "Unknown");
    }

    #[test]
    fn test_ship_type_labels() {
        assert_eq!(ship_type_label(30), "Fishing");
        assert_eq!(ship_type_label(70), "Container");
        assert_eq!(ship_type_label(82), "Tanker");
        assert_eq!(ship_type_label(64), "Passenger");
        assert_eq!(ship_type_label(31), "Tug");
        assert_eq!(ship_type_label(9), "Vessel");
    }

    #[test]
    fn test_trim_ais_string() {
        assert_eq!(trim_ais_string("EVER GIVEN@@@@@"), "EVER GIVEN");
        assert_eq!(trim_ais_string("  MOL TRIUMPH  "), "MOL TRIUMPH");
        assert_eq!(trim_ais_string("@@@@"), "");
    }

    #[tokio::test]
    async fn test_position_report_ingest() {
        // The documented envelope shape.
        let msg = json!({
            "MessageType": "PositionReport",
            "MetaData": {
                "MMSI": 368207620,
                "ShipName": "EXAMPLE VESSEL",
                "Latitude": 25.7617,
                "Longitude": -80.1918
            },
            "Message": {
                "PositionReport": {
                    "MessageID": 1,
                    "UserID": 368207620,
                    "Sog": 12.4,
                    "Cog": 86.7,
                    "TrueHeading": 87,
                    "NavigationalStatus": 0,
                    "Valid": true
                }
            }
        });

        handle_stream_value(&msg).await;
        let map = registry().read().await;
        let record = map.get(&368207620).expect("record ingested");
        assert_eq!(record.lon, -80.1918);
        assert_eq!(record.lat, 25.7617);
        assert_eq!(record.speed_knots, 12.4);
        assert_eq!(record.course_deg, 86.7);
        assert_eq!(record.heading_deg, Some(87.0));
        assert_eq!(record.status, "Under way using engine");
        assert_eq!(record.name, "EXAMPLE VESSEL");
    }

    #[tokio::test]
    async fn test_static_data_ingest_merges_destination() {
        let msg = json!({
            "MessageType": "ShipStaticData",
            "MetaData": { "MMSI": 244111999 },
            "Message": {
                "ShipStaticData": {
                    "UserID": 244111999,
                    "Destination": "ROTTERDAM@@@",
                    "CallSign": "PDBC@@",
                    "TypeOfShipAndCargoType": 70,
                }
            }
        });

        handle_stream_value(&msg).await;
        let map = registry().read().await;
        let record = map.get(&244111999).expect("static record ingested");
        assert_eq!(record.destination, "ROTTERDAM");
        assert_eq!(record.callsign, "PDBC");
        assert_eq!(record.ship_type, "Container");
        // Static-only arrival: no fix yet, so it must not surface in fetches.
        assert!(record.lon.is_nan());
    }

    #[tokio::test]
    async fn test_invalid_positions_rejected() {
        let before_len = {
            let map = registry().read().await;
            map.len()
        };

        // Sentinel coordinates (91 / 181 degrees) and null (0,0) fixes.
        for (lat, lon) in [(91.0, 0.0), (0.0, 181.0), (0.0, 0.0)] {
            let msg = json!({
                "MessageType": "PositionReport",
                "MetaData": { "MMSI": 111222333 },
                "Message": { "PositionReport": {
                    "UserID": 111222333, "Latitude": lat, "Longitude": lon, "Valid": true
                }}
            });
            handle_stream_value(&msg).await;
        }

        // ...and explicit Valid=false.
        let invalid = json!({
            "MessageType": "PositionReport",
            "MetaData": { "MMSI": 111222333 },
            "Message": { "PositionReport": {
                "UserID": 111222333, "Latitude": 50.0, "Longitude": 4.0, "Valid": false
            }}
        });
        handle_stream_value(&invalid).await;

        let map = registry().read().await;
        assert!(map.get(&111222333).is_none());
        assert!(map.len() >= before_len);
    }

    #[tokio::test]
    async fn test_legacy_envelope_shapes_accepted() {
        // Older aisstream payload key spelling (VesselPositionMessage style).
        let msg = json!({
            "MessageType": "VesselPositionMessage",
            "MetaData": { "MMSI": 555666777 },
            "Message": {
                "VesselPositionMessage": {
                    "MMSI": 555666777,
                    "Latitude": 12.5,
                    "Longitude": -55.5,
                    "Sog": 9.9,
                    "NavigationalStatus": 8
                }
            }
        });
        handle_stream_value(&msg).await;
        let map = registry().read().await;
        let record = map.get(&555666777).expect("legacy ingest");
        assert_eq!(record.lat, 12.5);
        assert_eq!(record.status, "Under way sailing");
    }

    /// Bounding-box + recency filtering contract: a fresh in-bbox fix appears,
    /// a stale fix does not, even if still in the registry.
    #[tokio::test]
    async fn test_fetch_filters_bbox_and_staleness() {
        let fresh = json!({
            "MessageType": "PositionReport",
            "MetaData": { "MMSI": 777888999 },
            "Message": { "PositionReport": {
                "UserID": 777888999, "Latitude": 52.0, "Longitude": 4.2,
                "Sog": 11.0, "Valid": true
            }}
        });
        handle_stream_value(&fresh).await;

        // Zero out the fix age to guarantee freshness regardless of clock.
        registry().write().await.get_mut(&777888999).expect("fix").last_seen_ms = now_ms() as u64;

        let within = fetch_live_vessels(Some((0.0, 40.0, 10.0, 60.0))).await.unwrap();
        assert!(within.iter().any(|v| v.mmsi == 777888999));

        let outside = fetch_live_vessels(Some((0.0, 40.0, 10.0, 50.0))).await.unwrap();
        assert!(outside.iter().all(|v| v.mmsi != 777888999));
    }

    #[test]
    fn test_base64_websocket_key_no_overflow_and_valid_length() {
        for _ in 0..100 {
            let key = base64_websocket_key();
            assert_eq!(key.len(), 24, "RFC 6455 requires a 24-character base64 key");
            assert!(key.ends_with("=="), "16 bytes base64-encoded must end with '==' padding");
        }
    }
}
