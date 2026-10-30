/**
 * Estimated voyage-route geometry for AIS vessel targets.
 *
 * AIS does not broadcast the sailed route, only a free-text destination port.
 * Industry practice (MarineTraffic / VesselFinder) renders the voyage estimate
 * as a great-circle (geodesic) line from the vessel's current fix to the
 * destination port, dashed to mark it as predicted rather than traveled.
 */

import { resolvePort } from "./ports";

const EARTH_RADIUS_NM = 3440.065;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function toRad(v: number): number {
  return v * DEG;
}

/**
 * Great-circle distance between two lon/lat pairs, in nautical miles.
 */
export function haversineNm(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const dφ = toRad(lat2 - lat1);
  const dλ = toRad(lon2 - lon1);
  const a =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Interpolates the great-circle arc between two lon/lat points (spherical
 * linear interpolation), sampled roughly every `stepDeg` degrees of arc and
 * split wherever the polyline crosses the antimeridian (two OpenLayers
 * segments instead of one line wrapped across the map).
 */
export function greatCircleSegments(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
  stepDeg = 2,
): number[][][] {
  const φ1 = toRad(lat1);
  const λ1 = toRad(lon1);
  const φ2 = toRad(lat2);
  const λ2 = toRad(lon2);

  const x1 = Math.cos(φ1) * Math.cos(λ1);
  const y1 = Math.cos(φ1) * Math.sin(λ1);
  const z1 = Math.sin(φ1);
  const x2 = Math.cos(φ2) * Math.cos(λ2);
  const y2 = Math.cos(φ2) * Math.sin(λ2);
  const z2 = Math.sin(φ2);

  const dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
  const omega = Math.acos(dot);
  // Near-identical or antipodal points: a single straight segment is the only
  // sane output (slerp degenerates at omega ≈ 0 and omega ≈ π).
  if (omega < toRad(stepDeg) || Math.PI - omega < toRad(0.5)) {
    return [[[lon1, lat1], [lon2, lat2]]];
  }

  const n = Math.max(2, Math.ceil(omega / toRad(stepDeg)));
  const sinOmega = Math.sin(omega);

  // Sample the arc with a continuous (unwrapped) longitude so a crossing of
  // the 180th meridian is a smooth walk past ±180 instead of a ±360 jump.
  const arc: number[][] = [[lon1, lat1]];
  let contLon = lon1;

  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const A = Math.sin((1 - t) * omega) / sinOmega;
    const B = Math.sin(t * omega) / sinOmega;
    const x = A * x1 + B * x2;
    const y = A * y1 + B * y2;
    const z = A * z1 + B * z2;
    let lon = Math.atan2(y, x) * RAD;
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD;

    // Pick the multiple-of-360 representation nearest the previous point.
    const delta = lon - contLon;
    if (delta > 180) lon -= 360;
    else if (delta < -180) lon += 360;
    contLon = lon;

    arc.push([lon, lat]);
  }

  // Walk the unwrapped polyline and split wherever it passes ±180, linearly
  // interpolating the crossing latitude; reopen on the mirrored side.
  const wrapLon = (lon: number) =>
    lon > 180 ? lon - 360 : lon < -180 ? lon + 360 : lon;
  const segments: number[][][] = [];
  let current: number[][] = [arc[0]];

  for (let i = 1; i < arc.length; i++) {
    const [aLon, aLat] = arc[i - 1];
    const [bLon, bLat] = arc[i];

    if (bLon > 180 || bLon < -180) {
      const crossing = bLon > 180 ? 180 : -180;
      const t = (crossing - aLon) / (bLon - aLon);
      const crossLat = aLat + t * (bLat - aLat);
      const mirrored = crossing === 180 ? -180 : 180;

      current.push([crossing, crossLat]);
      if (current.length > 1) segments.push(current);
      current = [[mirrored, crossLat]];
    }

    current.push([wrapLon(bLon), bLat]);
  }

  if (current.length > 1) segments.push(current);

  return segments;
}

export interface VoyageRouteInfo {
  /** Uppercase display label of the resolved destination port. */
  label: string;
  /** Destination port coordinates. */
  portLon: number;
  portLat: number;
  /** Great-circle distance vessel fix -> port, in nautical miles. */
  distanceNm: number;
  /** Estimated transit time at the vessel's speed (floor 12 kn), in days. */
  etaDays: number;
  /** Anti-meridian-safe polyline segments (each a lon/lat pair list). */
  segments: number[][][];
}

/** Dead-reckoning fallback when a vessel reports 0 knots but is still under way. */
const MIN_ETA_SPEED_KN = 12;

/**
 * Resolves the estimated voyage route for a vessel fix: destination string ->
 * port coordinate, great-circle arc, distance, ETA in days. Returns null when
 * the destination is empty or unrecognized (no line is drawn for unknowns).
 */
export function computeVoyageRoute(
  lon: number,
  lat: number,
  destination: string | null | undefined,
  speedKnots: number,
): VoyageRouteInfo | null {
  const resolved = resolvePort(destination);
  if (!resolved) return null;

  const { record, label } = resolved;
  const distanceNm = haversineNm(lon, lat, record.lon, record.lat);
  if (distanceNm < 1) return null; // Fix already at the port quay.

  const segments = greatCircleSegments(lon, lat, record.lon, record.lat);

  const effectiveSpeed = Math.max(speedKnots, MIN_ETA_SPEED_KN);
  const etaDays = distanceNm / effectiveSpeed / 24;

  return {
    label,
    portLon: record.lon,
    portLat: record.lat,
    distanceNm,
    etaDays,
    segments,
  };
}

/** Formats a route statistic line for the map label: "2,340 NM · ~4.9 D @ 19 KN". */
export function formatRouteStats(distanceNm: number, etaDays: number, speedKnots: number): string {
  const d = `${Math.round(distanceNm).toLocaleString("en-US")} NM`;
  const s = speedKnots > 0.5 ? ` @ ${Math.round(speedKnots)} KN` : "";
  const eta = etaDays < 1
    ? `~${Math.max(1, Math.round(etaDays * 24))} H`
    : `~${etaDays.toFixed(1)} D`;
  return `${d} · ETA ${eta}${s}`;
}
