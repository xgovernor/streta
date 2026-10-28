import { isGeographic } from "./gis/crs";
import type { CoordinateFormat, Extent } from "./gis/types";

function direction(value: number, positive: string, negative: string): string {
  return value >= 0 ? positive : negative;
}

function decimal(value: number, degrees = 5): string {
  return `${Math.abs(value).toFixed(degrees)}°`;
}

function dms(value: number): string {
  const totalSeconds = Math.round(Math.abs(value) * 3600);
  const degrees = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${degrees}°${String(minutes).padStart(2, "0")}′${String(
    seconds,
  ).padStart(2, "0")}″`;
}

export function formatLat(lat: number, format: CoordinateFormat): string {
  const suffix = direction(lat, "N", "S");
  return `${format === "dms" ? dms(lat) : decimal(lat)} ${suffix}`;
}

export function formatLon(lon: number, format: CoordinateFormat): string {
  const suffix = direction(lon, "E", "W");
  return `${format === "dms" ? dms(lon) : decimal(lon)} ${suffix}`;
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    const kilometers = meters / 1000;
    return `${Number.isInteger(kilometers) ? kilometers : kilometers.toFixed(1)} km`;
  }

  return `${Math.round(meters)} m`;
}

export function formatScaleDenominator(metersPerPixel: number): string {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    return "—";
  }

  const denominator = (metersPerPixel * 96) / 0.0254;

  if (denominator >= 1_000_000) {
    return `1:${(denominator / 1_000_000).toFixed(1)}M`;
  }

  return `1:${Math.round(denominator / 1000) * 1000}`;
}

export function niceDistance(meters: number): number {
  if (meters <= 0) {
    return 1;
  }

  const magnitude = 10 ** Math.floor(Math.log10(meters));
  const normalized = meters / magnitude;
  const step =
    normalized >= 5 ? 5
    : normalized >= 2 ? 2
    : 1;

  return step * magnitude;
}

export function formatArea(squareMeters: number): string {
  if (!Number.isFinite(squareMeters) || squareMeters <= 0) {
    return "—";
  }

  if (squareMeters >= 1_000_000) {
    return `${(squareMeters / 1_000_000).toFixed(2)} km²`;
  }

  if (squareMeters >= 10_000) {
    return `${(squareMeters / 10_000).toFixed(2)} ha`;
  }

  return `${Math.round(squareMeters).toLocaleString("en-US")} m²`;
}

/**
 * Coordinate readout for the view projection: metres, grouped, without a unit
 * suffix so a pair of them stays compact in the footer.
 */
export function formatProjected(meters: number): string {
  if (!Number.isFinite(meters)) {
    return "—";
  }

  return meters.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function formatProjectedFull(meters: number): string {
  if (!Number.isFinite(meters)) {
    return "—";
  }

  return meters.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Bounding box of a layer, written in the units of its own CRS. */
export function formatExtent(extent: Extent | null, crs: string): string {
  if (!extent) {
    return "—";
  }

  const [minX, minY, maxX, maxY] = extent;

  if (isGeographic(crs)) {
    return `${minX.toFixed(3)}…${maxX.toFixed(3)}° · ${minY.toFixed(3)}…${maxY.toFixed(3)}°`;
  }

  return `${formatNumber(minX)}…${formatNumber(maxX)} m · ${formatNumber(minY)}…${formatNumber(maxY)} m`;
}

export function formatRotation(rotation: number): string {
  const degrees = (rotation * 180) / Math.PI;
  const normalized = ((degrees % 360) + 360) % 360;
  return `${normalized.toFixed(1)}°`;
}

export function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
