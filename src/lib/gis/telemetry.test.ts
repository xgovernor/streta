import { describe, expect, it } from "bun:test";
import {
  earthquakeTargetsToFeatures,
  fetchLiveEarthquakes,
  fetchLiveFlights,
  fetchLiveSatellites,
  flightTargetsToFeatures,
  satelliteTargetsToFeatures,
} from "./tiledBackend";
import { useTelemetryStore } from "../../state/telemetryStore";

describe("Phase 4 Live Telemetry & Feeds", () => {
  it("fetches active flight telemetry with valid spatial coordinates", async () => {
    const flights = await fetchLiveFlights();
    expect(Array.isArray(flights)).toBe(true);
    expect(flights.length).toBeGreaterThan(0);

    const first = flights[0];
    expect(typeof first.icao24).toBe("string");
    expect(typeof first.callsign).toBe("string");
    expect(typeof first.longitude).toBe("number");
    expect(typeof first.latitude).toBe("number");
    expect(first.longitude).toBeGreaterThanOrEqual(-180);
    expect(first.longitude).toBeLessThanOrEqual(180);
    expect(first.latitude).toBeGreaterThanOrEqual(-90);
    expect(first.latitude).toBeLessThanOrEqual(90);
    expect(first.altitudeMeters).toBeGreaterThanOrEqual(0);
  });

  it("fetches real-time seismic earthquake events with valid depths and magnitudes", async () => {
    const quakes = await fetchLiveEarthquakes(2.0);
    expect(Array.isArray(quakes)).toBe(true);
    expect(quakes.length).toBeGreaterThan(0);

    for (const eq of quakes) {
      expect(typeof eq.id).toBe("string");
      expect(typeof eq.place).toBe("string");
      expect(eq.magnitude).toBeGreaterThanOrEqual(1.0);
      expect(eq.depthKm).toBeGreaterThanOrEqual(0);
      expect(eq.longitude).toBeGreaterThanOrEqual(-180);
      expect(eq.longitude).toBeLessThanOrEqual(180);
    }
  });

  it("fetches orbital satellites with SGP4 calculated ground tracks", async () => {
    const satellites = await fetchLiveSatellites();
    expect(Array.isArray(satellites)).toBe(true);
    expect(satellites.length).toBeGreaterThanOrEqual(3);

    const iss = satellites.find((s) => s.noradId === 25544);
    expect(iss).toBeDefined();
    expect(iss!.name).toContain("ISS");
    expect(iss!.altitudeKm).toBeGreaterThan(300);
    expect(iss!.altitudeKm).toBeLessThan(600);
    expect(iss!.velocityKmh).toBeGreaterThan(25000);
    expect(iss!.groundTrack.length).toBeGreaterThan(10);

    for (const [lon, lat] of iss!.groundTrack) {
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
    }
  });

  it("telemetry Zustand store manages state and filtering correctly", async () => {
    const store = useTelemetryStore.getState();

    // Toggle feeds
    store.setFeedEnabled("flights", true);
    store.setFeedEnabled("earthquakes", true);
    store.setFeedEnabled("satellites", true);
    expect(useTelemetryStore.getState().flightsEnabled).toBe(true);

    // Refresh
    await store.refreshFeeds();
    const state = useTelemetryStore.getState();
    expect(state.flights.length).toBeGreaterThan(0);
    expect(state.earthquakes.length).toBeGreaterThan(0);
    expect(state.satellites.length).toBeGreaterThan(0);
    expect(state.lastUpdated).not.toBeNull();

    // Select target
    const targetFlight = state.flights[0];
    store.setSelectedTarget({ type: "flight", data: targetFlight });
    expect(useTelemetryStore.getState().selectedTarget?.type).toBe("flight");

    // Clear selection
    store.setSelectedTarget(null);
    expect(useTelemetryStore.getState().selectedTarget).toBeNull();
  });

  it("converts live telemetry targets into standard GIS FeatureRecord items for datasets panel", async () => {
    const store = useTelemetryStore.getState();
    await store.refreshFeeds();
    const { flights, earthquakes, satellites } = useTelemetryStore.getState();

    const flightFeatures = flightTargetsToFeatures(flights);
    expect(flightFeatures.length).toBe(flights.length);
    expect(flightFeatures[0].geometry.type).toBe("Point");
    expect(flightFeatures[0].properties.callsign).toBeDefined();

    const quakeFeatures = earthquakeTargetsToFeatures(earthquakes);
    expect(quakeFeatures.length).toBe(earthquakes.length);
    expect(quakeFeatures[0].geometry.type).toBe("Point");
    expect(typeof quakeFeatures[0].properties.magnitude).toBe("number");

    const satFeatures = satelliteTargetsToFeatures(satellites);
    expect(satFeatures.length).toBe(satellites.length);
    expect(satFeatures[0].geometry.type).toBe("Point");
    expect(satFeatures[0].properties.name).toBeDefined();
  });
});
