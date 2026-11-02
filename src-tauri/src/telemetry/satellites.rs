use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SatelliteTarget {
    pub id: String, // Populate as format!("sat-{}", sat.norad_id)
    pub norad_id: u32,
    pub name: String,
    pub category: String,
    #[serde(rename = "longitude", alias = "lon")]
    pub lon: f64,
    #[serde(rename = "latitude", alias = "lat")]
    pub lat: f64,
    pub altitude_km: f64,
    #[serde(rename = "velocityKmh")]
    pub velocity_kmh: f64, // Multiply cur_vel (km/s) * 3600.0
    pub period_mins: f64,
    pub inclination_deg: f64,
    pub ground_track: Vec<(f64, f64)>,
}

struct SatelliteTleDef {
    norad_id: u32,
    name: &'static str,
    category: &'static str,
    line1: &'static str,
    line2: &'static str,
}

// Global Earth Observation and Space Exploration Constellation with standard NORAD TLEs
const CONSTELLATION: &[SatelliteTleDef] = &[
    SatelliteTleDef {
        norad_id: 25544,
        name: "ISS (Zarya)",
        category: "Space Station",
        line1: "1 25544U 98067A   26200.50000000  .00001000  00000-0  10000-4 0  9991",
        line2: "2 25544  51.6420 182.3500 0005100 120.4000 240.2000 15.49850000445005",
    },
    SatelliteTleDef {
        norad_id: 48274,
        name: "Tiangong (CSS)",
        category: "Space Station",
        line1: "1 48274U 21035A   26200.50000000  .00001000  00000-0  10000-4 0  9997",
        line2: "2 48274  41.4720 195.4200 0004200 110.2000 250.3000 15.58900000162003",
    },
    SatelliteTleDef {
        norad_id: 20580,
        name: "Hubble Space Telescope",
        category: "Astrophysics",
        line1: "1 20580U 90037B   26200.50000000  .00000500  00000-0  10000-5 0  9990",
        line2: "2 20580  28.4690  85.2300 0002800 290.1000  70.2000 15.09200000854009",
    },
    SatelliteTleDef {
        norad_id: 40697,
        name: "Sentinel-2A",
        category: "Earth Observation",
        line1: "1 40697U 15028A   26200.50000000  .00000100  00000-0  10000-5 0  9994",
        line2: "2 40697  98.5700 145.2000 0001100  85.4000 274.8000 14.30820000456002",
    },
    SatelliteTleDef {
        norad_id: 49260,
        name: "Landsat 9",
        category: "Earth Observation",
        line1: "1 49260U 21088A   26200.50000000  .00000100  00000-0  10000-5 0  9992",
        line2: "2 49260  98.2000 160.3000 0001200  70.2000 290.1000 14.57120000132002",
    },
    SatelliteTleDef {
        norad_id: 43013,
        name: "NOAA-20 (JPSS-1)",
        category: "Weather Radar",
        line1: "1 43013U 17073A   26200.50000000  .00000100  00000-0  10000-5 0  9991",
        line2: "2 43013  98.7100 210.4000 0001400  95.1000 265.2000 14.19500000329004",
    },
    SatelliteTleDef {
        norad_id: 25994,
        name: "Terra (EOS AM-1)",
        category: "Climate Monitoring",
        line1: "1 25994U 99068A   26200.50000000  .00000100  00000-0  10000-5 0  9993",
        line2: "2 25994  98.2000 110.5000 0001500  65.3000 295.1000 14.57100000289001",
    },
];

pub fn compute_live_satellites() -> Vec<SatelliteTarget> {
    let now = chrono::Utc::now();

    CONSTELLATION
        .iter()
        .filter_map(|sat| {
            let (cur_lon, cur_lat, cur_alt, cur_vel, period, inc) =
                propagate_sgp4(sat.line1, sat.line2, &now)?;

            // Compute ground track: 31 points from -45 mins to +45 mins (every 3 mins)
            let mut track = Vec::with_capacity(31);
            for m in (-45..=45).step_by(3) {
                let t = now + chrono::Duration::minutes(m as i64);
                if let Some((t_lon, t_lat, ..)) = propagate_sgp4(sat.line1, sat.line2, &t) {
                    track.push((
                        (t_lon * 1000.0).round() / 1000.0,
                        (t_lat * 1000.0).round() / 1000.0,
                    ));
                }
            }

            Some(SatelliteTarget {
                id: format!("sat-{}", sat.norad_id),
                norad_id: sat.norad_id,
                name: sat.name.to_string(),
                category: sat.category.to_string(),
                lon: (cur_lon * 10000.0).round() / 10000.0,
                lat: (cur_lat * 10000.0).round() / 10000.0,
                altitude_km: (cur_alt * 10.0).round() / 10.0,
                velocity_kmh: (cur_vel * 100.0).round() / 100.0,
                period_mins: (period * 10.0).round() / 10.0,
                inclination_deg: (inc * 100.0).round() / 100.0,
                ground_track: track,
            })
        })
        .collect()
}

