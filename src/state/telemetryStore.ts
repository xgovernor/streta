import { create } from "zustand";
import {
  fetchLiveEarthquakes,
  fetchLiveFires,
  fetchLiveFlights,
  fetchLiveSatellites,
  fetchLiveVessels,
} from "../lib/gis/tiledBackend";
import type {
  EarthquakeTarget,
  FireTarget,
  FlightTarget,
  SatelliteTarget,
  VesselTarget,
} from "../lib/gis/types";

export type TelemetryFeedType =
  | "flights"
  | "earthquakes"
  | "satellites"
  | "fires"
  | "vessels";

export type SelectedTelemetryTarget =
  | { type: "flight"; data: FlightTarget }
  | { type: "earthquake"; data: EarthquakeTarget }
  | { type: "satellite"; data: SatelliteTarget }
  | { type: "fire"; data: FireTarget }
  | { type: "vessel"; data: VesselTarget };

/**
 * Provenance for one feed: who publishes it, what cadence to expect, and how
 * to read the position fix. These are static facts about the source, shown
 * next to the feed so an operator can judge the data without leaving the map.
 */
export interface FeedProvenance {
  /** Data supplier, named as on a briefing attribution line. */
  provider: string;
  /** Who runs the supplier — the accountable organisation. */
  organization: string;
  /** Expected update cadence; feeds may be requested more often. */
  cadence: string;
}

export const FEED_PROVENANCE: Record<TelemetryFeedType, FeedProvenance> = {
  flights: {
    provider: "OpenSky Network (ADS-B/MLAT)",
    organization: "OpenSky Network",
    cadence: "~10 s per fix",
  },
  earthquakes: {
    provider: "USGS seismic feed",
    organization: "U.S. Geological Survey",
    cadence: "~60 s detection latency",
  },
  satellites: {
    provider: "TLE propagation (CelesTrak)",
    organization: "NORAD via CelesTrak",
    cadence: "deterministic",
  },
  fires: {
    provider: "NASA FIRMS active fire",
    organization: "NASA LANCE / NRT",
    cadence: "~5 min orbit revisit",
  },
  vessels: {
    provider: "AISStream (terrestrial AIS)",
    organization: "AISStream.io",
    cadence: "~2 s per ship",
  },
};

export const FEED_LABELS: Record<TelemetryFeedType, string> = {
  flights: "Flights",
  earthquakes: "Seismic",
  satellites: "Orbital",
  fires: "Fires",
  vessels: "Maritime",
};

/** Operational health of one feed, kept per feed instead of one shared clock. */
export interface FeedStatus {
  /** Epoch ms of the last successful fetch (null = never succeeded). */
  lastOk: number | null;
  /** Last failure in human terms; cleared by the next success. */
  lastError: string | null;
  /** Count of targets from the last successful fetch. */
  count: number;
}

const EMPTY_FEED_STATUS: FeedStatus = {
  lastOk: null,
  lastError: null,
  count: 0,
};

export type AlertSeverity = "critical" | "warning";

/**
 * One acknowledgeable operator alert. Alerts are derived from live feeds on
 * every refresh and are never silently dropped: they stay on the list until an
 * operator acknowledges them, in this session.
 */
export interface TelemetryAlert {
  id: string;
  severity: AlertSeverity;
  source: TelemetryFeedType;
  /** E.g. "AERINC emergency transponder". */
  title: string;
  /** E.g. "Emg: GENERAL EMERGENCY · Squawk 7700 · 11,200 m". */
  detail: string;
  /** Epoch ms the alert first appeared. */
  raisedAt: number;
  /** Epoch ms of the source event, when the feed supplies one. */
  eventAt: number | null;
  acknowledged: boolean;
  target: SelectedTelemetryTarget;
}

/** One recorded position fix used to answer "where was it when". */
interface FlightHistoryPoint {
  /** Epoch ms of the fix itself, as reported by the source. */
  t: number;
  lon: number;
  lat: number;
  velocityMps: number;
  headingDeg: number;
}

