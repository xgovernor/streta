export interface GeolocationResult {
  longitude: number;
  latitude: number;
  accuracy?: number;
  placeName?: string;
  source: "gps" | "ip";
}

/**
 * Attempts IP-based network geolocation lookup via CORS-friendly public endpoints.
 */
export async function lookupIpLocation(): Promise<GeolocationResult | null> {
  // Primary: ipwho.is (fast, high precision, CORS-enabled)
  try {
    const res = await fetch("https://ipwho.is/", {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      if (
        data.success &&
        typeof data.longitude === "number" &&
        typeof data.latitude === "number"
      ) {
        const place = [data.city, data.country].filter(Boolean).join(", ");
        return {
          longitude: data.longitude,
          latitude: data.latitude,
          accuracy: 3000,
          placeName: place || undefined,
          source: "ip",
        };
      }
    }
  } catch {
    // try fallback
  }

  // Fallback: get.geojs.io
  try {
    const res = await fetch("https://get.geojs.io/v1/ip/geo.json", {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      const lon = parseFloat(data.longitude);
      const lat = parseFloat(data.latitude);
      if (!Number.isNaN(lon) && !Number.isNaN(lat)) {
        const place = [data.city, data.country].filter(Boolean).join(", ");
        return {
          longitude: lon,
          latitude: lat,
          accuracy: 5000,
          placeName: place || undefined,
          source: "ip",
        };
      }
    }
  } catch {
    // network unavailable
  }

  return null;
}

/**
 * High-reliability geolocation resolver:
 * 1. Queries browser / device GPS via navigator.geolocation (with 3.5s timeout).
 * 2. If denied, unavailable (e.g. Linux without Geoclue2), or timed out,
 *    transparently falls back to IP network geolocation.
 */
export async function resolveCurrentLocation(): Promise<GeolocationResult | null> {
  if (typeof navigator !== "undefined" && "geolocation" in navigator) {
    try {
      const gpsPromise = new Promise<GeolocationResult | null>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            resolve({
              longitude: pos.coords.longitude,
              latitude: pos.coords.latitude,
              accuracy: pos.coords.accuracy,
              source: "gps",
            });
          },
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 3500, maximumAge: 30000 }
        );
      });

      const gpsResult = await Promise.race([
        gpsPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3600)),
      ]);

      if (gpsResult) {
        return gpsResult;
      }
    } catch {
      // ignore and fall back to IP
    }
  }

  // Fallback to IP geolocation
  return lookupIpLocation();
}
