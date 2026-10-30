import { describe, expect, it, mock } from "bun:test";
import { lookupIpLocation, resolveCurrentLocation } from "./geolocation";

describe("geolocation resolver", () => {
  it("resolves location from primary IP service (ipwho.is)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("ipwho.is")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              longitude: 91.872,
              latitude: 24.899,
              city: "Sylhet",
              country: "Bangladesh",
            }),
            { status: 200 }
          )
        );
      }
      return Promise.reject(new Error("not found"));
    }) as any;

    try {
      const result = await lookupIpLocation();
      expect(result).not.toBeNull();
      expect(result?.longitude).toBe(91.872);
      expect(result?.latitude).toBe(24.899);
      expect(result?.placeName).toBe("Sylhet, Bangladesh");
      expect(result?.source).toBe("ip");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to secondary IP service (geojs.io) if primary fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("ipwho.is")) {
        return Promise.reject(new Error("Network failure"));
      }
      if (urlStr.includes("geojs.io")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              longitude: "90.4267",
              latitude: "23.7529",
              city: "Dhaka",
              country: "Bangladesh",
            }),
            { status: 200 }
          )
        );
      }
      return Promise.reject(new Error("not found"));
    }) as any;

    try {
      const result = await lookupIpLocation();
      expect(result).not.toBeNull();
      expect(result?.longitude).toBe(90.4267);
      expect(result?.latitude).toBe(23.7529);
      expect(result?.placeName).toBe("Dhaka, Bangladesh");
      expect(result?.source).toBe("ip");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("resolves current location via fallback when navigator.geolocation is missing or fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            longitude: 91.872,
            latitude: 24.899,
            city: "Sylhet",
            country: "Bangladesh",
          }),
          { status: 200 }
        )
      );
    }) as any;

    try {
      const result = await resolveCurrentLocation();
      expect(result).not.toBeNull();
      expect(result?.longitude).toBe(91.872);
      expect(result?.latitude).toBe(24.899);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