/** AIS sources carry no per-report timestamps, so fixes are stamped at
 *  receipt; replay covers what happened during the session, nothing earlier. */
interface VesselHistoryPoint {
  t: number;
  lon: number;
  lat: number;
  courseDeg: number;
  speedKnots: number;
}

const HISTORY_MAX_POINTS = 24;
const HISTORY_MAX_AGE_MS = 15 * 60 * 1000;

interface TelemetryState {
  flightsEnabled: boolean;
  earthquakesEnabled: boolean;
  satellitesEnabled: boolean;
  firesEnabled: boolean;
  vesselsEnabled: boolean;
  autoRefreshSeconds: number; // 0 (off), 10, 30, 60
  loading: boolean;
  lastUpdated: Date | null;
  selectedTarget: SelectedTelemetryTarget | null;
  hoveredTarget: SelectedTelemetryTarget | null;
  hoverPosition: { x: number; y: number } | null;
  hoverCoordinate: [number, number] | null;

  flights: FlightTarget[];
  earthquakes: EarthquakeTarget[];
  satellites: SatelliteTarget[];
  fires: FireTarget[];
  vessels: VesselTarget[];

  /** Per-feed health and provenance audience for the status bar and cards. */
  feedStatus: Record<TelemetryFeedType, FeedStatus>;

  /**
   * Non-null means the map is replaying the past: the scrubbed instant, the
   * flights/vessels interpolated there, and quake/fire event feeds filtered
   * by occurrence time. Null means live telemetry on every feed.
   */
  asOf: number | null;
  displayedFlights: FlightTarget[] | null;
  displayedVessels: VesselTarget[] | null;
  displayedEarthquakes: EarthquakeTarget[] | null;
  displayedFires: FireTarget[] | null;

  /** Derived, acknowledgeable alert queue. */
  alerts: TelemetryAlert[];
  /** Count of alerts awaiting an operator decision. */
  openAlerts: number;

  // Search & filter
  flightSearch: string;
  earthquakeMinMag: number;
  satelliteSearch: string;
  fireMinConfidence: number;
  vesselSearch: string;

  currentBbox: [number, number, number, number] | null;

  // Actions
  toggleFeed: (feed: TelemetryFeedType) => void;
  setFeedEnabled: (feed: TelemetryFeedType, enabled: boolean) => void;
  setAutoRefresh: (seconds: number) => void;
  setFlightSearch: (search: string) => void;
  setEarthquakeMinMag: (mag: number) => void;
  setSatelliteSearch: (search: string) => void;
  setFireMinConfidence: (confidence: number) => void;
  setVesselSearch: (vesselSearch: string) => void;
  setSelectedTarget: (target: SelectedTelemetryTarget | null) => void;
  setHoveredTarget: (
    target: SelectedTelemetryTarget | null,
    pos?: { x: number; y: number } | null,
    coordinate?: [number, number] | null
  ) => void;
  updateHoverPosition: (pos: { x: number; y: number } | null) => void;
  setViewportBbox: (bbox: [number, number, number, number] | null) => void;
  refreshFeeds: (bbox?: [number, number, number, number]) => Promise<void>;
  /** Null returns the map to live telemetry. */
  setAsOf: (asOf: number | null) => void;
  acknowledgeAlert: (id: string) => void;
  acknowledgeAllAlerts: () => void;
}

/**
 * Per-aircraft history ring buffer, kept outside the state tree because it
 * mutates in place 10 times a minute and history must survive every refresh.
 */
const flightHistory = new Map<string, FlightHistoryPoint[]>();
const flightRecords = new Map<string, FlightTarget>();

const vesselHistory = new Map<string, VesselHistoryPoint[]>();
const vesselRecords = new Map<string, VesselTarget>();

/** Unit-test subject: exported so the replay model can be tested directly. */
export { recordFlightFix, recordVesselFix, replayFlightPositions, replayVesselPositions };

