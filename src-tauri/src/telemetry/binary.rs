use super::adsb::FlightTarget;
use super::earthquakes::EarthquakeTarget;
use super::satellites::SatelliteTarget;

/// Packs telemetry points into a contiguous 32-byte Float32Array representation.
/// Layout per element (8 x f32 = 32 bytes):
/// [0] id_hash (f32)
/// [1] lon (f32)
/// [2] lat (f32)
/// [3] heading / inclination (f32)
/// [4] altitude (f32)
/// [5] velocity / mag (f32)
/// [6] aux_metric (f32)
/// [7] category_code (f32: 1.0 = Flight, 2.0 = Earthquake, 3.0 = Satellite)
pub fn pack_flights_binary(flights: &[FlightTarget]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(flights.len() * 32);

    for f in flights {
        let id_hash = (f.icao24.bytes().fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32)) % 1000000) as f32;
        let lon = f.lon as f32;
        let lat = f.lat as f32;
        let heading = f.heading_deg.unwrap_or(0.0) as f32;
        let alt = f.altitude_m.unwrap_or(0.0) as f32;
        let vel = f.velocity_mps.unwrap_or(0.0) as f32;
        let v_rate = f.vertical_rate_mps.unwrap_or(0.0) as f32;
        let cat = 1.0f32;

        for &val in &[id_hash, lon, lat, heading, alt, vel, v_rate, cat] {
            bytes.extend_from_slice(&val.to_le_bytes());
        }
    }

    bytes
}

pub fn pack_earthquakes_binary(quakes: &[EarthquakeTarget]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(quakes.len() * 32);

    for q in quakes {
        let id_hash = (q.id.bytes().fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32)) % 1000000) as f32;
        let lon = q.lon as f32;
        let lat = q.lat as f32;
        let heading = 0.0f32;
        let depth = q.depth_km as f32;
        let mag = q.mag as f32;
        let sig = q.sig as f32;
        let cat = 2.0f32;

        for &val in &[id_hash, lon, lat, heading, depth, mag, sig, cat] {
            bytes.extend_from_slice(&val.to_le_bytes());
        }
    }

    bytes
}

pub fn pack_satellites_binary(sats: &[SatelliteTarget]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(sats.len() * 32);

    for s in sats {
        let id = s.norad_id as f32;
        let lon = s.lon as f32;
        let lat = s.lat as f32;
        let inc = s.inclination_deg as f32;
        let alt = s.altitude_km as f32;
        let vel = s.velocity_kms as f32;
        let period = s.period_mins as f32;
        let cat = 3.0f32;

        for &val in &[id, lon, lat, inc, alt, vel, period, cat] {
            bytes.extend_from_slice(&val.to_le_bytes());
        }
    }

    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_packing_lengths() {
        let flights = vec![FlightTarget {
            icao24: "abc".to_string(),
            callsign: "TEST1".to_string(),
            origin_country: "US".to_string(),
            lon: -122.0,
            lat: 37.0,
            altitude_m: Some(10000.0),
            velocity_mps: Some(250.0),
            heading_deg: Some(90.0),
            vertical_rate_mps: Some(0.0),
            on_ground: false,
            last_contact_epoch: 1000,
        }];
        let bytes = pack_flights_binary(&flights);
        assert_eq!(bytes.len(), 32);
    }
}
