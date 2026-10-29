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
  setVesselSearch: (search: string) => void;
  setSelectedTarget: (target: SelectedTelemetryTarget | null) => void;
  setHoveredTarget: (
    target: SelectedTelemetryTarget | null,
    pos?: { x: number; y: number } | null,
    coordinate?: [number, number] | null
  ) => void;
  updateHoverPosition: (pos: { x: number; y: number } | null) => void;
  setViewportBbox: (bbox: [number, number, number, number] | null) => void;
  refreshFeeds: (bbox?: [number, number, number, number]) => Promise<void>;
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  flightsEnabled: true,
  earthquakesEnabled: true,
  satellitesEnabled: true,
  firesEnabled: true,
  vesselsEnabled: true,
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
      else set({ flights: [] });
    } else if (feed === "earthquakes") {
      const next = !get().earthquakesEnabled;
      set({ earthquakesEnabled: next });
      if (next) get().refreshFeeds();
      else set({ earthquakes: [] });
    } else if (feed === "satellites") {
      const next = !get().satellitesEnabled;
      set({ satellitesEnabled: next });
      if (next) get().refreshFeeds();
      else set({ satellites: [] });
    } else if (feed === "fires") {
      const next = !get().firesEnabled;
      set({ firesEnabled: next });
      if (next) get().refreshFeeds();
      else set({ fires: [] });
    } else if (feed === "vessels") {
      const next = !get().vesselsEnabled;
      set({ vesselsEnabled: next });
      if (next) get().refreshFeeds();
      else set({ vessels: [] });
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
    const effectiveBbox = bbox !== undefined ? bbox : currentBbox;
    set({ loading: true });

    try {
      const promises: Promise<void>[] = [];

      if (flightsEnabled) {
        promises.push(
          fetchLiveFlights(effectiveBbox ?? undefined).then((flights) => {
            set({ flights });
          })
        );
      }

      if (earthquakesEnabled) {
        promises.push(
          fetchLiveEarthquakes(earthquakeMinMag).then((earthquakes) => {
            set({ earthquakes });
          })
        );
      }

      if (satellitesEnabled) {
        promises.push(
          fetchLiveSatellites().then((satellites) => {
            set({ satellites });
          })
        );
      }

      if (firesEnabled) {
        promises.push(
          fetchLiveFires().then((fires) => {
            set({ fires });
          })
        );
      }

      if (vesselsEnabled) {
        promises.push(
          fetchLiveVessels().then((vessels) => {
            set({ vessels });
          })
        );
      }

      await Promise.allSettled(promises);
      set({ lastUpdated: new Date() });
    } finally {
      set({ loading: false });
    }
  },
}));