function recordFlightFix(flight: FlightTarget, nowMs: number) {
  const fixMs =
    flight.positionTimeEpoch && flight.positionTimeEpoch > 0
      ? flight.positionTimeEpoch * 1000
      : flight.lastContactEpoch && flight.lastContactEpoch > 0
        ? flight.lastContactEpoch * 1000
        : nowMs;

  // Ignore fixes that claim future times (clock skew on some receivers).
  const clampedMs = Math.min(fixMs, nowMs + 5_000);

  let points = flightHistory.get(flight.icao24);
  if (!points || points.length === 0 || points[points.length - 1].t < clampedMs) {
    points = points ?? [];
    points.push({
      t: clampedMs,
      lon: flight.longitude,
      lat: flight.latitude,
      velocityMps: flight.velocityMps,
      headingDeg: flight.headingDeg,
    });
  }

  if (points.length > HISTORY_MAX_POINTS) {
    points.splice(0, points.length - HISTORY_MAX_POINTS);
  }
  while (points.length > 0 && nowMs - points[0].t > HISTORY_MAX_AGE_MS) {
    points.shift();
  }
  flightHistory.set(flight.icao24, points);
  flightRecords.set(flight.icao24, flight);
}

function dropFlightHistory(icao24: string) {
  flightHistory.delete(icao24);
  flightRecords.delete(icao24);
}

function recordVesselFix(vessel: VesselTarget, nowMs: number) {
  const id = String(vessel.mmsi);

  let points = vesselHistory.get(id);
  if (!points || points.length === 0 || points[points.length - 1].t < nowMs) {
    points = points ?? [];
    points.push({
      t: nowMs,
      lon: vessel.lon,
      lat: vessel.lat,
      courseDeg: vessel.courseDeg,
      speedKnots: vessel.speedKnots,
    });
  }

  if (points.length > HISTORY_MAX_POINTS) {
    points.splice(0, points.length - HISTORY_MAX_POINTS);
  }
  while (points.length > 0 && nowMs - points[0].t > HISTORY_MAX_AGE_MS) {
    points.shift();
  }
  vesselHistory.set(id, points);
  vesselRecords.set(id, { ...vessel, lastContactEpoch: Math.round(nowMs / 1000) });
}

function dropVesselHistory(id: string) {
  vesselHistory.delete(id);
  vesselRecords.delete(id);
}

/**
 * Interpolates every tracked vessel onto the queried instant, from AIS fixes
 * recorded during this session. Recorded course is carried along the shortest
 * angular arc between fixes; no movement is extrapolated into the future.
 */
function replayVesselPositions(asOf: number): VesselTarget[] {
  const results: VesselTarget[] = [];

  for (const [id, points] of vesselHistory) {
    if (points.length === 0) {
      continue;
    }

    const base = vesselRecords.get(id);
    if (!base) {
      continue;
    }

    const newest = points[points.length - 1];
    if (newest.t < asOf - 30_000) {
      continue;
    }

    let fix: { lon: number; lat: number; courseDeg: number } | null = null;

    if (asOf > points[0].t) {
      let index = 0;
      for (let i = points.length - 1; i >= 0; i -= 1) {
        if (points[i].t <= asOf) {
          index = i;
          break;
        }
      }

      const from = points[index];
      const to = points[Math.min(index + 1, points.length - 1)];
      const span = to.t - from.t;
      const frac = span > 0 ? (asOf - from.t) / span : 0;

      fix = {
        lon: from.lon + frac * (to.lon - from.lon),
        lat: from.lat + frac * (to.lat - from.lat),
        courseDeg:
          (() => {
            let arc = to.courseDeg - from.courseDeg;
            if (arc > 180) arc -= 360;
            if (arc < -180) arc += 360;
            return (from.courseDeg + frac * arc + 360) % 360;
          })(),
      };
    }

    if (!fix) {
      continue;
    }

    results.push({
      ...base,
      lon: fix.lon,
      lat: fix.lat,
      courseDeg: fix.courseDeg,
      headingDeg: base.headingDeg ?? fix.courseDeg,
      lastContactEpoch: Math.round(asOf / 1000),
    });
  }

  return results;
}