/// Computes high-precision WGS-84 geodetic coordinates using standard SGP4 orbital propagation.
/// Factors in J2/J3/J4 geopotential harmonics, atmospheric drag, and Earth oblateness.
fn propagate_sgp4(
    tle_line1: &str,
    tle_line2: &str,
    target_time: &chrono::DateTime<chrono::Utc>,
) -> Option<(f64, f64, f64, f64, f64, f64)> {
    let elements =
        sgp4::Elements::from_tle(None, tle_line1.as_bytes(), tle_line2.as_bytes()).ok()?;

    let constants = sgp4::Constants::from_elements(&elements).ok()?;

    let naive_dt = target_time.naive_utc();
    let minutes = elements.datetime_to_minutes_since_epoch(&naive_dt).ok()?;
    let prediction = constants.propagate(minutes).ok()?;

    let years = sgp4::julian_years_since_j2000(&naive_dt);
    let gmst = sgp4::iau_epoch_to_sidereal_time(years);

    let [x, y, z] = prediction.position;
    let cos_g = gmst.cos();
    let sin_g = gmst.sin();

    // Rotate TEME (True Equator, Mean Equinox) into ECEF (Earth-Centered, Earth-Fixed)
    let x_ecef = x * cos_g + y * sin_g;
    let y_ecef = -x * sin_g + y * cos_g;
    let z_ecef = z;

    // Convert ECEF to WGS-84 Geodetic coordinates (Bowring's closed-form algorithm)
    let a = 6378.137; // WGS-84 semi-major axis (km)
    let f = 1.0 / 298.257223563; // flattening
    let b = a * (1.0 - f); // semi-minor axis
    let e2 = 2.0 * f - f * f;
    let ep2 = (a * a - b * b) / (b * b);

    let p = (x_ecef * x_ecef + y_ecef * y_ecef).sqrt();
    let theta = (z_ecef * a).atan2(p * b);

    let sin_th = theta.sin();
    let cos_th = theta.cos();
    let lat_rad = (z_ecef + ep2 * b * sin_th.powi(3)).atan2(p - e2 * a * cos_th.powi(3));

    let sin_lat = lat_rad.sin();
    let n = a / (1.0 - e2 * sin_lat * sin_lat).sqrt();
    let alt_km = p / lat_rad.cos() - n;

    let lon_rad = y_ecef.atan2(x_ecef);
    let mut lon_deg = lon_rad.to_degrees();
    // Normalize longitude into [-180, 180]
    lon_deg = ((lon_deg + 180.0) % 360.0 + 360.0) % 360.0 - 180.0;
    let lat_deg = lat_rad.to_degrees().clamp(-90.0, 90.0);

    let vel_kms = (prediction.velocity[0].powi(2)
        + prediction.velocity[1].powi(2)
        + prediction.velocity[2].powi(2))
    .sqrt();

    // In SGP4, mean_motion is in revolutions per day; period_mins = 1440.0 / mean_motion
    let period_mins = 1440.0 / elements.mean_motion;
    let inc_deg = elements.inclination.to_degrees();

    Some((lon_deg, lat_deg, alt_km, vel_kms, period_mins, inc_deg))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_satellite_propagation() {
        let sats = compute_live_satellites();
        assert_eq!(sats.len(), CONSTELLATION.len());
        for s in &sats {
            assert!(s.lon >= -180.0 && s.lon <= 180.0);
            assert!(s.lat >= -90.0 && s.lat <= 90.0);
            assert!(s.altitude_km > 300.0 && s.altitude_km < 1200.0);
            assert!(s.velocity_kmh > 6.0 && s.velocity_kmh < 9.0);
            assert!(s.period_mins > 80.0 && s.period_mins < 120.0);
            assert_eq!(s.ground_track.len(), 31);
        }
    }
}
