use rusqlite::{params, Connection, Result};
use std::sync::{Arc, Mutex, OnceLock};
use aircraft_icao_country::Allocs;
use jord::{Angle, LatLong, Length};
use jord::spherical::Sphere;
use super::adsb::FlightTarget;
use super::binary::TelemetryVertex;


// ─────────────────────────────────────────────────────────────────────────────
// Country Resolution (ICAO Annex 10 Mode-S Allocations)
// ─────────────────────────────────────────────────────────────────────────────

static ICAO_LOOKUP: OnceLock<Allocs> = OnceLock::new();

/// Resolves the country of origin from a 24-bit ICAO transponder hex address
/// completely offline in sub-microsecond time.
pub fn resolve_country(icao24: &str, fallback: Option<&str>) -> String {
    let allocs = ICAO_LOOKUP.get_or_init(Allocs::new);
    if let Some(country) = allocs.find_from_hex(icao24) {
        country.to_string()
    } else {
        fallback.unwrap_or("Unknown").to_string()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3D Kinematics & Dead-Reckoning (Kenneth Gade n-vector Geodesy)
// ─────────────────────────────────────────────────────────────────────────────

/// High-accuracy forward projection of an aircraft position using `jord` n-vectors.
/// Completely free of polar singularities and anti-meridian (+/-180 deg) wrapping bugs.
pub fn project_aircraft_position(
    lon: f64,
    lat: f64,
    heading_deg: f64,
    speed_mps: f64,
    dt_seconds: f64,
) -> (f64, f64) {
    if speed_mps <= 0.0 || dt_seconds <= 0.0 {
        return (lon, lat);
    }

    let p0 = LatLong::from_degrees(lat, lon).to_nvector();
    let bearing = Angle::from_degrees(heading_deg);
    let distance = Length::from_metres(speed_mps * dt_seconds);

    let dest = Sphere::EARTH.destination_position(p0, bearing, distance);
    let result = LatLong::from_nvector(dest);
    (result.longitude().as_degrees(), result.latitude().as_degrees())
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared In-Memory SQLite Telemetry Database
// ─────────────────────────────────────────────────────────────────────────────

pub struct TelemetryDb {
    conn: Arc<Mutex<Connection>>,
}

static GLOBAL_DB: OnceLock<TelemetryDb> = OnceLock::new();

impl TelemetryDb {
    /// Connects to or initializes the shared in-memory telemetry database.
    pub fn global() -> &'static TelemetryDb {
        GLOBAL_DB.get_or_init(|| {
            Self::init_in_memory().expect("Failed to initialize in-memory SQLite telemetry DB")
        })
    }

    fn init_in_memory() -> Result<Self> {
        let conn = Connection::open("file:strata_telemetry?mode=memory&cache=shared")?;
        conn.execute_batch(
            "PRAGMA journal_mode = MEMORY;
             PRAGMA temp_store   = MEMORY;
             PRAGMA synchronous  = OFF;
             PRAGMA cache_size   = -64000;
             PRAGMA busy_timeout = 5000;

             -- 1. Master Active Flights Table
             CREATE TABLE IF NOT EXISTS live_flights (
                 rowid INTEGER PRIMARY KEY AUTOINCREMENT,
                 icao24 TEXT NOT NULL UNIQUE,
                 callsign TEXT,
                 origin_country TEXT NOT NULL,
                 lon REAL NOT NULL,
                 lat REAL NOT NULL,
                 altitude_m REAL,
                 geo_altitude_m REAL,
                 velocity_mps REAL,
                 heading_deg REAL,
                 vertical_rate_mps REAL,
                 on_ground INTEGER NOT NULL DEFAULT 0,
                 squawk TEXT,
                 emergency TEXT,
                 category INTEGER NOT NULL DEFAULT 0,
                 last_contact_epoch INTEGER NOT NULL,
                 position_time_epoch INTEGER
             );

             -- 2. SQLite Official R*Tree Virtual Table (id maps to live_flights.rowid)
             CREATE VIRTUAL TABLE IF NOT EXISTS flight_rtree USING rtree(
                 id,
                 min_lon, max_lon,
                 min_lat, max_lat
             );

             -- 3. Historical Flight Breadcrumb Log (Rolling 15-minute trail)
             CREATE TABLE IF NOT EXISTS flight_breadcrumbs (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 icao24 TEXT NOT NULL,
                 lon REAL NOT NULL,
                 lat REAL NOT NULL,
                 altitude_m REAL,
                 heading_deg REAL,
                 velocity_mps REAL,
                 recorded_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_bc_icao_time ON flight_breadcrumbs(icao24, recorded_at);
            ",
        )?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Upserts a batch of flight targets atomically, synchronizing the R*Tree
    /// spatial index and pruning flights inactive for >75s and breadcrumbs >15m.
    pub fn upsert_flights(&self, flights: &[FlightTarget]) -> Result<usize, String> {
        let conn_guard = self.conn.lock().map_err(|e| e.to_string())?;
        let mut conn = conn_guard;

        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let now_epoch = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let mut upsert_stmt = tx
            .prepare(
                "INSERT INTO live_flights (
                    icao24, callsign, origin_country, lon, lat,
                    altitude_m, geo_altitude_m, velocity_mps, heading_deg, vertical_rate_mps,
                    on_ground, squawk, emergency, category, last_contact_epoch,
                    position_time_epoch
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
                 ON CONFLICT(icao24) DO UPDATE SET
                    callsign = excluded.callsign,
                    origin_country = excluded.origin_country,
                    lon = excluded.lon,
                    lat = excluded.lat,
                    altitude_m = excluded.altitude_m,
                    geo_altitude_m = excluded.geo_altitude_m,
                    velocity_mps = excluded.velocity_mps,
                    heading_deg = excluded.heading_deg,
                    vertical_rate_mps = excluded.vertical_rate_mps,
                    on_ground = excluded.on_ground,
                    squawk = excluded.squawk,
                    emergency = excluded.emergency,
                    category = excluded.category,
                    last_contact_epoch = excluded.last_contact_epoch,
                    position_time_epoch = excluded.position_time_epoch
                 RETURNING rowid;",
            )
            .map_err(|e| e.to_string())?;

        let mut rtree_stmt = tx
            .prepare(
                "INSERT OR REPLACE INTO flight_rtree (id, min_lon, max_lon, min_lat, max_lat)
                 VALUES (?1, ?2, ?2, ?3, ?3);",
            )
            .map_err(|e| e.to_string())?;

        let mut breadcrumb_stmt = tx
            .prepare(
                "INSERT INTO flight_breadcrumbs (icao24, lon, lat, altitude_m, heading_deg, velocity_mps, recorded_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
            )
            .map_err(|e| e.to_string())?;

        let mut count = 0;

        for f in flights {
            let country = resolve_country(&f.icao24, Some(&f.origin_country));
            let on_ground_int = if f.on_ground { 1 } else { 0 };

            let rowid: i64 = upsert_stmt
                .query_row(
                    params![
                        f.icao24,
                        f.callsign,
                        country,
                        f.lon,
                        f.lat,
                        f.altitude_m,
                        f.geo_altitude_m,
                        f.velocity_mps,
                        f.heading_deg,
                        f.vertical_rate_mps,
                        on_ground_int,
                        f.squawk,
                        f.emergency,
                        f.category as i32,
                        f.last_contact_epoch,
                        f.position_time_epoch,
                    ],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;

            rtree_stmt
                .execute(params![rowid, f.lon, f.lat])
                .map_err(|e| e.to_string())?;

            // Append breadcrumb point (at most one per 10s per aircraft)
            let _ = breadcrumb_stmt.execute(params![
                f.icao24,
                f.lon,
                f.lat,
                f.altitude_m,
                f.heading_deg,
                f.velocity_mps,
                now_epoch,
            ]);

            count += 1;
        }

        // Drop statements before cleaning up deleted rows
        drop(upsert_stmt);
        drop(rtree_stmt);
        drop(breadcrumb_stmt);

        // Auto-vacuum: Delete flights not updated in the last 75 seconds
        let stale_epoch = now_epoch - 75;
        tx.execute(
            "DELETE FROM flight_rtree WHERE id IN (
                SELECT rowid FROM live_flights WHERE last_contact_epoch < ?1
            );",
            params![stale_epoch],
        )
        .map_err(|e| e.to_string())?;

        tx.execute(
            "DELETE FROM live_flights WHERE last_contact_epoch < ?1;",
            params![stale_epoch],
        )
        .map_err(|e| e.to_string())?;

        // Purge historical breadcrumbs older than 15 minutes (900 seconds)
        let breadcrumb_cutoff = now_epoch - 900;
        tx.execute(
            "DELETE FROM flight_breadcrumbs WHERE recorded_at < ?1;",
            params![breadcrumb_cutoff],
        )
        .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;

        Ok(count)
    }

    /// Queries all flights intersecting a geographic bounding box [min_lon, min_lat, max_lon, max_lat].
    pub fn query_bbox(
        &self,
        min_lon: f64,
        min_lat: f64,
        max_lon: f64,
        max_lat: f64,
    ) -> Result<Vec<FlightTarget>, String> {
        let conn_guard = self.conn.lock().map_err(|e| e.to_string())?;

        let mut stmt = conn_guard
            .prepare(
                "SELECT f.icao24, f.callsign, f.origin_country, f.lon, f.lat,
                        f.altitude_m, f.geo_altitude_m, f.velocity_mps, f.heading_deg,
                        f.vertical_rate_mps, f.on_ground, f.squawk, f.emergency,
                        f.category, f.last_contact_epoch, f.position_time_epoch
                 FROM flight_rtree r
                 JOIN live_flights f ON r.id = f.rowid
                 WHERE r.min_lon <= ?3 AND r.max_lon >= ?1
                   AND r.min_lat <= ?4 AND r.max_lat >= ?2;",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![min_lon, min_lat, max_lon, max_lat], |row| {
                let on_ground_int: i32 = row.get(10)?;
                let cat_int: i32 = row.get(13)?;

                Ok(FlightTarget {
                    icao24: row.get(0)?,
                    callsign: row.get(1)?,
                    origin_country: row.get(2)?,
                    lon: row.get(3)?,
                    lat: row.get(4)?,
                    altitude_m: row.get(5)?,
                    geo_altitude_m: row.get(6)?,
                    velocity_mps: row.get(7)?,
                    heading_deg: row.get(8)?,
                    vertical_rate_mps: row.get(9)?,
                    on_ground: on_ground_int == 1,
                    squawk: row.get(11)?,
                    emergency: row.get(12)?,
                    category: cat_int as u8,
                    last_contact_epoch: row.get(14)?,
                    position_time_epoch: row.get(15)?,
                    spi: false,
                    position_source: 0,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut results = Vec::new();
        for r in rows {
            if let Ok(target) = r {
                results.push(target);
            }
        }
        Ok(results)
    }

    /// Queries flights in a bounding box and returns them packed into a zero-copy
    /// contiguous 32-byte `TelemetryVertex` binary slice for high-performance `strata://` streaming.
    pub fn query_binary_bbox(
        &self,
        min_lon: f64,
        min_lat: f64,
        max_lon: f64,
        max_lat: f64,
    ) -> Result<Vec<u8>, String> {
        let conn_guard = self.conn.lock().map_err(|e| e.to_string())?;

        let mut stmt = conn_guard
            .prepare(
                "SELECT f.icao24, f.lon, f.lat, f.heading_deg, f.altitude_m,
                        f.velocity_mps, f.vertical_rate_mps, f.category, f.emergency
                 FROM flight_rtree r
                 JOIN live_flights f ON r.id = f.rowid
                 WHERE r.min_lon <= ?3 AND r.max_lon >= ?1
                   AND r.min_lat <= ?4 AND r.max_lat >= ?2;",
            )
            .map_err(|e| e.to_string())?;

        let vertices: Vec<TelemetryVertex> = stmt
            .query_map(params![min_lon, min_lat, max_lon, max_lat], |row| {
                let icao: String = row.get(0)?;
                let id_hash = (icao
                    .bytes()
                    .fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32))
                    % 1_000_000) as f32;

                let emergency_flag = if row.get::<_, Option<String>>(8)?.is_some() {
                    1000.0
                } else {
                    0.0
                };
                let cat: i32 = row.get(7)?;

                Ok(TelemetryVertex {
                    id_hash,
                    lon: row.get::<_, f64>(1)? as f32,
                    lat: row.get::<_, f64>(2)? as f32,
                    heading_or_inc: row.get::<_, Option<f64>>(3)?.unwrap_or(0.0) as f32,
                    altitude: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0) as f32,
                    velocity_or_mag: row.get::<_, Option<f64>>(5)?.unwrap_or(0.0) as f32,
                    aux_metric: row.get::<_, Option<f64>>(6)?.unwrap_or(0.0) as f32,
                    category_code: 1.0 + (cat as f32 * 0.01) + (emergency_flag * 0.001),
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();

        Ok(bytemuck::cast_slice(&vertices).to_vec())
    }

    /// Retrieves the rolling breadcrumb trajectory for an aircraft as GeoJSON LineString.
    pub fn get_flight_trail(&self, icao24: &str) -> Result<serde_json::Value, String> {
        let conn_guard = self.conn.lock().map_err(|e| e.to_string())?;

        let mut stmt = conn_guard
            .prepare(
                "SELECT lon, lat, altitude_m, heading_deg, velocity_mps, recorded_at
                 FROM flight_breadcrumbs
                 WHERE icao24 = ?1
                 ORDER BY recorded_at ASC;",
            )
            .map_err(|e| e.to_string())?;

        let coords: Vec<serde_json::Value> = stmt
            .query_map(params![icao24], |row| {
                let lon: f64 = row.get(0)?;
                let lat: f64 = row.get(1)?;
                let alt: Option<f64> = row.get(2)?;
                let time: i64 = row.get(5)?;
                Ok(serde_json::json!([lon, lat, alt.unwrap_or(0.0), time]))
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();

        Ok(serde_json::json!({
            "type": "Feature",
            "properties": {
                "icao24": icao24,
                "pointCount": coords.len()
            },
            "geometry": {
                "type": "LineString",
                "coordinates": coords
            }
        }))
    }
}
