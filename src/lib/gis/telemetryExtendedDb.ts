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
const MID_FLAG_MAP: Record<string, { country: string; emoji: string }> = {
  "201": { country: "Albania", emoji: "🇦🇱" },
  "205": { country: "Belgium", emoji: "🇧🇪" },
  "209": { country: "Cyprus", emoji: "🇨🇾" },
  "211": { country: "Germany", emoji: "🇩🇪" },
  "212": { country: "Cyprus", emoji: "🇨🇾" },
  "214": { country: "Moldova", emoji: "🇲🇩" },
  "215": { country: "Malta", emoji: "🇲🇹" },
  "218": { country: "Germany", emoji: "🇩🇪" },
  "219": { country: "Denmark", emoji: "🇩🇰" },
  "220": { country: "Denmark", emoji: "🇩🇰" },
  "224": { country: "Spain", emoji: "🇪🇸" },
  "225": { country: "Spain", emoji: "🇪🇸" },
  "226": { country: "France", emoji: "🇫🇷" },
  "227": { country: "France", emoji: "🇫🇷" },
  "228": { country: "France", emoji: "🇫🇷" },
  "230": { country: "Finland", emoji: "🇫🇮" },
  "231": { country: "Faroe Islands", emoji: "🇫🇴" },
  "232": { country: "United Kingdom", emoji: "🇬🇧" },
  "233": { country: "United Kingdom", emoji: "🇬🇧" },
  "234": { country: "United Kingdom", emoji: "🇬🇧" },
  "235": { country: "United Kingdom", emoji: "🇬🇧" },
  "236": { country: "Gibraltar", emoji: "🇬🇮" },
  "237": { country: "Greece", emoji: "🇬🇷" },
  "238": { country: "Croatia", emoji: "🇭🇷" },
  "239": { country: "Greece", emoji: "🇬🇷" },
  "240": { country: "Greece", emoji: "🇬🇷" },
  "242": { country: "Morocco", emoji: "🇲🇦" },
  "244": { country: "Netherlands", emoji: "🇳🇱" },
  "245": { country: "Netherlands", emoji: "🇳🇱" },
  "246": { country: "Netherlands", emoji: "🇳🇱" },
  "247": { country: "Italy", emoji: "🇮🇹" },
  "248": { country: "Malta", emoji: "🇲🇹" },
  "249": { country: "Malta", emoji: "🇲🇹" },
  "250": { country: "Ireland", emoji: "🇮🇪" },
  "253": { country: "Luxembourg", emoji: "🇱🇺" },
  "255": { country: "Madeira", emoji: "🇵🇹" },
  "256": { country: "Malta", emoji: "🇲🇹" },
  "257": { country: "Norway", emoji: "🇳🇴" },
  "258": { country: "Norway", emoji: "🇳🇴" },
  "259": { country: "Norway", emoji: "🇳🇴" },
  "261": { country: "Poland", emoji: "🇵🇱" },
  "263": { country: "Portugal", emoji: "🇵🇹" },
  "264": { country: "Romania", emoji: "🇷🇴" },
  "265": { country: "Sweden", emoji: "🇸🇪" },
  "266": { country: "Sweden", emoji: "🇸🇪" },
  "269": { country: "Switzerland", emoji: "🇨🇭" },
  "271": { country: "Turkey", emoji: "🇹🇷" },
  "272": { country: "Ukraine", emoji: "🇺🇦" },
  "273": { country: "Russia", emoji: "🇷🇺" },
  "303": { country: "Alaska", emoji: "🇺🇸" },
  "304": { country: "Antigua & Barbuda", emoji: "🇦🇬" },
  "305": { country: "Antigua & Barbuda", emoji: "🇦🇬" },
  "308": { country: "Bahamas", emoji: "🇧🇸" },
  "309": { country: "Bahamas", emoji: "🇧🇸" },
  "310": { country: "Bermuda", emoji: "🇧🇲" },
  "311": { country: "Bahamas", emoji: "🇧🇸" },
  "312": { country: "Belize", emoji: "🇧🇿" },
  "314": { country: "Barbados", emoji: "🇧🇧" },
  "316": { country: "Canada", emoji: "🇨🇦" },
  "319": { country: "Cayman Islands", emoji: "🇰🇾" },
  "321": { country: "Costa Rica", emoji: "🇨🇷" },
  "323": { country: "Cuba", emoji: "🇨🇺" },
  "325": { country: "Dominica", emoji: "🇩🇲" },
  "327": { country: "Dominican Rep.", emoji: "🇩🇴" },
  "338": { country: "United States", emoji: "🇺🇸" },
  "345": { country: "Mexico", emoji: "🇲🇽" },
  "351": { country: "Panama", emoji: "🇵🇦" },
  "352": { country: "Panama", emoji: "🇵🇦" },
  "353": { country: "Panama", emoji: "🇵🇦" },
  "354": { country: "Panama", emoji: "🇵🇦" },
  "355": { country: "Panama", emoji: "🇵🇦" },
  "356": { country: "Panama", emoji: "🇵🇦" },
  "357": { country: "Panama", emoji: "🇵🇦" },
  "366": { country: "United States", emoji: "🇺🇸" },
  "367": { country: "United States", emoji: "🇺🇸" },
  "368": { country: "United States", emoji: "🇺🇸" },
  "369": { country: "United States", emoji: "🇺🇸" },
  "370": { country: "Panama", emoji: "🇵🇦" },
  "371": { country: "Panama", emoji: "🇵🇦" },
  "372": { country: "Panama", emoji: "🇵🇦" },
  "373": { country: "Panama", emoji: "🇵🇦" },
  "375": { country: "St. Vincent", emoji: "🇻🇨" },
  "376": { country: "St. Vincent", emoji: "🇻🇨" },
  "377": { country: "St. Vincent", emoji: "🇻🇨" },
  "412": { country: "China", emoji: "🇨🇳" },
  "413": { country: "China", emoji: "🇨🇳" },
  "414": { country: "China", emoji: "🇨🇳" },
  "416": { country: "Taiwan", emoji: "🇹🇼" },
  "419": { country: "India", emoji: "🇮🇳" },
  "431": { country: "Japan", emoji: "🇯🇵" },
  "432": { country: "Japan", emoji: "🇯🇵" },
  "440": { country: "South Korea", emoji: "🇰🇷" },
  "441": { country: "South Korea", emoji: "🇰🇷" },
  "477": { country: "Hong Kong", emoji: "🇭🇰" },
  "503": { country: "Australia", emoji: "🇦🇺" },
  "512": { country: "New Zealand", emoji: "🇳🇿" },
  "525": { country: "Indonesia", emoji: "🇮🇩" },
  "538": { country: "Marshall Islands", emoji: "🇲🇭" },
  "548": { country: "Philippines", emoji: "🇵🇭" },
  "563": { country: "Singapore", emoji: "🇸🇬" },
  "564": { country: "Singapore", emoji: "🇸🇬" },
  "565": { country: "Singapore", emoji: "🇸🇬" },
  "566": { country: "Singapore", emoji: "🇸🇬" },
  "636": { country: "Liberia", emoji: "🇱🇷" },
  "637": { country: "Liberia", emoji: "🇱🇷" },
  "657": { country: "Nigeria", emoji: "🇳🇬" },
  "710": { country: "Brazil", emoji: "🇧🇷" },
};

export function resolveVesselFlag(mmsi: number): string {
  const mmsiStr = String(mmsi).padStart(9, "0");
  const mid = mmsiStr.slice(0, 3);
  return MID_FLAG_MAP[mid]?.country || "International / Unknown";
}

export function resolveVesselFlagDetails(mmsi: number): { country: string; emoji: string } {
  const mmsiStr = String(mmsi).padStart(9, "0");
  const mid = mmsiStr.slice(0, 3);
  return MID_FLAG_MAP[mid] || { country: "International / Unknown", emoji: "🌐" };
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
