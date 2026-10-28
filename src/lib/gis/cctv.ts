import type { Attributes, AttributeValue } from "./types";

/** Earth radius in metres for geodesic offset calculations. */
const EARTH_RADIUS_M = 6371000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

export interface CctvSupports {
  bl: number | null;
  bm: number | null;
  br: number | null;
  ml: number | null;
  mc: number | null;
  mr: number | null;
  tl: number | null;
  tm: number | null;
  tr: number | null;
}

export interface CctvCameraRecord {
  id: string;
  name: string;
  city: string;
  provider: string;
  lat: number;
  lon: number;
  headingDeg: number | null;
  pitchDeg: number | null;
  fovDeg: number | null;
  rangeM: number | null;
  mountHeightM: number;
  mountGroundM: number | null;
  totalElevationM: number | null;
  snapshotUrl: string | null;
  status: string;
  supports?: CctvSupports | null;
}

/** Compute total elevation (mount ground height + camera mount height). */
export function computeTotalElevation(
  mountGroundM: number | null | undefined,
  mountHeightM: number | null | undefined,
): number | null {
  if (mountGroundM === null || mountGroundM === undefined || !Number.isFinite(mountGroundM)) {
    return null;
  }
  const height = mountHeightM && Number.isFinite(mountHeightM) ? mountHeightM : 0;
  return Number((mountGroundM + height).toFixed(2));
}

/**
 * Offset a [lon, lat] point by a distance in metres along a compass azimuth heading.
 * Uses great-circle destination point formulas.
 */
export function offsetCoordinate(
  lon: number,
  lat: number,
  bearingDeg: number,
  distanceM: number,
): [number, number] {
  const theta = toRad(bearingDeg);
  const delta = distanceM / EARTH_RADIUS_M;
  const phi1 = toRad(lat);
  const lambda1 = toRad(lon);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const sinDelta = Math.sin(delta);
  const cosDelta = Math.cos(delta);

  const sinPhi2 = sinPhi1 * cosDelta + cosPhi1 * sinDelta * Math.cos(theta);
  const phi2 = Math.asin(sinPhi2);

  const y = Math.sin(theta) * sinDelta * cosPhi1;
  const x = cosDelta - sinPhi1 * Math.sin(phi2);
  const lambda2 = lambda1 + Math.atan2(y, x);

  const normLon = ((toDeg(lambda2) + 540) % 360) - 180;
  return [Number(normLon.toFixed(6)), Number(toDeg(phi2).toFixed(6))];
}

/**
 * Build a closed polygon ring representing the horizontal camera viewshed wedge.
 * Sweeps from heading - fov/2 to heading + fov/2 at rangeM.
 * Returns GeoJSON coordinates format: `[[[lon, lat], ...]]`.
 */
export function buildViewshedPolygon(
  lon: number,
  lat: number,
  headingDeg: number,
  fovDeg = 50,
  rangeM = 150,
  numArcPoints = 12,
): [number, number][][] {
  const center = [Number(lon.toFixed(6)), Number(lat.toFixed(6))] as [number, number];
  const halfFov = Math.max(2, Math.min(160, fovDeg)) / 2;
  const clampedRange = Math.max(10, Math.min(5000, rangeM));
  const startAngle = headingDeg - halfFov;
  const endAngle = headingDeg + halfFov;

  const ring: [number, number][] = [center];

  for (let i = 0; i <= numArcPoints; i += 1) {
    const fraction = i / numArcPoints;
    const currentBearing = startAngle + fraction * (endAngle - startAngle);
    ring.push(offsetCoordinate(lon, lat, currentBearing, clampedRange));
  }

  // Close the ring back to the camera center
  ring.push(center);
  return [ring];
}

/**
 * Resolve a camera snapshot URL with optional cache-busting timestamp query parameter.
 */
export function resolveSnapshotUrl(
  url: string | null | undefined,
  cacheBust = false,
): string | null {
  if (!url || typeof url !== "string" || !url.trim()) {
    return null;
  }
  const clean = url.trim();
  if (!cacheBust) {
    return clean;
  }
  const separator = clean.includes("?") ? "&" : "?";
  return `${clean}${separator}_t=${Date.now()}`;
}

const textOrNull = (value: unknown): AttributeValue =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean" ?
    value
  : null;

/**
 * Maps raw source feature attributes into Strata's extended CCTV attribute schema.
 */
export function mapCctvProperties(
  source: Record<string, unknown>,
  id: string | null,
): Attributes {
  const mountGround = textOrNull(source.mount_ground_m);
  const mountHeight = textOrNull(source.mount_height_m);
  const totalElevation =
    source.total_elevation_m !== undefined && source.total_elevation_m !== null ?
      textOrNull(source.total_elevation_m)
    : (
      typeof mountGround === "number" && typeof mountHeight === "number" ?
        computeTotalElevation(mountGround, mountHeight)
      : null
    );

  return {
    name: textOrNull(source.name) ?? id,
    city: textOrNull(source.city),
    provider: textOrNull(source.provider),
    mount_ground_m: mountGround,
    mount_height_m: mountHeight,
    total_elevation_m: totalElevation,
    heading_deg: textOrNull(source.heading_deg),
    pitch_deg: textOrNull(source.pitch_deg),
    fov_deg: textOrNull(source.fov_deg),
    range_m: textOrNull(source.range_m),
    snapshot_url: textOrNull(source.snapshot_url),
    status: textOrNull(source.status) ?? "ok",
    support_bl: textOrNull(source.support_bl),
    support_bm: textOrNull(source.support_bm),
    support_br: textOrNull(source.support_br),
    support_ml: textOrNull(source.support_ml),
    support_mc: textOrNull(source.support_mc),
    support_mr: textOrNull(source.support_mr),
    support_tl: textOrNull(source.support_tl),
    support_tm: textOrNull(source.support_tm),
    support_tr: textOrNull(source.support_tr),
  };
}
