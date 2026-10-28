import { create } from "zustand";
import { createDataset } from "../lib/gis/datasets";
import { createLayer } from "../lib/gis/layers";
import { GEOGRAPHIC_CRS } from "../lib/gis/crs";
import type { DatasetLayer, Dataset, LayerFilter, LayerStyle, MeasureSummary, Selection } from "../lib/gis/types";
import type { ProjectStore } from "./projectStore.types";
import type { FeatureRecord } from "../lib/gis/types";


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
    const dataset = createDataset({ name: "Survey network" });
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
      name: string;
      features: FeatureRecord[];
      crs: string;
      format: DatasetLayer["format"];
      source?: string | null;
      style?: Partial<LayerStyle>;
      color?: string;
    }[];
  }) {
    const dataset = createDataset({
      name: input.name,
      kind: input.kind,
      libraryId: input.libraryId ?? null,
      source: input.source ?? null,
    });
    const layers = input.layers.map((layer) =>
      createLayer({
        datasetId: dataset.id,
        name: layer.name,
        features: layer.features,
        crs: layer.crs,
        format: layer.format,
        source: layer.source ?? null,
        style: layer.style,
        color: layer.color,
      })
    );

    set((state) => ({
      datasets: [...state.datasets, dataset],
      layers: [...state.layers, ...layers],
      activeLayerId: layers[0]?.id ?? state.activeLayerId,
      dirty: true,
    }));

    return { dataset, layers };
  },

  removeDataset(datasetId: string) {
    set((state) => {
      const nextLayers = state.layers.filter((layer) => layer.datasetId !== datasetId);
      const nextDatasets = state.datasets.filter((dataset) => dataset.id !== datasetId);
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

      const nextLayers = state.layers.filter((item) => item.id !== layerId);
      const datasetLayers = state.layers.filter((item) => item.datasetId === layer.datasetId);
      const datasetStillHasLayers = datasetLayers.length > 1;

      return {
        layers: nextLayers,
        selection: state.selection?.layerId === layerId ? null : state.selection,
        activeLayerId: state.activeLayerId === layerId ? null : state.activeLayerId,
        datasets: datasetStillHasLayers
          ? state.datasets
          : state.datasets.filter((dataset) => dataset.id !== layer.datasetId),
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

  setLayerCrs(layerId: string, crs: string) {
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === layerId ? { ...layer, crs } : layer
      ),
      dirty: true,
    }));
  },

  moveDataset(datasetId: string, delta: number) {
    set((state) => {
      const datasets = [...state.datasets];
      const index = datasets.findIndex((dataset) => dataset.id === datasetId);
      const target = index + delta;

      if (index < 0 || target < 0 || target >= datasets.length) {
        return state;
      }

      const [moved] = datasets.splice(index, 1);
      datasets.splice(target, 0, moved);

      return {
        datasets: datasets.map((dataset, order) =>
          dataset.id === moved.id ? { ...dataset, order } : dataset
        ),
        dirty: true,
      };
    });
  },

  moveLayer(layerId: string, delta: number) {
    set((state) => {
      const layer = state.layers.find((item) => item.id === layerId);
      if (!layer) return state;

      const siblings = state.layers.filter((item) => item.datasetId === layer.datasetId);
      const index = siblings.findIndex((item) => item.id === layerId);
      const target = index + delta;

      if (index < 0 || target < 0 || target >= siblings.length) {
        return state;
      }

      const [moved] = siblings.splice(index, 1);
      siblings.splice(target, 0, moved);
      const orderMap = new Map(siblings.map((item, order) => [item.id, order]));

      return {
        layers: state.layers.map((item) => {
          const next = orderMap.get(item.id);
          return next === undefined || item.order === next ? item : { ...item, order: next };
        }),
        dirty: true,
      };
    });
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

  forgetRecent(path: string) {
    set((state) => ({
      recent: state.recent.filter((entry) => entry !== path),
    }));
  },

  addToRecent(path: string) {
    set((state) => ({
      recent: [path, ...state.recent.filter((entry) => entry !== path)].slice(0, 10),
    }));
  },
}));

export type UseProjectStore = typeof useProjectStore;
