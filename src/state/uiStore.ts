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

interface UiState {
  activePanel: PanelId | null;
  analysisTab: AnalysisTab;
  basemap: BasemapId;
  theme: ThemeMode;
  coordFormat: CoordinateFormat;
  graticule: boolean;
  trafficFlow: boolean;
  toast: string | null;
  openPanel: (panel: PanelId) => void;
  togglePanel: (panel: PanelId) => void;
  closePanel: () => void;
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
  "basemap" | "coordFormat" | "theme" | "graticule" | "trafficFlow"
>;

export const DEFAULT_PREFERENCES: PersistedUi = {
  basemap: "positron",
  coordFormat: "decimal",
  theme: "dark",
  graticule: false,
  trafficFlow: false,
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
  };
}

let flashTimer: number | undefined;

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      activePanel: null,
      analysisTab: "distance",
      ...DEFAULT_PREFERENCES,
      toast: null,

      openPanel: (panel) => set({ activePanel: panel }),

      togglePanel: (panel) =>
        set((state) => ({
          activePanel: state.activePanel === panel ? null : panel,
        })),

      closePanel: () => set({ activePanel: null }),

      setAnalysisTab: (tab) => set({ analysisTab: tab }),

      openAnalysisTab: (tab) =>
        set({ activePanel: "measure", analysisTab: tab }),

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
      }),
      merge: (persisted, current) => ({
        ...current,
        ...readPreferences(persisted),
      }),
    },
  ),
);
