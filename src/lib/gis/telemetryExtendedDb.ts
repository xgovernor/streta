/**
 * Telemetry Extended Intelligence Database Client
 *
 * Integrates open, real-time public online databases:
 *  - HexDB.io v2: Real-time aircraft specifications, airline operators, registrations,
 *    high-resolution airframe photographs, and flight routes (origin/destination airports).
 *  - CelesTrak GP: Satellite COSPAR catalog metadata, apogee, perigee, inclination, and orbital period.
 *  - Maritime MID: Decodes ITU Maritime Identification Digits to vessel flag states.
 */

export interface AircraftExtendedDetails {
  hex: string;
  registration?: string;
  manufacturer?: string;
  type?: string;
  icaoTypeCode?: string;
  registeredOwner?: string;
  operatorFlagCode?: string;
  imageThumbnailUrl?: string;
  imageFullUrl?: string;
  route?: {
    callsign: string;
    originAirport?: {
      iata?: string;
      icao?: string;
      name?: string;
      country?: string;
    };
    destinationAirport?: {
      iata?: string;
      icao?: string;
      name?: string;
      country?: string;
    };
  };
}

export interface SatelliteExtendedDetails {
  noradId: number;
  objectName: string;
  objectId: string; // COSPAR ID e.g. "1998-067A"
  epoch: string;
  inclinationDeg: number;
  periodMinutes: number;
  apogeeKm?: number;
  perigeeKm?: number;
  revolutions: number;
  bstar: number;
}