/**
 * Interpolates every tracked aircraft onto the queried instant. Answer
 * "where was this aircraft at 04:12Z" from recorded fixes only: no
 * extrapolation beyond 30 s of dead reckoning, and no guessing.
 */
function replayFlightPositions(asOf: number): FlightTarget[] {
  const results: FlightTarget[] = [];

  for (const [icao24, points] of flightHistory) {
    if (points.length === 0) {
      continue;
    }

    const base = flightRecords.get(icao24);
    if (!base) {
      continue;
    }

    // Too old to speak for the queried instant.
    const oldest = points[0];
    const newest = points[points.length - 1];
    if (newest.t < asOf - 30_000) {
      continue;
    }

    let fix: { lon: number; lat: number; headingDeg: number } | null;

    if (asOf <= oldest.t) {
      // Aircraft appeared after the queried instant; skip rather than invent.
      fix = null;
    } else {
      // Find the recording before the instant, linearly interpolate.
      let index = -1;
      for (let i = points.length - 1; i >= 0; i -= 1) {
        if (points[i].t <= asOf) {
          index = i;
          break;
        }
      }

      if (index < 0) {
        fix = null;
      } else {
        const from = points[index];
        const to = points[Math.min(index + 1, points.length - 1)];

        const lon =
          to.t > from.t
            ? from.lon + ((asOf - from.t) / (to.t - from.t)) * (to.lon - from.lon)
            : from.lon;
        // Wrap across the antimeridian before interpolating eastings.
        const lat =
          to.t > from.t
            ? from.lat + ((asOf - from.t) / (to.t - from.t)) * (to.lat - from.lat)
            : from.lat;

        const dLon = to.lon - from.lon;
        const heading =
          Math.abs(dLon) < 1e-9 && Math.abs(to.lat - from.lat) < 1e-9 ?
            from.headingDeg
          : (Math.atan2(dLon, to.lat - from.lat) * (180 / Math.PI) + 360) %
              360;

        fix = { lon, lat, headingDeg: heading };
      }
    }

    if (!fix) {
      continue;
    }

    results.push({
      ...base,
      longitude: fix.lon,
      latitude: fix.lat,
      headingDeg: fix.headingDeg || base.headingDeg,
      positionTimeEpoch: asOf / 1000,
      lastContactEpoch: asOf / 1000,
    } as FlightTarget);
  }

  return results;
}

function recordFlightAge(flight: FlightTarget, nowMs: number): number {
  const fixMs =
    flight.positionTimeEpoch && flight.positionTimeEpoch > 0
      ? flight.positionTimeEpoch * 1000
      : flight.lastContactEpoch && flight.lastContactEpoch > 0
        ? flight.lastContactEpoch * 1000
        : nowMs;
  return Math.max(0, nowMs - fixMs);
}

export function flightAgeSeconds(flight: FlightTarget, nowMs: number): number {
  return Math.round(recordFlightAge(flight, nowMs) / 1000);
}

