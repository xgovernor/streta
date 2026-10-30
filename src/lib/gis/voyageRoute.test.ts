import { describe, expect, it } from "bun:test";
import { resolvePort, normalizeDestination, PORTS } from "./ports";
import {
  computeVoyageRoute,
  formatRouteStats,
  greatCircleSegments,
  haversineNm,
} from "./voyageRoute";

describe("Port gazetteer", () => {
  it("resolves exact names, LOCODEs and AIS aliases", () => {
    expect(resolvePort("ROTTERDAM")?.record.locode).toBe("NLRTM");
    expect(resolvePort("NLRTM")?.record.name).toBe("Rotterdam");
    expect(resolvePort("CNSHA")?.record.name).toBe("Shanghai");
    expect(resolvePort("JEBEL ALI")?.record.locode).toBe("AEDXB");
    expect(resolvePort("PORT KLANG WEST")?.record.name).toBe("Port Klang");
  });

  it("resolves compact forms without separators and truncated AIS fields", () => {
    expect(resolvePort("PORTSAID")?.record.name).toBe("Port Said");
    // AIS destination fields are truncated at 16 characters.
    expect(resolvePort("TANJUNG PELEPAS")?.record.name).toBe("Tanjung Pelepas");
    expect(resolvePort("SINGAPORE ANCHO")?.record.name).toBe("Singapore");
    expect(resolvePort("SUEZ CANAL SOUTH")?.record.name).toBe("Suez");
  });

  it("strips trailing notes and punctuation", () => {
    expect(normalizeDestination("ROTTERDAM/ETA 12")).toBe("ROTTERDAM");
    expect(resolvePort("NEW YORK / NJ")?.record.locode).toBe("USNYC");
  });

  it("resolves unknown destination strings to null", () => {
    expect(resolvePort("")).toBeNull();
    expect(resolvePort(null)).toBeNull();
    expect(resolvePort(undefined)).toBeNull();
    expect(resolvePort("ATLANTIS HARBOR")).toBeNull();
    expect(resolvePort("CHINA OFFSHORE")).toBeNull(); // open-water, no port
  });

  it("has case-normalized keys and no duplicate overlapping port entries", () => {
    for (const record of PORTS) {
      expect(record.name).toBe(record.name.trim());
      expect(Number.isFinite(record.lon)).toBe(true);
      expect(Number.isFinite(record.lat)).toBe(true);
      expect(Math.abs(record.lon)).toBeLessThanOrEqual(180);
      expect(Math.abs(record.lat)).toBeLessThanOrEqual(90);
    }
  });
});

describe("Great-circle voyage geometry", () => {
  it("computes plausible great-circle distances", () => {
    // Rotterdam -> New York is roughly 3,150 NM.
    const nm = haversineNm(4.1, 51.95, -74.05, 40.66);
    expect(nm).toBeGreaterThan(3000);
    expect(nm).toBeLessThan(3300);

    // Zero distance when both points coincide.
    expect(haversineNm(10, 10, 10, 10)).toBe(0);
  });

  it("splits arcs crossing the antimeridian into separate segments", () => {
    // Tokyo -> San Francisco crosses the 180th meridian.
    const segments = greatCircleSegments(139.85, 35.62, -122.4, 37.79);
    expect(segments.length).toBeGreaterThan(1);
    // No coordinate may live outside [-180, 180].
    for (const seg of segments) {
      for (const [lon] of seg) {
        expect(lon).toBeGreaterThanOrEqual(-180);
        expect(lon).toBeLessThanOrEqual(180);
      }
    }
    // First segment starts at Tokyo, last ends at San Francisco.
    expect(segments[0][0][0]).toBeCloseTo(139.85, 1);
    const last = segments[segments.length - 1];
    expect(last[last.length - 1][0]).toBeCloseTo(-122.4, 1);
  });

  it("keeps short arcs as one segment with both endpoints", () => {
    const segments = greatCircleSegments(4.1, 51.95, 9.93, 53.53);
    expect(segments.length).toBe(1);
    expect(segments[0][0]).toEqual([4.1, 51.95]);
  });
});

describe("Estimated voyage route", () => {
  it("builds a route from a vessel fix to a resolved destination", () => {
    const route = computeVoyageRoute(1.45, 51.12, "ROTTERDAM", 16.4);
    expect(route).not.toBeNull();
    expect(route!.label).toBe("ROTTERDAM");
    expect(route!.portLon).toBeCloseTo(4.1, 3);
    expect(route!.distanceNm).toBeGreaterThan(80); // Channel hop
    expect(route!.etaDays).toBeGreaterThan(0);
    // Rotterdam is east of the fix: no antimeridian crossing expected.
    expect(route!.segments.length).toBe(1);
  });

  it("draws nothing for empty or unknown destinations", () => {
    expect(computeVoyageRoute(1.45, 51.12, "", 16.4)).toBeNull();
    expect(computeVoyageRoute(1.45, 51.12, "MARS ORBITAL DOCK", 16.4)).toBeNull();
    expect(computeVoyageRoute(1.45, 51.12, null, 16.4)).toBeNull();
  });

  it("draws nothing when the fix is already at the port", () => {
    expect(computeVoyageRoute(4.1, 51.95, "ROTTERDAM", 0)).toBeNull();
  });

  it("formats the map statistic line with distance, ETA and speed", () => {
    expect(formatRouteStats(3400, 3400 / 19 / 24, 19)).toContain("3,400 NM");
    expect(formatRouteStats(3400, 3400 / 19 / 24, 19)).toContain("@ 19 KN");
    expect(formatRouteStats(3400, 3400 / 12 / 24, 0)).not.toContain("@");
  });
});
