use super::adsb::FlightTarget;
use super::earthquakes::EarthquakeTarget;
use super::satellites::SatelliteTarget;

/// Contiguous 32-byte Float32Array representation for high-throughput WebGL VBO uploads.
/// Layout per vertex (8 x f32 = 32 bytes):
/// [0] id_hash (f32)
/// [1] lon (f32)
/// [2] lat (f32)
/// [3] heading / inclination (f32)
/// [4] altitude (f32)
/// [5] velocity / mag (f32)
/// [6] aux_metric (f32)
/// [7] category_code (f32: 1.0 = Flight, 2.0 = Earthquake, 3.0 = Satellite)
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct TelemetryVertex {
    pub id_hash: f32,
    pub lon: f32,
    pub lat: f32,
    pub heading_or_inc: f32,
    pub altitude: f32,
    pub velocity_or_mag: f32,
    pub aux_metric: f32,
    pub category_code: f32,
}

const _: () = assert!(std::mem::size_of::<TelemetryVertex>() == 32);

pub fn pack_flights_binary(flights: &[FlightTarget]) -> Vec<u8> {
    let vertices: Vec<TelemetryVertex> = flights
        .iter()
        .map(|f| {
            let id_hash = (f.icao24.bytes().fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32)) % 1_000_000) as f32;
            TelemetryVertex {
                id_hash,
                lon: f.lon as f32,
                lat: f.lat as f32,
                heading_or_inc: f.heading_deg.unwrap_or(0.0) as f32,
                altitude: f.altitude_m.unwrap_or(0.0) as f32,
                velocity_or_mag: f.velocity_mps.unwrap_or(0.0) as f32,
                aux_metric: f.vertical_rate_mps.unwrap_or(0.0) as f32,
                category_code: 1.0,
            }
        })
        .collect();

    bytemuck::cast_slice(&vertices).to_vec()
}

pub fn pack_earthquakes_binary(quakes: &[EarthquakeTarget]) -> Vec<u8> {
    let vertices: Vec<TelemetryVertex> = quakes
        .iter()
        .map(|q| {
            let id_hash = (q.id.bytes().fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32)) % 1_000_000) as f32;
            TelemetryVertex {
                id_hash,
                lon: q.lon as f32,
                lat: q.lat as f32,
                heading_or_inc: 0.0,
                altitude: q.depth_km as f32,
                velocity_or_mag: q.mag as f32,
                aux_metric: q.sig as f32,
                category_code: 2.0,
            }
        })
        .collect();

    bytemuck::cast_slice(&vertices).to_vec()
}

pub fn pack_satellites_binary(sats: &[SatelliteTarget]) -> Vec<u8> {
    let vertices: Vec<TelemetryVertex> = sats
        .iter()
        .map(|s| TelemetryVertex {
            id_hash: s.norad_id as f32,
            lon: s.lon as f32,
            lat: s.lat as f32,
            heading_or_inc: s.inclination_deg as f32,
            altitude: s.altitude_km as f32,
            velocity_or_mag: s.velocity_kms as f32,
            aux_metric: s.period_mins as f32,
            category_code: 3.0,
        })
        .collect();

    bytemuck::cast_slice(&vertices).to_vec()
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
            geo_altitude_m: Some(10050.0),
            velocity_mps: Some(250.0),
            heading_deg: Some(90.0),
            vertical_rate_mps: Some(0.0),
            on_ground: false,
            last_contact_epoch: 1000,
            position_time_epoch: Some(1000),
            simulated: false,
            squawk: Some("1200".to_string()),
            spi: false,
            position_source: 0,
            category: 4,
            emergency: None,
        }];
        let bytes = pack_flights_binary(&flights);
        assert_eq!(bytes.len(), 32);

        // Verify roundtrip read via bytemuck
        let slice: &[TelemetryVertex] = bytemuck::cast_slice(&bytes);
        assert_eq!(slice.len(), 1);
        assert_eq!(slice[0].lon, -122.0);
        assert_eq!(slice[0].lat, 37.0);
        assert_eq!(slice[0].category_code, 1.0);
    }
}
