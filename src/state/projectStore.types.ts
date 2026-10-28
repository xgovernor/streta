import type { Dataset, DatasetLayer, LayerFilter, LayerStyle, MeasureSummary, Selection } from "../lib/gis/types";

export interface RecentEntry {
  name: string;
  featureCount: number;
  color: string;
  crs: string;
  source: string;
}

export interface ProjectStore {
  layers: DatasetLayer[];
  datasets: Dataset[];
  selection: Selection | null;
  activeLayerId: string | null;
  measureMode: "off" | "distance" | "area";
  measureSummary: MeasureSummary | null;
  projectName: string;
  projectPath: string | null;
  dirty: boolean;
  hydrationWarnings: string[];
  recent: RecentEntry[];

  dismissHydrationWarnings: () => void;
  newProject: () => void;
  addSampleDataset: () => { dataset: Dataset; layers: DatasetLayer[] };
  addDataset: (input: {
    name: string;
    kind?: "file" | "library" | "sample" | "join";
    libraryId?: string | null;
    source?: string | null;
    layers: {
      name: string;
      features: import("../lib/gis/types").FeatureRecord[];
      crs: string;
      format: DatasetLayer["format"];
      source?: string | null;
      style?: Partial<LayerStyle>;
      color?: string;
    }[];
  }) => { dataset: Dataset; layers: DatasetLayer[] };
  removeDataset: (datasetId: string) => void;
  removeLayer: (layerId: string) => void;
  renameDataset: (datasetId: string, name: string) => void;
  renameLayer: (layerId: string, name: string) => void;
  setActiveLayer: (layerId: string | null) => void;
  setLayerStyle: (layerId: string, style: Partial<LayerStyle>) => void;
  setLayerOpacity: (layerId: string, opacity: number) => void;
  setLayerVisible: (layerId: string, visible: boolean) => void;
  setDatasetVisible: (datasetId: string, visible: boolean) => void;
  setLayerFilters: (layerId: string, filters: LayerFilter[]) => void;
  setLayerCrs: (layerId: string, crs: string) => number;
  moveDataset: (datasetId: string, delta: number) => void;
  moveLayer: (layerId: string, delta: number) => void;
  toggleDataset: (datasetId: string) => void;
  setMeasureMode: (mode: "off" | "distance" | "area") => void;
  setMeasureSummary: (summary: MeasureSummary | null) => void;
  select: (selection: Selection) => void;
  clearSelection: () => void;
  lockSelection: (feature: { layerId: string; featureId: string }) => void;
  selectionFeatureById: (layerId: string, featureId?: string) => import("../lib/gis/types").FeatureRecord | null;
  setProjectName: (name: string) => void;
  setProjectPath: (path: string | null) => void;
  markSaved: () => void;
  loadProject: (project: {
    name: string;
    path: string | null;
    datasets: Dataset[];
    layers: DatasetLayer[];
  }) => void;
  forgetRecent: (name: string) => void;
  addToRecent: (entry: RecentEntry) => void;
}

