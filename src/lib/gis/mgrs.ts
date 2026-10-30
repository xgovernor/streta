import mgrs from "mgrs";

/**
 * Military Grid Reference System readout for a WGS 84 lon/lat pair.
 *
 * `digits` is the precision of the easting/northing: 1 → 10 km squares
 * ("33U UU 5 5"), 2 → 1 km, 3 → 100 m, 4 → 10 m, 5 → 1 m. The status bar and
 * popup readouts use 2 (1 km) — enough for verbal handover — while "go to"
 * entry should accept whatever the operator pastes.
 *
 * Returns null out to sea edge cases (mgrs throws for extreme latitudes and
 * the polar grids are not supported by the classic format we print).
 */
export function formatMGRS(lon: number, lat: number, digits: 1 | 2 | 3 | 4 | 5 = 2): string | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }

  try {
    const raw = mgrs.forward([lon, lat], digits) as string;
    // mgrs returns e.g. "18SUJ2306"; insert spaces so it reads
    // "18S UJ 23 06" the way it is spoken and written on briefing boards.
    const zone = raw.slice(0, 3);
    const rest = raw.slice(3);
    if (!/^\d{2}[A-Z]/.test(zone)) {
      return raw;
    }

    return [zone, ...rest.match(/.{1,2}/g) ?? []].join(" ");
  } catch {
    return null;
  }
}
