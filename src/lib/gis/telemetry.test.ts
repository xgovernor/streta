import { describe, expect, it } from "bun:test";
import {
  earthquakeTargetsToFeatures,
  fetchLiveEarthquakes,
  fetchLiveFlights,
  fetchLiveSatellites,
  flightTargetsToFeatures,
  getEmitterCategoryLabel,
  satelliteTargetsToFeatures,
} from "./tiledBackend";
import { useTelemetryStore } from "../../state/telemetryStore";
import {
  filterEarthquakesForReplay,
  filterFiresForReplay,
  recordVesselFix,
  replayVesselPositions,
} from "../../state/telemetryStore";

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

  it("decodes ICAO DO-260B aircraft emitter categories accurately", () => {
    expect(getEmitterCategoryLabel(2)).toBe("Light (< 15,500 lbs)");
    expect(getEmitterCategoryLabel(4)).toBe("Large (75,000–300,000 lbs)");
    expect(getEmitterCategoryLabel(6)).toBe("Heavy (> 300,000 lbs)");
    expect(getEmitterCategoryLabel(8)).toBe("Rotorcraft / Helicopter");
    expect(getEmitterCategoryLabel(14)).toBe("UAV / Drone");
    expect(getEmitterCategoryLabel(99)).toBe("Unknown");
  });

  it("interpolates AIS vessels onto a queried instant from recorded session fixes", async () => {
    const target = {
      mmsi: 811111111,
      name: "TEST VESSEL",
      callsign: "TSV1",
      shipType: "Container",
      lon: 1.0,
      lat: 50.0,
      speedKnots: 15,
      courseDeg: 90,
      destination: "TEST",
      status: "Under way using engine",
      simulated: true,
    };

    const base = Date.now() - 40_000;
    recordVesselFix({ ...target, lon: 1.0 }, base);
    recordVesselFix({ ...target, lon: 2.0 }, base + 20_000);

    const midway = replayVesselPositions(base + 10_000);
    const replayed = midway.find((vessel) => vessel.mmsi === 811111111);
    expect(replayed).toBeDefined();
    expect(replayed!.lon).toBeCloseTo(1.5, 5);
    expect(replayed!.courseDeg).toBeCloseTo(90, 1);
    // The replayed fix is stamped with the queried instant, not "now".
    expect(replayed!.lastContactEpoch).toBe(Math.round((base + 10_000) / 1000));

    // Before the first fix: nothing to show — never invent positions.
    expect(
      replayVesselPositions(base - 10_000).find((v) => v.mmsi === 811111111),
    ).toBeUndefined();

    // More than 30 s past the newest fix: outside the interpolation horizon.
    expect(
      replayVesselPositions(base + 90_000).find((v) => v.mmsi === 811111111),
    ).toBeUndefined();
  });

  it("filters replayed earthquake and fire event layers by occurrence time", () => {
    const asOf = Date.parse("2026-10-30T12:00:00Z");
    const earthquakes = [
      { id: "past", place: "X", magnitude: 6, time: asOf - 60_000, longitude: 0, latitude: 0, depthKm: 10, significance: 650, tsunami: 0 },
      { id: "future", place: "Y", magnitude: 6, time: asOf + 60_000, longitude: 0, latitude: 0, depthKm: 10, significance: 650, tsunami: 0 },
      { id: "unknown", place: "Z", magnitude: 5, time: 0, longitude: 0, latitude: 0, depthKm: 10, significance: 500, tsunami: 0 },
    ];
    expect(filterEarthquakesForReplay(earthquakes, asOf).map((q) => q.id)).toEqual([
      "past",
      "unknown",
    ]);

    const fires = [
      { id: "seen", lon: 0, lat: 0, brightnessK: 320, frpMw: 10, confidence: "n", acqDate: "2026-10-30", acqTime: "1155", satellite: "VIIRS", dayNight: "D" },
      { id: "later", lon: 1, lat: 1, brightnessK: 320, frpMw: 10, confidence: "n", acqDate: "2026-10-30", acqTime: "1210", satellite: "VIIRS", dayNight: "D" },
      { id: "untimed", lon: 2, lat: 2, brightnessK: 320, frpMw: 10, confidence: "n", acqDate: "", acqTime: "", satellite: "VIIRS", dayNight: "D" },
    ];
    expect(filterFiresForReplay(fires, asOf).map((f) => f.id)).toEqual([
      "seen",
      "untimed",
    ]);
  });

  it("routes AIS vessel stamps through the replayed store snapshot during a scrub", async () => {
    const store = useTelemetryStore.getState();

    // Feeds are lazy by default: this test opts into the AIS dataset, then
    // loads exactly what it enabled.
    store.setFeedEnabled("vessels", true);
    try {
      await store.refreshFeeds();

      const live = useTelemetryStore.getState().vessels;
      expect(live.length).toBeGreaterThan(0);
      // Client-stamped at receipt: every live vessel carries a fix time now.
      for (const vessel of live) {
        expect(vessel.lastContactEpoch).toBeGreaterThan(0);
      }

      // Scrub to ~30 s back: replayed vessels may narrow, but stay inside the
      // fixes recorded during this test session.
      store.setAsOf(Date.now() - 25_000);
      const replayedState = useTelemetryStore.getState();
      expect(replayedState.displayedVessels).not.toBeNull();
      for (const vessel of replayedState.displayedVessels!) {
        expect(vessel.lastContactEpoch).toBe(
          Math.round((Date.now() - 25_000) / 1000),
        );
      }

      // Return to live clears every replay snapshot.
      store.setAsOf(null);
      const cleared = useTelemetryStore.getState();
      expect(cleared.displayedVessels).toBeNull();
      expect(cleared.displayedFlights).toBeNull();
      expect(cleared.displayedEarthquakes).toBeNull();
      expect(cleared.displayedFires).toBeNull();
    } finally {
      useTelemetryStore.getState().setFeedEnabled("vessels", false);
    }
  });
});
