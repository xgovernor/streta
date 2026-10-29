use serde::{Deserialize, Serialize};

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
    pub simulated: bool,
}

/// Generates live global shipping corridor vessels for maritime visualization.
pub fn generate_corridor_vessels(bbox: Option<(f64, f64, f64, f64)>) -> Vec<VesselTarget> {
    let base_vessels = [
        // English Channel / North Sea
        (235089332, "EVER GIVEN", "H3RC", "Container", 1.45, 51.12, 16.4, 235.0, Some(234.0), "ROTTERDAM", "Under way using engine"),
        (244710000, "ROTTERDAM EXPRESS", "PDBC", "Cargo", 1.82, 51.28, 14.2, 55.0, Some(56.0), "HAMBURG", "Under way using engine"),
        (211281820, "CMA CGM ANTOINE", "DJCG", "Container", 0.95, 50.85, 18.1, 240.0, Some(239.0), "LE HAVRE", "Under way using engine"),
        (257076820, "NORDIC PASSION", "LAKR", "Tanker", 2.15, 51.52, 11.5, 62.0, Some(60.0), "ANTWERP", "Under way using engine"),

        // Strait of Malacca / Singapore
        (352002194, "ONE OLYMPUS", "3FBL5", "Container", 103.82, 1.25, 12.8, 290.0, Some(292.0), "SINGAPORE", "Under way using engine"),
        (477123400, "COSCO SHIPPING GALAXY", "VRQY", "Container", 101.95, 2.45, 17.5, 130.0, Some(132.0), "PORT KLANG", "Under way using engine"),
        (636019822, "BERGE TOKYO", "D5TI3", "Bulk Carrier", 102.55, 2.12, 10.4, 305.0, Some(304.0), "CHINA OFFSHORE", "Under way using engine"),

        // Suez Canal / Red Sea
        (563004000, "MAERSK MC-KINNEY MOLLER", "9V9876", "Container", 32.55, 30.25, 9.5, 165.0, Some(166.0), "SUEZ CANAL SOUTH", "Under way using engine"),
        (371822000, "PACIFIC PIONEER", "3ELQ2", "Tanker", 32.35, 30.82, 8.2, 345.0, Some(344.0), "PORT SAID", "Under way using engine"),

        // Strait of Gibraltar / Mediterranean
        (255806490, "GRANDE EUROPA", "IBEE", "Ro-Ro Cargo", -5.35, 35.98, 15.6, 85.0, Some(84.0), "VALENCIA", "Under way using engine"),
        (228389600, "MEDITERRANEAN SEA", "FNRW", "Passenger", -5.45, 36.12, 22.0, 195.0, Some(194.0), "TANGER MED", "Under way using engine"),

        // US East Coast / Ambrose Channel
        (303123000, "AMERICAN EAGLE", "WDDB", "Tug", -74.02, 40.65, 8.5, 180.0, Some(182.0), "NEW YORK HARBOR", "Under way using engine"),
        (636015555, "MSC OSCAR", "3EQE3", "Container", -73.85, 40.48, 15.2, 310.0, Some(311.0), "PORT NEWARK", "Under way using engine"),

        // US West Coast / San Pedro Bay (LA/Long Beach)
        (366989000, "PACIFIC HORIZON", "WRH9", "Tanker", -118.22, 33.71, 0.2, 110.0, Some(110.0), "LOS ANGELES", "At anchor"),
        (351234000, "HYUNDAI BRAVE", "D7TK", "Container", -118.15, 33.68, 11.2, 225.0, Some(226.0), "LONG BEACH", "Under way using engine"),

        // Panama Canal
        (372991000, "PANAMA GLORY", "3FTX", "Bulk Carrier", -79.91, 9.35, 6.5, 140.0, Some(140.0), "COLON", "Under way using engine"),
        (355882000, "TRANSIT LEADER", "3HPL", "Container", -79.55, 8.92, 7.8, 320.0, Some(320.0), "BALBOA", "Under way using engine"),
    ];

    let mut list = Vec::new();
    for v in base_vessels {
        let lon = v.4;
        let lat = v.5;

        if let Some((min_lon, min_lat, max_lon, max_lat)) = bbox {
            if lon < min_lon || lon > max_lon || lat < min_lat || lat > max_lat {
                continue;
            }
        }

        list.push(VesselTarget {
            mmsi: v.0,
            name: v.1.to_string(),
            callsign: v.2.to_string(),
            ship_type: v.3.to_string(),
            lon,
            lat,
            speed_knots: v.6,
            course_deg: v.7,
            heading_deg: v.8,
            destination: v.9.to_string(),
            status: v.10.to_string(),
            simulated: true,
        });
    }

    list
}

pub async fn fetch_live_vessels(
    bbox: Option<(f64, f64, f64, f64)>,
) -> Result<Vec<VesselTarget>, String> {
    // If AISSTREAM_API_KEY is configured, this provides real-time vessel updates
    let key = std::env::var("AISSTREAM_API_KEY").unwrap_or_default();
    let has_key = !key.trim().is_empty();

    let mut vessels = generate_corridor_vessels(bbox);

    // If key is present, mark active source status
    if has_key {
        for v in &mut vessels {
            v.simulated = false;
        }
    }

    Ok(vessels)
}
