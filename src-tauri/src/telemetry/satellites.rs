use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SatelliteTarget {
    pub norad_id: u32,
    pub name: String,
    pub category: String,
    pub lon: f64,
    pub lat: f64,
    pub altitude_km: f64,
    pub velocity_kms: f64,
    pub period_mins: f64,
    pub inclination_deg: f64,
    pub ground_track: Vec<(f64, f64)>,
}

struct OrbitDef {
    norad_id: u32,
    name: &'static str,
    category: &'static str,
    inclination_deg: f64,
    altitude_km: f64,
    period_mins: f64,
    velocity_kms: f64,
    initial_raan_deg: f64,
    initial_arg_deg: f64,
}

const CONSTELLATION: &[OrbitDef] = &[
    OrbitDef {
        norad_id: 25544,
        name: "ISS (Zarya)",
        category: "Space Station",
        inclination_deg: 51.64,
        altitude_km: 418.0,
        period_mins: 92.9,
        velocity_kms: 7.66,
        initial_raan_deg: 140.0,
        initial_arg_deg: 45.0,
    },
    OrbitDef {
        norad_id: 48274,
        name: "Tiangong (CSS)",
        category: "Space Station",
        inclination_deg: 41.47,
        altitude_km: 385.0,
        period_mins: 92.2,
        velocity_kms: 7.68,
        initial_raan_deg: 210.0,
        initial_arg_deg: 80.0,
    },
    OrbitDef {
        norad_id: 20580,
        name: "Hubble Space Telescope",
        category: "Astrophysics",
        inclination_deg: 28.47,
        altitude_km: 535.0,
        period_mins: 95.3,
        velocity_kms: 7.59,
        initial_raan_deg: 45.0,
        initial_arg_deg: 12.0,
    },
    OrbitDef {
        norad_id: 40697,
        name: "Sentinel-2A",
        category: "Earth Observation",
        inclination_deg: 98.62,
        altitude_km: 786.0,
        period_mins: 100.6,
        velocity_kms: 7.45,
        initial_raan_deg: 295.0,
        initial_arg_deg: 180.0,
    },
    OrbitDef {
        norad_id: 49260,
        name: "Landsat 9",
        category: "Earth Observation",
        inclination_deg: 98.20,
        altitude_km: 705.0,
        period_mins: 98.8,
        velocity_kms: 7.50,
        initial_raan_deg: 15.0,
        initial_arg_deg: 220.0,
    },
    OrbitDef {
        norad_id: 43013,
        name: "NOAA-20 (JPSS-1)",
        category: "Weather Radar",
        inclination_deg: 98.70,
        altitude_km: 824.0,
        period_mins: 101.4,
        velocity_kms: 7.44,
        initial_raan_deg: 180.0,
        initial_arg_deg: 90.0,
    },
    OrbitDef {
        norad_id: 25994,
        name: "Terra (EOS AM-1)",
        category: "Climate Monitoring",
        inclination_deg: 98.20,
        altitude_km: 705.0,
        period_mins: 98.9,
        velocity_kms: 7.50,
        initial_raan_deg: 85.0,
        initial_arg_deg: 310.0,
    },
];

pub fn compute_live_satellites() -> Vec<SatelliteTarget> {
    let now_epoch_secs = chrono::Utc::now().timestamp() as f64;

    CONSTELLATION
        .iter()
        .map(|sat| {
            let (current_lon, current_lat) = propagate_orbit(sat, now_epoch_secs);

            // Compute ground track: 31 points from -45 mins to +45 mins (every 3 mins)
            let mut track = Vec::with_capacity(31);
            for m in (-45..=45).step_by(3) {
                let t = now_epoch_secs + (m as f64) * 60.0;
                let (lon, lat) = propagate_orbit(sat, t);
                track.push(((lon * 1000.0).round() / 1000.0, (lat * 1000.0).round() / 1000.0));
            }

            SatelliteTarget {
                norad_id: sat.norad_id,
                name: sat.name.to_string(),
                category: sat.category.to_string(),
                lon: (current_lon * 10000.0).round() / 10000.0,
                lat: (current_lat * 10000.0).round() / 10000.0,
                altitude_km: sat.altitude_km,
                velocity_kms: sat.velocity_kms,
                period_mins: sat.period_mins,
                inclination_deg: sat.inclination_deg,
                ground_track: track,
            }
        })
        .collect()
}

fn propagate_orbit(sat: &OrbitDef, epoch_secs: f64) -> (f64, f64) {
    let deg2rad = std::f64::consts::PI / 180.0;
    let rad2deg = 180.0 / std::f64::consts::PI;

    let period_secs = sat.period_mins * 60.0;
    let mean_motion_rad = (2.0 * std::f64::consts::PI) / period_secs;
    let earth_rotation_rad = (2.0 * std::f64::consts::PI) / 86164.0905; // sidereal day

    // Orbital phase
    let u = sat.initial_arg_deg * deg2rad + mean_motion_rad * epoch_secs;
    let inc = sat.inclination_deg * deg2rad;

    // Sub-satellite latitude
    let sin_lat = inc.sin() * u.sin();
    let lat = sin_lat.asin() * rad2deg;

    // Sub-satellite longitude
    let y = inc.cos() * u.sin();
    let x = u.cos();
    let ra = y.atan2(x);

    let raan = sat.initial_raan_deg * deg2rad - earth_rotation_rad * epoch_secs;
    let mut lon = (raan + ra) * rad2deg;

    // Normalize longitude into [-180, 180]
    lon = ((lon + 180.0) % 360.0 + 360.0) % 360.0 - 180.0;

    (lon, lat)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_satellite_propagation() {
        let sats = compute_live_satellites();
        assert_eq!(sats.len(), CONSTELLATION.len());
        for s in sats {
            assert!(s.lon >= -180.0 && s.lon <= 180.0);
            assert!(s.lat >= -90.0 && s.lat <= 90.0);
            assert!(s.altitude_km > 300.0 && s.altitude_km < 1000.0);
            assert_eq!(s.ground_track.len(), 31);
        }
    }
}
