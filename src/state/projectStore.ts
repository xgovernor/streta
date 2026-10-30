import { create } from "zustand";
import {
  createDataset,
  moveDataset as moveDatasetHelper,
  moveLayerWithinDataset,
  reindexDatasets,
  reindexLayers,
  uniqueDatasetName,
} from "../lib/gis/datasets";
import {
  createLayer,
  reprojectLayer,
  uniqueLayerName,
} from "../lib/gis/layers";
import { GEOGRAPHIC_CRS } from "../lib/gis/crs";
import type { Bookmark, DatasetLayer, Dataset, LayerFilter, LayerStyle, MeasureSummary, Selection } from "../lib/gis/types";
import type { ProjectStore, RecentEntry } from "./projectStore.types";
import type { FeatureRecord } from "../lib/gis/types";

const BOOKMARKS_STORAGE_KEY = "strata.bookmarks";

function loadStoredBookmarks(): Bookmark[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(BOOKMARKS_STORAGE_KEY) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredBookmarks(bookmarks: Bookmark[]) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(bookmarks));
    }
  } catch {}
}

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  layers: [],
  datasets: [],
  selection: null,
  activeLayerId: null,
  measureMode: "off",
  measureSummary: null,
  projectName: "Untitled",
  projectPath: null,
  dirty: false,
  hydrationWarnings: [],
  recent: [],
  bookmarks: loadStoredBookmarks(),

  addBookmark(input) {
    const newBookmark: Bookmark = {
      ...input,
      id: "bm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      createdAt: Date.now(),
    };
    set((state) => {
      const next = [newBookmark, ...state.bookmarks];
      saveStoredBookmarks(next);
      return { bookmarks: next };
    });
    return newBookmark;
  },

  removeBookmark(id) {
    set((state) => {
      const next = state.bookmarks.filter((b) => b.id !== id);
      saveStoredBookmarks(next);
      return { bookmarks: next };
    });
  },

  updateBookmark(id, updates) {
    set((state) => {
      const next = state.bookmarks.map((b) => (b.id === id ? { ...b, ...updates } : b));
      saveStoredBookmarks(next);
      return { bookmarks: next };
    });
  },

  dismissHydrationWarnings() {
    set({ hydrationWarnings: [] });
  },

  newProject() {
    set({
      layers: [],
      datasets: [],
      selection: null,
      activeLayerId: null,
      measureMode: "off",
      measureSummary: null,
      projectName: "Untitled",
      projectPath: null,
      dirty: false,
      hydrationWarnings: [],
      recent: [],
    });
  },

  addSampleDataset() {
    const existing = get().datasets.find((d) => d.name === "Survey network");
    if (existing) {
      const existingLayers = get().layers.filter((l) => l.datasetId === existing.id);
      return { dataset: existing, layers: existingLayers };
    }

    const dataset = createDataset({
      name: "Survey network",
      kind: "sample",
      order: get().datasets.length,
    });
    const routesLayer = createLayer({
      datasetId: dataset.id,
      name: "Survey routes",
      features: [
        {
          id: "route-1",
          geometry: { type: "LineString" as const, coordinates: [[8.5417, 47.3769], [-9.1393, 38.7223]] },
          properties: { name: "Zurich–Lisbon" },
        },
      ],
      crs: GEOGRAPHIC_CRS,
      format: "geojson",
      source: "sample",
      order: 0,
    });
    const stationsLayer = createLayer({
      datasetId: dataset.id,
      name: "Survey stations",
      features: [
        {
          id: "zrh",
          geometry: { type: "Point" as const, coordinates: [8.5417, 47.3769] },
          properties: { name: "Zurich", signal: 98 },
        },
        {
          id: "lis",
          geometry: { type: "Point" as const, coordinates: [-9.1393, 38.7223] },
          properties: { name: "Lisbon", signal: 91 },
        },
      ],
      crs: GEOGRAPHIC_CRS,
      format: "geojson",
      source: "sample",
      order: 1,
    });

    set((state) => ({
      datasets: [...state.datasets, dataset],
      layers: [...state.layers, routesLayer, stationsLayer],
      activeLayerId: stationsLayer.id,
      dirty: true,
    }));

    return { dataset, layers: [routesLayer, stationsLayer] };
  },

  addDataset(input: {
    name: string;
    kind?: "file" | "library" | "sample" | "join";
    libraryId?: string | null;
    source?: string | null;
    layers: {
      id?: string;
      name: string;
      features: FeatureRecord[];
      crs: string;
      format: DatasetLayer["format"];
      tileUrl?: string;
      source?: string | null;
      style?: Partial<LayerStyle>;
      color?: string;
    }[];
  }) {
    const state = get();
    const existingDatasetNames = state.datasets.map((d) => d.name);
    const datasetName = uniqueDatasetName(existingDatasetNames, input.name);

    const dataset = createDataset({
      name: datasetName,
      kind: input.kind,
      libraryId: input.libraryId ?? null,
      source: input.source ?? null,
      order: state.datasets.length,
    });

    const existingLayerNames = [...state.layers.map((l) => l.name)];
    const layers = input.layers.map((layer, order) => {
      const layerName = uniqueLayerName(existingLayerNames, layer.name);
      existingLayerNames.push(layerName);

      return createLayer({
        id: layer.id,
        datasetId: dataset.id,
        name: layerName,
        features: layer.features,
        crs: layer.crs,
        format: layer.format,
        tileUrl: layer.tileUrl,
        source: layer.source ?? null,
        style: layer.style,
        color: layer.color,
        order,
      });
    });

    set((current) => ({
      datasets: [...current.datasets, dataset],
      layers: [...current.layers, ...layers],
      activeLayerId: layers[0]?.id ?? current.activeLayerId,
      dirty: true,
    }));

    return { dataset, layers };
  },

  removeDataset(datasetId: string) {
    set((state) => {
      const nextLayers = state.layers.filter((layer) => layer.datasetId !== datasetId);
      const nextDatasets = reindexDatasets(state.datasets.filter((dataset) => dataset.id !== datasetId));
      const nextSelection = state.selection?.layerId.startsWith(datasetId) ? null : state.selection;
      const nextActiveLayerId = state.activeLayerId?.startsWith(datasetId) ? null : state.activeLayerId;

      return {
        datasets: nextDatasets,
        layers: nextLayers,
        selection: nextSelection,
        activeLayerId: nextActiveLayerId,
        dirty: true,
      };
    });
  },

  removeLayer(layerId: string) {
    set((state) => {
      const layer = state.layers.find((item) => item.id === layerId);
      if (!layer) return state;

      const nextLayers = reindexLayers(state.layers.filter((item) => item.id !== layerId));
      const datasetLayers = nextLayers.filter((item) => item.datasetId === layer.datasetId);
      const datasetStillHasLayers = datasetLayers.length > 0;
      const nextDatasets = datasetStillHasLayers
        ? state.datasets
        : reindexDatasets(state.datasets.filter((dataset) => dataset.id !== layer.datasetId));

      return {
        layers: nextLayers,
        selection: state.selection?.layerId === layerId ? null : state.selection,
        activeLayerId: state.activeLayerId === layerId ? null : state.activeLayerId,
        datasets: nextDatasets,
        dirty: true,
      };
    });
  },

  renameDataset(datasetId: string, name: string) {
    set((state) => ({
      datasets: state.datasets.map((dataset) =>
        dataset.id === datasetId ? { ...dataset, name } : dataset
      ),
      dirty: true,
    }));
  },

  renameLayer(layerId: string, name: string) {
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === layerId ? { ...layer, name } : layer
      ),
      dirty: true,
    }));
  },

  setActiveLayer(layerId: string | null) {
    set({ activeLayerId: layerId });
  },

  setLayerStyle(layerId: string, style: Partial<LayerStyle>) {
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === layerId ? { ...layer, style: { ...layer.style, ...style } } : layer
      ),
      dirty: true,
    }));
  },

  setLayerOpacity(layerId: string, opacity: number) {
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === layerId ? { ...layer, opacity: Math.min(1, Math.max(0, opacity)) } : layer
      ),
      dirty: true,
    }));
  },

  setLayerVisible(layerId: string, visible: boolean) {
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === layerId ? { ...layer, visible } : layer
      ),
      dirty: true,
    }));
  },

  setDatasetVisible(datasetId: string, visible: boolean) {
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.datasetId === datasetId ? { ...layer, visible } : layer
      ),
      dirty: true,
    }));
  },

  setLayerFilters(layerId: string, filters: LayerFilter[]) {
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === layerId ? { ...layer, filters } : layer
      ),
      dirty: true,
    }));
  },

  setLayerCrs(layerId: string, crs: string): number {
    let dropped = 0;
    set((state) => ({
      layers: state.layers.map((layer) => {
        if (layer.id !== layerId) return layer;
        const result = reprojectLayer(layer, crs);
        dropped = result.dropped;
        return result.layer;
      }),
      dirty: true,
    }));
    return dropped;
  },

  moveDataset(datasetId: string, delta: number) {
    set((state) => ({
      datasets: moveDatasetHelper(state.datasets, datasetId, delta),
      dirty: true,
    }));
  },

  moveLayer(layerId: string, delta: number) {
    set((state) => ({
      layers: moveLayerWithinDataset(state.layers, layerId, delta),
      dirty: true,
    }));
  },

  toggleDataset(datasetId: string) {
    set((state) => ({
      datasets: state.datasets.map((dataset) =>
        dataset.id === datasetId ? { ...dataset, collapsed: !dataset.collapsed } : dataset
      ),
    }));
  },

  setMeasureMode(mode: "off" | "distance" | "area") {
    set({ measureMode: mode, measureSummary: mode === "off" ? null : get().measureSummary });
  },

  setMeasureSummary(summary: MeasureSummary | null) {
    set({ measureSummary: summary, dirty: true });
  },

  select(selection: Selection) {
    set({ selection });
  },

  clearSelection() {
    set({ selection: null });
  },

  lockSelection(feature: { layerId: string; featureId: string }) {
    this.select({
      layerId: feature.layerId,
      featureId: feature.featureId,
    });
  },

  selectionFeatureById(layerId: string, featureId?: string) {
    const layer = get().layers.find((item) => item.id === layerId);
    if (!layer) return null;
    const targetFeatureId = featureId ?? get().selection?.featureId;
    return targetFeatureId != null ? layer.features.find((item) => item.id === targetFeatureId) ?? null : null;
  },

  setProjectName(name: string) {
    set({ projectName: name, dirty: true });
  },

  setProjectPath(path: string | null) {
    set({ projectPath: path });
  },

  markSaved(_name?: string, _path?: string | null) {
    set({ dirty: false });
  },

  loadProject(project: { name: string; path: string | null; datasets: Dataset[]; layers: DatasetLayer[] }) {
    set({
      projectName: project.name,
      projectPath: project.path,
      datasets: project.datasets,
      layers: project.layers,
      selection: null,
      measureMode: "off",
      measureSummary: null,
      dirty: false,
    });
  },

  forgetRecent(name: string) {
    set((state) => ({
      recent: state.recent.filter((entry) => entry.name !== name),
    }));
  },

  addToRecent(entry: RecentEntry) {
    set((state) => ({
      recent: [entry, ...state.recent.filter((item) => item.name !== entry.name)].slice(0, 10),
    }));
  },
}));

export type UseProjectStore = typeof useProjectStore;
