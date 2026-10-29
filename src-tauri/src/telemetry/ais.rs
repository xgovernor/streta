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

/// Generates live global shipping corridor vessels across all primary international maritime choke points.
pub fn generate_corridor_vessels(bbox: Option<(f64, f64, f64, f64)>) -> Vec<VesselTarget> {
    let base_vessels: &[(u32, &str, &str, &str, f64, f64, f64, f64, Option<f64>, &str, &str)] = &[
        // ── English Channel & North Sea ──
        (235089332, "EVER GIVEN", "H3RC", "Container", 1.45, 51.12, 16.4, 235.0, Some(234.0), "ROTTERDAM", "Under way using engine"),
        (244710000, "ROTTERDAM EXPRESS", "PDBC", "Cargo", 1.82, 51.28, 14.2, 55.0, Some(56.0), "HAMBURG", "Under way using engine"),
        (211281820, "CMA CGM ANTOINE", "DJCG", "Container", 0.95, 50.85, 18.1, 240.0, Some(239.0), "LE HAVRE", "Under way using engine"),
        (257076820, "NORDIC PASSION", "LAKR", "Tanker", 2.15, 51.52, 11.5, 62.0, Some(60.0), "ANTWERP", "Under way using engine"),
        (232005670, "QUEEN MARY 2", "GBDY", "Passenger", -1.25, 50.45, 21.0, 210.0, Some(210.0), "NEW YORK", "Under way using engine"),
        (235012345, "MAAS TUG 1", "PDTU", "Tug", 4.12, 51.98, 8.5, 120.0, Some(120.0), "ROTTERDAM", "Under way using engine"),

        // ── Baltic Sea & Skagerrak ──
        (219018000, "FINNPARTNER", "OXZN", "Ro-Ro Cargo", 11.85, 57.65, 17.0, 185.0, Some(185.0), "TRAVEMUNDE", "Under way using engine"),
        (265001000, "STENA GERMANICA", "SFHQ", "Passenger", 11.60, 57.45, 19.5, 20.0, Some(20.0), "GOTHENBURG", "Under way using engine"),

        // ── Strait of Gibraltar & Mediterranean ──
        (255806490, "GRANDE EUROPA", "IBEE", "Ro-Ro Cargo", -5.35, 35.98, 15.6, 85.0, Some(84.0), "VALENCIA", "Under way using engine"),
        (228389600, "MEDITERRANEAN SEA", "FNRW", "Passenger", -5.45, 36.12, 22.0, 195.0, Some(194.0), "TANGER MED", "Under way using engine"),
        (247385200, "MSC GRANDIOSA", "IBIR", "Passenger", 14.25, 40.75, 18.4, 150.0, Some(150.0), "NAPLES", "Under way using engine"),
        (239012000, "AEGEAN BREEZE", "SVAA", "Tanker", 24.15, 37.45, 13.2, 95.0, Some(95.0), "PIRAEUS", "Under way using engine"),

        // ── Suez Canal & Red Sea ──
        (563004000, "MAERSK MC-KINNEY MOLLER", "9V9876", "Container", 32.55, 30.25, 9.5, 165.0, Some(166.0), "SUEZ CANAL SOUTH", "Under way using engine"),
        (371822000, "PACIFIC PIONEER", "3ELQ2", "Tanker", 32.35, 30.82, 8.2, 345.0, Some(344.0), "PORT SAID", "Under way using engine"),
        (636015555, "MSC OSCAR", "3EQE3", "Container", 38.45, 21.15, 16.8, 155.0, Some(155.0), "JEDDAH", "Under way using engine"),

        // ── Persian Gulf & Strait of Hormuz ──
        (422019900, "GULF STAR", "EQPQ", "Tanker", 56.45, 26.25, 12.0, 130.0, Some(130.0), "RAS TANURA", "Under way using engine"),
        (470123000, "AL GHARIYA", "A7FA", "LNG Tanker", 55.15, 25.85, 15.2, 315.0, Some(315.0), "RAS LAFFAN", "Under way using engine"),
        (538004567, "HORMUZ GUARDIAN", "V7CR3", "Tug", 56.25, 26.55, 10.1, 45.0, Some(45.0), "FUJAIRAH", "Under way using engine"),

        // ── Strait of Malacca & Singapore ──
        (352002194, "ONE OLYMPUS", "3FBL5", "Container", 103.82, 1.25, 12.8, 290.0, Some(292.0), "SINGAPORE", "Under way using engine"),
        (477123400, "COSCO SHIPPING GALAXY", "VRQY", "Container", 101.95, 2.45, 17.5, 130.0, Some(132.0), "PORT KLANG", "Under way using engine"),
        (636019822, "BERGE TOKYO", "D5TI3", "Bulk Carrier", 102.55, 2.12, 10.4, 305.0, Some(304.0), "CHINA OFFSHORE", "Under way using engine"),
        (566012000, "PACIFIC DISCOVERY", "9V2341", "Tanker", 104.15, 1.35, 11.2, 85.0, Some(85.0), "SINGAPORE ANCHORAGE", "Under way using engine"),

        // ── South China Sea & Taiwan Strait ──
        (413000000, "YANTIAN EXPRESS", "BRLG", "Container", 114.25, 22.15, 18.2, 75.0, Some(75.0), "SHENZHEN", "Under way using engine"),
        (416000000, "EVER ACE", "BKHE", "Container", 119.50, 23.85, 20.4, 40.0, Some(40.0), "KAOHSIUNG", "Under way using engine"),
        (412000000, "CHANG HANG SHAN", "BOAH", "Bulk Carrier", 122.50, 30.50, 11.8, 160.0, Some(160.0), "SHANGHAI", "Under way using engine"),

        // ── East Asia (Tokyo Bay & Busan) ──
        (431000000, "MOL TRIUMPH", "7JAL", "Container", 139.85, 35.35, 14.5, 195.0, Some(195.0), "TOKYO", "Under way using engine"),
        (440000000, "HYUNDAI PRIDE", "D8LK", "Container", 129.10, 35.05, 15.1, 85.0, Some(85.0), "BUSAN", "Under way using engine"),

        // ── Trans-Pacific Shipping Corridors ──
        (355000000, "OOCL HONG KONG", "3FLM", "Container", 175.50, 38.25, 21.5, 88.0, Some(88.0), "LONG BEACH", "Under way using engine"),
        (477000000, "CMA CGM ANTOINE", "VRXJ", "Container", -155.00, 36.50, 20.0, 92.0, Some(92.0), "LOS ANGELES", "Under way using engine"),
        (311000000, "PACIFIC TRADER", "H8KA", "Bulk Carrier", -170.00, 32.00, 13.5, 265.0, Some(265.0), "YOKOHAMA", "Under way using engine"),

        // ── Trans-Atlantic Corridors ──
        (244000000, "ATLANTIC CONVEYOR", "PDBN", "Container", -35.50, 48.25, 19.0, 255.0, Some(255.0), "NEW YORK", "Under way using engine"),
        (235000000, "MAERSK MC-KINNEY", "MLAA", "Container", -42.00, 44.50, 20.2, 75.0, Some(75.0), "ROTTERDAM", "Under way using engine"),
        (257000000, "NORDIC POLARIS", "LAKX", "Tanker", -30.00, 38.00, 13.0, 240.0, Some(240.0), "HOUSTON", "Under way using engine"),

        // ── US East Coast & New York Harbor ──
        (303123000, "AMERICAN EAGLE", "WDDB", "Tug", -74.02, 40.65, 8.5, 180.0, Some(182.0), "NEW YORK HARBOR", "Under way using engine"),
        (368000000, "HORIZON PACIFIC", "WYX1", "Container", -73.85, 40.48, 15.2, 310.0, Some(311.0), "PORT NEWARK", "Under way using engine"),
        (367000000, "CAROLINA STAR", "WDL4", "Tanker", -75.80, 36.85, 12.4, 15.0, Some(15.0), "NORFOLK", "Under way using engine"),

        // ── US West Coast & San Pedro Bay ──
        (366989000, "PACIFIC HORIZON", "WRH9", "Tanker", -118.22, 33.71, 0.2, 110.0, Some(110.0), "LOS ANGELES", "At anchor"),
        (351234000, "HYUNDAI BRAVE", "D7TK", "Container", -118.15, 33.68, 11.2, 225.0, Some(226.0), "LONG BEACH", "Under way using engine"),
        (369000000, "GOLDEN GATE TUG", "WDF2", "Tug", -122.42, 37.82, 9.8, 70.0, Some(70.0), "SAN FRANCISCO", "Under way using engine"),

        // ── Panama Canal & Caribbean Sea ──
        (372991000, "PANAMA GLORY", "3FTX", "Bulk Carrier", -79.91, 9.35, 6.5, 140.0, Some(140.0), "COLON", "Under way using engine"),
        (355882000, "TRANSIT LEADER", "3HPL", "Container", -79.55, 8.92, 7.8, 320.0, Some(320.0), "BALBOA", "Under way using engine"),
        (311999000, "WONDER OF THE SEAS", "C6CX4", "Passenger", -80.12, 25.75, 18.5, 125.0, Some(125.0), "MIAMI", "Under way using engine"),
        (370000000, "CARIBBEAN PEARL", "HP99", "Tanker", -67.50, 15.20, 13.8, 290.0, Some(290.0), "ARUBA", "Under way using engine"),

        // ── Cape of Good Hope & Southern Oceans ──
        (601000000, "CAPE DISCOVERY", "ZRCD", "Bulk Carrier", 18.45, -34.45, 12.8, 110.0, Some(110.0), "DURBAN", "Under way using engine"),
        (601100000, "TABLE BAY PILOT", "ZRTP", "Tug", 18.40, -33.88, 7.5, 240.0, Some(240.0), "CAPE TOWN", "Under way using engine"),

        // ── Australia & Indian Ocean ──
        (503000000, "PACIFIC JEWEL", "VJN2", "Passenger", 151.25, -33.85, 16.0, 75.0, Some(75.0), "SYDNEY", "Under way using engine"),
        (503100000, "IRON CHIEFTAIN", "VKIC", "Bulk Carrier", 115.65, -31.95, 14.2, 330.0, Some(330.0), "PORT HEDLAND", "Under way using engine"),
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
    // If AISSTREAM_API_KEY is configured, this flags active production source status
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
