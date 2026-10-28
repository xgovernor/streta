import { create } from "zustand";
import {
  fetchLiveEarthquakes,
  fetchLiveFlights,
  fetchLiveSatellites,
} from "../lib/gis/tiledBackend";
import type { EarthquakeTarget, FlightTarget, SatelliteTarget } from "../lib/gis/types";

export type TelemetryFeedType = "flights" | "earthquakes" | "satellites";

export type SelectedTelemetryTarget =
  | { type: "flight"; data: FlightTarget }
  | { type: "earthquake"; data: EarthquakeTarget }
  | { type: "satellite"; data: SatelliteTarget };

interface TelemetryState {
  flightsEnabled: boolean;
  earthquakesEnabled: boolean;
  satellitesEnabled: boolean;
  autoRefreshSeconds: number; // 0 (off), 10, 30, 60
  loading: boolean;
  lastUpdated: Date | null;
  selectedTarget: SelectedTelemetryTarget | null;

  flights: FlightTarget[];
  earthquakes: EarthquakeTarget[];
  satellites: SatelliteTarget[];

  // Search & filter
  flightSearch: string;
  earthquakeMinMag: number;
  satelliteSearch: string;

  // Actions
  toggleFeed: (feed: TelemetryFeedType) => void;
  setFeedEnabled: (feed: TelemetryFeedType, enabled: boolean) => void;
  setAutoRefresh: (seconds: number) => void;
  setFlightSearch: (search: string) => void;
  setEarthquakeMinMag: (mag: number) => void;
  setSatelliteSearch: (search: string) => void;
  setSelectedTarget: (target: SelectedTelemetryTarget | null) => void;
  refreshFeeds: () => Promise<void>;
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  flightsEnabled: true,
  earthquakesEnabled: true,
  satellitesEnabled: true,
  autoRefreshSeconds: 10,
  loading: false,
  lastUpdated: null,
  selectedTarget: null,

  flights: [],
  earthquakes: [],
  satellites: [],

  flightSearch: "",
  earthquakeMinMag: 2.0,
  satelliteSearch: "",

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
    }
  },

  setFeedEnabled: (feed, enabled) => {
    if (feed === "flights") set({ flightsEnabled: enabled });
    else if (feed === "earthquakes") set({ earthquakesEnabled: enabled });
    else if (feed === "satellites") set({ satellitesEnabled: enabled });
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
  setSelectedTarget: (selectedTarget) => set({ selectedTarget }),

  refreshFeeds: async () => {
    const { flightsEnabled, earthquakesEnabled, satellitesEnabled, earthquakeMinMag } = get();
    set({ loading: true });

    try {
      const promises: Promise<void>[] = [];

      if (flightsEnabled) {
        promises.push(
          fetchLiveFlights().then((flights) => {
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

      await Promise.allSettled(promises);
      set({ lastUpdated: new Date() });
    } finally {
      set({ loading: false });
    }
  },
}));
