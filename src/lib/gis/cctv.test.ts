import { describe, expect, test } from "bun:test";
import {
  buildViewshedPolygon,
  computeTotalElevation,
  mapCctvProperties,
  offsetCoordinate,
  resolveSnapshotUrl,
} from "./cctv";

describe("computeTotalElevation", () => {
  test("adds ground elevation and mount height", () => {
    expect(computeTotalElevation(143.85, 8)).toBe(151.85);
    expect(computeTotalElevation(100.123, 10)).toBe(110.12);
  });

  test("returns null when ground elevation is null or invalid", () => {
    expect(computeTotalElevation(null, 8)).toBeNull();
    expect(computeTotalElevation(undefined, 8)).toBeNull();
    expect(computeTotalElevation(Number.NaN, 8)).toBeNull();
  });

  test("defaults mount height to 0 if missing or invalid", () => {
    expect(computeTotalElevation(143.85, null)).toBe(143.85);
    expect(computeTotalElevation(143.85, Number.NaN)).toBe(143.85);
  });
});

describe("offsetCoordinate", () => {
  test("projects a coordinate along North (0 deg)", () => {
    const [lon, lat] = offsetCoordinate(0, 0, 0, 1000);
    expect(lon).toBeCloseTo(0, 4);
    // 1000m on earth is ~0.00899 degrees of latitude
    expect(lat).toBeGreaterThan(0.008);
    expect(lat).toBeLessThan(0.01);
  });

  test("projects a coordinate along East (90 deg)", () => {
    const [lon, lat] = offsetCoordinate(0, 0, 90, 1000);
    expect(lat).toBeCloseTo(0, 4);
    expect(lon).toBeGreaterThan(0.008);
  });
});

describe("buildViewshedPolygon", () => {
  test("builds a closed polygon ring", () => {
    const coords = buildViewshedPolygon(-97.7431, 30.2672, 90, 60, 200);
    expect(Array.isArray(coords)).toBe(true);
    expect(coords.length).toBe(1); // One exterior ring
    const ring = coords[0];
    expect(ring.length).toBeGreaterThan(5);
    // Closed ring: first point equals last point
    expect(ring[0][0]).toBe(ring[ring.length - 1][0]);
    expect(ring[0][1]).toBe(ring[ring.length - 1][1]);
    expect(ring[0][0]).toBe(-97.7431);
    expect(ring[0][1]).toBe(30.2672);
  });

  test("clamps extreme FOV and range values safely", () => {
    const coords = buildViewshedPolygon(10, 20, 180, 500, 100000);
    const ring = coords[0];
    expect(ring[0][0]).toBe(10);
    expect(ring[0][1]).toBe(20);
    expect(ring[ring.length - 1][0]).toBe(10);
  });
});

describe("resolveSnapshotUrl", () => {
  test("returns trimmed URL unchanged without cacheBust", () => {
    expect(resolveSnapshotUrl("  https://example.com/cam.jpg  ")).toBe(
      "https://example.com/cam.jpg",
    );
    expect(resolveSnapshotUrl(null)).toBeNull();
    expect(resolveSnapshotUrl("")).toBeNull();
  });

  test("appends timestamp when cacheBust is requested", () => {
    const url = resolveSnapshotUrl("https://example.com/cam.jpg", true);
    expect(url).toContain("https://example.com/cam.jpg?_t=");
  });

  test("appends & instead of ? if URL already has query parameters", () => {
    const url = resolveSnapshotUrl("https://example.com/cam?id=123", true);
    expect(url).toContain("https://example.com/cam?id=123&_t=");
  });
});

describe("mapCctvProperties", () => {
  test("maps extended CCTV schema properties with 3x3 supports", () => {
    const source = {
      name: "Congress / 6th",
      city: "Austin",
      provider: "Austin Transportation",
      mount_ground_m: 143.5,
      mount_height_m: 10,
      total_elevation_m: 153.5,
      heading_deg: 45,
      pitch_deg: -18,
      fov_deg: 56,
      range_m: 200,
      snapshot_url: "https://example.com/frame.jpg",
      status: "ok",
      support_bl: 140.2,
      support_mc: 144.1,
      support_tr: 146.8,
    };

    const props = mapCctvProperties(source, "cam-101");
    expect(props.name).toBe("Congress / 6th");
    expect(props.city).toBe("Austin");
    expect(props.provider).toBe("Austin Transportation");
    expect(props.mount_ground_m).toBe(143.5);
    expect(props.mount_height_m).toBe(10);
    expect(props.total_elevation_m).toBe(153.5);
    expect(props.heading_deg).toBe(45);
    expect(props.snapshot_url).toBe("https://example.com/frame.jpg");
    expect(props.support_bl).toBe(140.2);
    expect(props.support_mc).toBe(144.1);
    expect(props.support_tr).toBe(146.8);
    expect(props.support_bm).toBeNull();
  });

  test("falls back to id if name is missing", () => {
    const props = mapCctvProperties({}, "cam-fallback");
    expect(props.name).toBe("cam-fallback");
  });
});