export interface VesselExtendedDetails {
  mmsi: number;
  name?: string;
  flagCountry: string;
  flagCode?: string;
  shipType: string;
  destination?: string;
  callsign?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory LRU-Style Cache with 1-Hour TTL
// ─────────────────────────────────────────────────────────────────────────────
const aircraftCache = new Map<string, { data: AircraftExtendedDetails; expires: number }>();
const satelliteCache = new Map<number, { data: SatelliteExtendedDetails; expires: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─────────────────────────────────────────────────────────────────────────────
// Maritime Identification Digits (MID) ITU Flag State Resolver
// ─────────────────────────────────────────────────────────────────────────────
const MID_COUNTRY_MAP: Record<string, string> = {
  "201": "Albania", "205": "Belgium", "209": "Cyprus", "211": "Germany",
  "212": "Cyprus", "214": "Moldova", "215": "Malta", "218": "Germany",
  "219": "Denmark", "220": "Denmark", "224": "Spain", "225": "Spain",
  "226": "France", "227": "France", "228": "France", "230": "Finland",
  "231": "Faroe Islands", "232": "United Kingdom", "233": "United Kingdom",
  "234": "United Kingdom", "235": "United Kingdom", "236": "Gibraltar",
  "237": "Greece", "238": "Croatia", "239": "Greece", "240": "Greece",
  "242": "Morocco", "244": "Netherlands", "245": "Netherlands",
  "246": "Netherlands", "247": "Italy", "248": "Malta", "249": "Malta",
  "250": "Ireland", "253": "Luxembourg", "255": "Madeira", "256": "Malta",
  "257": "Norway", "258": "Norway", "259": "Norway", "261": "Poland",
  "263": "Portugal", "264": "Romania", "265": "Sweden", "266": "Sweden",
  "269": "Switzerland", "271": "Turkey", "272": "Ukraine", "273": "Russia",
  "303": "Alaska", "304": "Antigua & Barbuda", "305": "Antigua & Barbuda",
  "308": "Bahamas", "309": "Bahamas", "310": "Bermuda", "311": "Bahamas",
  "312": "Belize", "314": "Barbados", "316": "Canada", "319": "Cayman Islands",
  "321": "Costa Rica", "323": "Cuba", "325": "Dominica", "327": "Dominican Rep.",
  "338": "United States", "345": "Mexico", "351": "Panama", "352": "Panama",
  "353": "Panama", "354": "Panama", "355": "Panama", "356": "Panama",
  "357": "Panama", "366": "United States", "367": "United States",
  "368": "United States", "369": "United States", "370": "Panama",
  "371": "Panama", "372": "Panama", "373": "Panama", "375": "St. Vincent",
  "376": "St. Vincent", "377": "St. Vincent", "412": "China", "413": "China",
  "414": "China", "416": "Taiwan", "431": "Japan", "432": "Japan",
  "440": "South Korea", "441": "South Korea", "477": "Hong Kong",
  "503": "Australia", "512": "New Zealand", "525": "Indonesia",
  "538": "Marshall Islands", "548": "Philippines", "563": "Singapore",
  "564": "Singapore", "565": "Singapore", "566": "Singapore",
  "636": "Liberia", "637": "Liberia", "657": "Nigeria", "710": "Brazil",
};

export function resolveVesselFlag(mmsi: number): string {
  const mmsiStr = String(mmsi).padStart(9, "0");
  const mid = mmsiStr.slice(0, 3);
  return MID_COUNTRY_MAP[mid] || "International / Unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Aircraft Extended Details Fetcher (HexDB.io v2)
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchAircraftExtendedDetails(
  icao24: string,
  callsign?: string
): Promise<AircraftExtendedDetails | null> {
  const hex = icao24.trim().toLowerCase();
  const now = Date.now();

  const cached = aircraftCache.get(hex);
  if (cached && cached.expires > now) {
    return cached.data;
  }

  const details: AircraftExtendedDetails = { hex: hex.toUpperCase() };

  try {
    // 1. Fetch Aircraft Airframe Particulars
    const acPromise = fetch(`https://hexdb.io/api/v2/aircraft/${hex}`, {
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as any;
      })
      .catch(() => null);

    // 2. Fetch Flight Route if callsign is provided
    const cleanCallsign = (callsign || "").trim().toUpperCase();
    const routePromise =
      cleanCallsign.length >= 3
        ? fetch(`https://hexdb.io/api/v2/routes/${cleanCallsign}`, {
            headers: { Accept: "application/json" },
          })
            .then(async (res) => {
              if (!res.ok) return null;
              return (await res.json()) as any;
            })
            .catch(() => null)
        : Promise.resolve(null);

    const [acData, routeData] = await Promise.all([acPromise, routePromise]);

    if (acData && !acData.error) {
      details.registration = acData.registration || undefined;
      details.manufacturer = acData.manufacturer || undefined;
      details.type = acData.type || undefined;
      details.icaoTypeCode = acData.icao_type_code || undefined;
      details.registeredOwner = acData.registered_owner || undefined;
      details.operatorFlagCode = acData.operator_flag_code || undefined;
      if (acData.images) {
        details.imageThumbnailUrl = acData.images.thumbnail || undefined;
        details.imageFullUrl = acData.images.full || undefined;
      }
    }

    if (routeData && !routeData.error) {
      details.route = {
        callsign: cleanCallsign,
        originAirport: routeData.origin
          ? {
              iata: routeData.origin.iata,
              icao: routeData.origin.icao,
              name: routeData.origin.name,
              country: routeData.origin.country_code,
            }
          : undefined,
        destinationAirport: routeData.destination
          ? {
              iata: routeData.destination.iata,
              icao: routeData.destination.icao,
              name: routeData.destination.name,
              country: routeData.destination.country_code,
            }
          : undefined,
      };
    }

    // Cache the result
    aircraftCache.set(hex, { data: details, expires: now + CACHE_TTL_MS });
    return details;
  } catch (err) {
    console.warn("[ExtendedDb] fetchAircraftExtendedDetails failed:", err);
    return details;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Satellite Orbital Extended Details Fetcher (CelesTrak GP JSON)
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchSatelliteExtendedDetails(
  noradId: number
): Promise<SatelliteExtendedDetails | null> {
  const now = Date.now();
  const cached = satelliteCache.get(noradId);
  if (cached && cached.expires > now) {
    return cached.data;
  }

  try {
    const res = await fetch(
      `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=JSON`
    );
    if (!res.ok) return null;
    const records = (await res.json()) as any[];
    if (!Array.isArray(records) || records.length === 0) return null;

    const gp = records[0];
    const meanMotion = parseFloat(gp.MEAN_MOTION) || 1.0;
    const periodMinutes = (24 * 60) / meanMotion;
    const ecc = parseFloat(gp.ECCENTRICITY) || 0.0;

    // Approximate semi-major axis using Kepler's 3rd law: a = (mu / (n^2))^(1/3)
    // where mu = 398600.4418 km^3/s^2, n in rad/s = meanMotion * 2*pi / 86400
    const nRadSec = (meanMotion * 2 * Math.PI) / 86400;
    const smaKm = Math.cbrt(398600.4418 / (nRadSec * nRadSec));
    const earthRadiusKm = 6378.137;
    const apogeeKm = Math.round(smaKm * (1 + ecc) - earthRadiusKm);
    const perigeeKm = Math.round(smaKm * (1 - ecc) - earthRadiusKm);

    const details: SatelliteExtendedDetails = {
      noradId: parseInt(gp.NORAD_CAT_ID, 10) || noradId,
      objectName: gp.OBJECT_NAME || `SAT-${noradId}`,
      objectId: gp.OBJECT_ID || "",
      epoch: gp.EPOCH || "",
      inclinationDeg: parseFloat(gp.INCLINATION) || 0,
      periodMinutes: Math.round(periodMinutes * 10) / 10,
      apogeeKm: Math.max(0, apogeeKm),
      perigeeKm: Math.max(0, perigeeKm),
      revolutions: parseInt(gp.REV_AT_EPOCH, 10) || 0,
      bstar: parseFloat(gp.BSTAR) || 0,
    };

    satelliteCache.set(noradId, { data: details, expires: now + CACHE_TTL_MS });
    return details;
  } catch (err) {
    console.warn("[ExtendedDb] fetchSatelliteExtendedDetails failed:", err);
    return null;
  }
}