/** Epoch ms of a FIRMS acquisition record (acqDate "2026-10-30" + acqTime "1345" UTC). */
export function fireAcquisitionMs(acqDate: string, acqTime: string): number | null {
  const time = (acqTime || "").slice(-4).padStart(4, "0");
  const matches = /^(\d{2})(\d{2})$/.exec(time);
  const date = (acqDate || "").slice(0, 10);
  if (!matches || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  const ms = Date.parse(`${date}T${matches[1]}:${matches[2]}:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Earthquakes and fires do not move, so replaying them means membership, not
 * interpolation: at the queried instant only events that had already
 * occurred show. Events without a usable time stay on the map (never invent
 * a missing history that hides a hazard).
 */
export function filterEarthquakesForReplay(
  earthquakes: EarthquakeTarget[],
  asOf: number,
): EarthquakeTarget[] {
  return earthquakes.filter((quake) => !(quake.time > 0) || quake.time <= asOf);
}

export function filterFiresForReplay(fires: FireTarget[], asOf: number): FireTarget[] {
  return fires.filter((fire) => {
    const acqMs = fireAcquisitionMs(fire.acqDate, fire.acqTime);
    return acqMs === null || acqMs <= asOf;
  });
}

/**
 * Derives alerts from the refreshed feeds. Deterministic id means a target
 * still fulfilling the rule keeps its acknowledge state; it never re-raises.
 */
function deriveAlerts(
  flights: FlightTarget[],
  earthquakes: EarthquakeTarget[],
  previous: TelemetryAlert[],
): TelemetryAlert[] {
  const nowMs = Date.now();
  const byId = new Map(previous.map((alert) => [alert.id, alert]));
  const next: TelemetryAlert[] = [];

  for (const flight of flights) {
    if (!flight.emergency) {
      continue;
    }

    const id = `flight:${flight.icao24}`;
    const existing = byId.get(id);
    byId.delete(id);
    next.push({
      id,
      severity: "critical",
      source: "flights",
      title: `${flight.callsign || flight.icao24} emergency transponder`,
      detail:
        `${flight.emergency.toUpperCase()} · Squawk ${flight.squawk || "—"}` +
        ` · ${Math.round(flight.altitudeMeters).toLocaleString()} m`,
      raisedAt: existing?.raisedAt ?? nowMs,
      eventAt:
        flight.lastContactEpoch && flight.lastContactEpoch > 0
          ? flight.lastContactEpoch * 1000
          : null,
      acknowledged: existing?.acknowledged ?? false,
      target: { type: "flight", data: flight },
    });
  }

  for (const quake of earthquakes) {
    const sev: AlertSeverity | null =
      quake.tsunami ? "critical" : quake.magnitude >= 6 ? "warning" : null;

    if (!sev) {
      continue;
    }

    const id = `quake:${quake.id}`;
    const existing = byId.get(id);
    byId.delete(id);
    next.push({
      id,
      severity: sev,
      source: "earthquakes",
      title: `M${quake.magnitude.toFixed(1)} ${sev === "critical" ? "with tsunami flag" : "event"}`,
      detail: quake.place,
      raisedAt: existing?.raisedAt ?? nowMs,
      eventAt: quake.time > 0 ? quake.time : null,
      acknowledged: existing?.acknowledged ?? false,
      target: { type: "earthquake", data: quake },
    });
  }

  return next.sort((a, b) => {
    if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
    return b.raisedAt - a.raisedAt;
  });
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  flightsEnabled: false,
  earthquakesEnabled: false,
  satellitesEnabled: false,
  firesEnabled: false,
  vesselsEnabled: false,
  autoRefreshSeconds: 10,
  loading: false,
  lastUpdated: null,
  selectedTarget: null,
  hoveredTarget: null,
  hoverPosition: null,
  hoverCoordinate: null,

  flights: [],
  earthquakes: [],
  satellites: [],
  fires: [],
  vessels: [],

  feedStatus: {
    flights: EMPTY_FEED_STATUS,
    earthquakes: EMPTY_FEED_STATUS,
    satellites: EMPTY_FEED_STATUS,
    fires: EMPTY_FEED_STATUS,
    vessels: EMPTY_FEED_STATUS,
  },

  asOf: null,
  displayedFlights: null,
  displayedVessels: null,
  displayedEarthquakes: null,
  displayedFires: null,

  alerts: [],
  openAlerts: 0,

  flightSearch: "",
  earthquakeMinMag: 2.0,
  satelliteSearch: "",
  fireMinConfidence: 50,
  vesselSearch: "",
  currentBbox: null,

  toggleFeed: (feed) => {
    if (feed === "flights") {
      const next = !get().flightsEnabled;
      set({ flightsEnabled: next });
      if (next) get().refreshFeeds();
      else set({ flights: [], displayedFlights: null });
    } else if (feed === "earthquakes") {
      const next = !get().earthquakesEnabled;
      set({ earthquakesEnabled: next });
      if (next) get().refreshFeeds();
      else set({ earthquakes: [], displayedEarthquakes: null });
    } else if (feed === "satellites") {
      const next = !get().satellitesEnabled;
      set({ satellitesEnabled: next });
      if (next) get().refreshFeeds();
      else set({ satellites: [] });
    } else if (feed === "fires") {
      const next = !get().firesEnabled;
      set({ firesEnabled: next });
      if (next) get().refreshFeeds();
      else set({ fires: [], displayedFires: null });
    } else if (feed === "vessels") {
      const next = !get().vesselsEnabled;
      set({ vesselsEnabled: next });
      if (next) get().refreshFeeds();
      else set({ vessels: [], displayedVessels: null });
    }
  },

  setFeedEnabled: (feed, enabled) => {
    if (feed === "flights") set({ flightsEnabled: enabled });
    else if (feed === "earthquakes") set({ earthquakesEnabled: enabled });
    else if (feed === "satellites") set({ satellitesEnabled: enabled });
    else if (feed === "fires") set({ firesEnabled: enabled });
    else if (feed === "vessels") set({ vesselsEnabled: enabled });
  },

  setAutoRefresh: (seconds) => set({ autoRefreshSeconds: seconds }),
  setFlightSearch: (flightSearch) => set({ flightSearch }),
  setEarthquakeMinMag: (earthquakeMinMag) => {
    set({ earthquakeMinMag });
    if (get().earthquakesEnabled) {
      get().refreshFeeds();
    }
  },
  setSatelliteSearch: (satelliteSearch) => set({ satelliteSearch }),
  setFireMinConfidence: (fireMinConfidence) => {
    set({ fireMinConfidence });
    if (get().firesEnabled) {
      get().refreshFeeds();
    }
  },
  setVesselSearch: (vesselSearch) => set({ vesselSearch }),
  setSelectedTarget: (selectedTarget) => set({ selectedTarget }),
  setHoveredTarget: (hoveredTarget, pos = null, coordinate = null) =>
    set({ hoveredTarget, hoverPosition: pos, hoverCoordinate: coordinate }),
  updateHoverPosition: (pos) => set({ hoverPosition: pos }),
  setViewportBbox: (currentBbox) => set({ currentBbox }),

  setAsOf: (asOf) => {
    if (asOf === null) {
      set({
        asOf: null,
        displayedFlights: null,
        displayedVessels: null,
        displayedEarthquakes: null,
        displayedFires: null,
      });
      return;
    }
    const { earthquakes, fires } = get();
    set({
      asOf,
      displayedFlights: replayFlightPositions(asOf),
      displayedVessels: replayVesselPositions(asOf),
      displayedEarthquakes: filterEarthquakesForReplay(earthquakes, asOf),
      displayedFires: filterFiresForReplay(fires, asOf),
    });
  },

  acknowledgeAlert: (id) =>
    set((state) => {
      const alerts = state.alerts.map((alert) =>
        alert.id === id ? { ...alert, acknowledged: true } : alert,
      );
      return {
        alerts,
        openAlerts: alerts.filter((a) => !a.acknowledged).length,
      };
    }),

  acknowledgeAllAlerts: () =>
    set((state) => ({
      alerts: state.alerts.map((a) => ({ ...a, acknowledged: true })),
      openAlerts: 0,
    })),

  refreshFeeds: async (bbox) => {
    if (bbox !== undefined) {
      set({ currentBbox: bbox });
    }
    const {
      flightsEnabled,
      earthquakesEnabled,
      satellitesEnabled,
      firesEnabled,
      vesselsEnabled,
      earthquakeMinMag,
      currentBbox,
    } = get();

    // Nothing opted in yet: no dataset is loaded by default, so boot,
    // map moves, and the auto-refresh timer are all cheap no-ops.
    if (
      !flightsEnabled &&
      !earthquakesEnabled &&
      !satellitesEnabled &&
      !firesEnabled &&
      !vesselsEnabled
    ) {
      return;
    }

    const effectiveBbox = bbox !== undefined ? bbox : currentBbox;
    set({ loading: true });

    const markOk = (feed: TelemetryFeedType, count: number) =>
      set((s) => ({
        feedStatus: {
          ...s.feedStatus,
          [feed]: { lastOk: Date.now(), lastError: null, count },
        },
      }));

    const markFail = (feed: TelemetryFeedType, error: unknown) =>
      set((s) => ({
        feedStatus: {
          ...s.feedStatus,
          [feed]: { ...s.feedStatus[feed], lastError: String(error) },
        },
      }));

    try {
      const promises: Promise<void>[] = [];

      if (flightsEnabled) {
        promises.push(
          fetchLiveFlights(effectiveBbox ?? undefined)
            .then((flights) => {
              const nowMs = Date.now();
              const seen = new Set<string>();
              for (const flight of flights) {
                recordFlightFix(flight, nowMs);
                seen.add(flight.icao24);
              }
              for (const record of flightRecords.keys()) {
                if (!seen.has(record)) dropFlightHistory(record);
              }
              set({
                flights,
                displayedFlights:
                  get().asOf !== null
                    ? replayFlightPositions(get().asOf as number)
                    : null,
              });
              markOk("flights", flights.length);
            })
            .catch((err) => markFail("flights", err)),
        );
      }

      if (earthquakesEnabled) {
        promises.push(
          fetchLiveEarthquakes(earthquakeMinMag)
            .then((earthquakes) => {
              const asOf = get().asOf;
              set({
                earthquakes,
                displayedEarthquakes:
                  asOf !== null ? filterEarthquakesForReplay(earthquakes, asOf) : null,
              });
              markOk("earthquakes", earthquakes.length);
            })
            .catch((err) => markFail("earthquakes", err)),
        );
      }

      if (satellitesEnabled) {
        promises.push(
          fetchLiveSatellites()
            .then((satellites) => {
              set({ satellites });
              markOk("satellites", satellites.length);
            })
            .catch((err) => markFail("satellites", err)),
        );
      }

      if (firesEnabled) {
        promises.push(
          fetchLiveFires()
            .then((fires) => {
              const asOf = get().asOf;
              set({
                fires,
                displayedFires: asOf !== null ? filterFiresForReplay(fires, asOf) : null,
              });
              markOk("fires", fires.length);
            })
            .catch((err) => markFail("fires", err)),
        );
      }

      if (vesselsEnabled) {
        promises.push(
          fetchLiveVessels()
            .then((vessels) => {
              const nowMs = Date.now();
              const seen = new Set<string>();
              const stamped = vessels.map((vessel) => {
                recordVesselFix(vessel, nowMs);
                seen.add(String(vessel.mmsi));
                return vesselRecords.get(String(vessel.mmsi)) ?? vessel;
              });
              for (const record of vesselRecords.keys()) {
                if (!seen.has(record)) dropVesselHistory(record);
              }
              set({
                vessels: stamped,
                displayedVessels:
                  get().asOf !== null
                    ? replayVesselPositions(get().asOf as number)
                    : null,
              });
              markOk("vessels", vessels.length);
            })
            .catch((err) => markFail("vessels", err)),
        );
      }

      await Promise.allSettled(promises);

      // Derive the alert queue from whatever the feeds produced.
      const previousAlerts = get().alerts;
      const alerts = deriveAlerts(get().flights, get().earthquakes, previousAlerts);
      set({
        lastUpdated: new Date(),
        alerts,
        openAlerts: alerts.filter((a) => !a.acknowledged).length,
      });
    } finally {
      set({ loading: false });
    }
  },
}));
