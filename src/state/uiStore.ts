import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { BASEMAPS } from "../lib/gis/data";
import type {
  BasemapId,
  CoordinateFormat,
  PanelId,
  ThemeMode,
} from "../lib/gis/types";

export type AnalysisTab = "distance" | "area" | "elevation" | "buffer" | "knn" | "boolean";

/** Which dock a panel opens in. Independent: one left + one right at once. */
const PANEL_DOCK: Record<PanelId, "left" | "right"> = {
  search: "left",
  project: "left",
  data: "left",
  telemetry: "left",
  table: "left",
  join: "left",
  basemaps: "left",
  settings: "left",
  bookmarks: "left",
  feature: "right",
  layer: "right",
  measure: "right",
};

/**
 * Workspace state. The old single `activePanel` is gone: a dataset stack can
 * stay open on the left while an inspection and the measure tools run on the
 * right, and the bottom timeline dock is a third, fully independent surface.
 */
interface UiState {
  leftPanel: PanelId | null;
  rightPanel: PanelId | null;
  /** Dock that last opened, so Escape closes the surface you just used. */
  lastDock: "left" | "right" | null;
  timelineOpen: boolean;
  alertsOpen: boolean;
  analysisTab: AnalysisTab;
  basemap: BasemapId;
  theme: ThemeMode;
  coordFormat: CoordinateFormat;
  graticule: boolean;
  trafficFlow: boolean;
  toast: string | null;
  snipMode: boolean;
  setSnipMode: (active: boolean) => void;
  openPanel: (panel: PanelId) => void;
  togglePanel: (panel: PanelId) => void;
  closePanel: (side?: "left" | "right") => void;
  setTimelineOpen: (open: boolean) => void;
  toggleTimeline: () => void;
  setAlertsOpen: (open: boolean) => void;
  setAnalysisTab: (tab: AnalysisTab) => void;
  openAnalysisTab: (tab: AnalysisTab) => void;
  setBasemap: (basemap: BasemapId) => void;
  setTheme: (theme: ThemeMode) => void;
  setCoordFormat: (format: CoordinateFormat) => void;
  setGraticule: (visible: boolean) => void;
  setTrafficFlow: (visible: boolean) => void;
  flash: (message: string) => void;
  dismissFlash: () => void;
  notify: (message: string) => void;
}

/** Preferences that survive an app restart, stored on the local device. */
type PersistedUi = Pick<
  UiState,
  "basemap" | "coordFormat" | "theme" | "graticule" | "trafficFlow" | "timelineOpen"
>;

export const DEFAULT_PREFERENCES: PersistedUi = {
  basemap: "positron",
  coordFormat: "decimal",
  theme: "dark",
  graticule: false,
  trafficFlow: false,
  timelineOpen: false,
};

const STORAGE_KEY = "strata.preferences";

const THEMES = new Set<ThemeMode>(["dark", "light"]);
const COORD_FORMATS = new Set<CoordinateFormat>([
  "decimal",
  "dms",
  "projected",
]);
const BASEMAP_IDS = new Set<BasemapId>(BASEMAPS.map((basemap) => basemap.id));

/**
 * Persisted values come from disk, so they are untrusted: drop anything that no
 * longer matches a known option instead of forcing a broken value into the UI.
 */
function readPreferences(value: unknown): PersistedUi {
  if (!value || typeof value !== "object") {
    return DEFAULT_PREFERENCES;
  }

  const stored = value as Record<string, unknown>;
  const basemap = stored.basemap as BasemapId;
  const coordFormat = stored.coordFormat as CoordinateFormat;
  const theme = stored.theme as ThemeMode;

  return {
    basemap: BASEMAP_IDS.has(basemap) ? basemap : DEFAULT_PREFERENCES.basemap,
    coordFormat:
      COORD_FORMATS.has(coordFormat) ? coordFormat : (
        DEFAULT_PREFERENCES.coordFormat
      ),
    theme: THEMES.has(theme) ? theme : DEFAULT_PREFERENCES.theme,
    graticule:
      typeof stored.graticule === "boolean" ?
        stored.graticule
      : DEFAULT_PREFERENCES.graticule,
    trafficFlow:
      typeof stored.trafficFlow === "boolean" ?
        stored.trafficFlow
      : DEFAULT_PREFERENCES.trafficFlow,
    timelineOpen:
      typeof stored.timelineOpen === "boolean" ?
        stored.timelineOpen
      : DEFAULT_PREFERENCES.timelineOpen,
  };
}

let flashTimer: number | undefined;

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      leftPanel: null,
      rightPanel: null,
      lastDock: null,
      alertsOpen: false,
      analysisTab: "distance",
      ...DEFAULT_PREFERENCES,
      toast: null,
      snipMode: false,
      setSnipMode: (snipMode) => set({ snipMode }),

      openPanel: (panel) =>
        set(() => {
          const dock = PANEL_DOCK[panel];
          const update = dock === "left" ? { leftPanel: panel } : { rightPanel: panel };
          return { ...update, lastDock: dock };
        }),

      togglePanel: (panel) =>
        set((state) => {
          const dock = PANEL_DOCK[panel];
          const key = dock === "left" ? "leftPanel" : "rightPanel";
          const closing = state[key] === panel;
          const update = dock === "left" ? { leftPanel: closing ? null : panel } : { rightPanel: closing ? null : panel };
          return { ...update, lastDock: closing ? state.lastDock : dock };
        }),

      /**
       * Closes one dock, or when no side is named, the one opened most
       * recently — that is what the Escape handler wants.
       */
      closePanel: (side) =>
        set((state) => {
          const target: "left" | "right" | null = side ?? state.lastDock;
          if (target === "left") return { leftPanel: null };
          if (target === "right") return { rightPanel: null };
          return {};
        }),

      setTimelineOpen: (timelineOpen) => set({ timelineOpen }),
      toggleTimeline: () =>
        set((state) => ({ timelineOpen: !state.timelineOpen })),
      setAlertsOpen: (alertsOpen) => set({ alertsOpen }),

      setAnalysisTab: (tab) => set({ analysisTab: tab }),

      openAnalysisTab: (tab) =>
        set({ rightPanel: "measure", lastDock: "right", analysisTab: tab }),

      setBasemap: (basemap) => set({ basemap }),

      setTheme: (theme) => set({ theme }),

      setCoordFormat: (coordFormat) => set({ coordFormat }),

      setGraticule: (graticule) => set({ graticule }),

      setTrafficFlow: (trafficFlow) => set({ trafficFlow }),

      flash: (message) => {
        window.clearTimeout(flashTimer);
        set({ toast: message });
        flashTimer = window.setTimeout(() => set({ toast: null }), 3200);
      },

      dismissFlash: () => {
        window.clearTimeout(flashTimer);
        set({ toast: null });
      },

      notify: (message) => {
        window.clearTimeout(flashTimer);
        set({ toast: message });
        flashTimer = window.setTimeout(() => set({ toast: null }), 3200);
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage<PersistedUi>(() => {
        const local = globalThis.localStorage;

        // Preferences are a convenience: without local storage they simply
        // do not survive the session.
        if (!local) {
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }

        return {
          getItem: (key) => local.getItem(key),
          setItem: (key, value) => local.setItem(key, value),
          removeItem: (key) => local.removeItem(key),
        };
      }),
      partialize: (state): PersistedUi => ({
        basemap: state.basemap,
        coordFormat: state.coordFormat,
        theme: state.theme,
        graticule: state.graticule,
        trafficFlow: state.trafficFlow,
        timelineOpen: state.timelineOpen,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...readPreferences(persisted),
      }),
    },
  ),
);
