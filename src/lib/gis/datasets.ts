import { readStoredLayers } from "./layers";
import type { Dataset, DatasetLayer, DatasetKind } from "./types";

/**
 * A workspace is a stack of datasets, and every dataset owns its own stack of
 * layers. Draw order runs from the first dataset to the last, and within a
 * dataset from its first layer to its last: later draws on top. The panels show
 * the same order reversed, because the thing drawn last belongs at the top of
 * the list.
 */

const DATASET_KINDS = new Set<DatasetKind>(["file", "library", "sample", "join"]);

let counter = 0;

export function newDatasetId(): string {
  counter += 1;
  return `dataset-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function uniqueDatasetName(existing: string[], wanted: string): string {
  const base = wanted.trim() || "Untitled dataset";

  if (!existing.includes(base)) {
    return base;
  }

  let suffix = 2;

  while (existing.includes(`${base} ${suffix}`)) {
    suffix += 1;
  }

  return `${base} ${suffix}`;
}

export interface CreateDatasetInput {
  name: string;
  kind?: DatasetKind;
  libraryId?: string | null;
  source?: string | null;
  order?: number;
}

export function createDataset(input: CreateDatasetInput): Dataset {
  return {
    id: newDatasetId(),
    name: input.name.trim() || "Untitled dataset",
    kind: input.kind ?? "file",
    libraryId: input.libraryId ?? null,
    source: input.source ?? null,
    collapsed: false,
    order: input.order ?? 0,
    createdAt: new Date().toISOString(),
  };
}

export interface DatasetGroup {
  dataset: Dataset;
  /** The dataset's own stack, in draw order. */
  layers: DatasetLayer[];
}

function byOrder<T extends { order: number; createdAt?: string; id: string }>(
  left: T,
  right: T,
): number {
  return (
    left.order - right.order ||
    (left.createdAt ?? "").localeCompare(right.createdAt ?? "") ||
    left.id.localeCompare(right.id)
  );
}

/** Every dataset with its layers, in draw order. */
export function groupLayers(
  datasets: Dataset[],
  layers: DatasetLayer[],
): DatasetGroup[] {
  const groups = new Map<string, DatasetLayer[]>(
    datasets.map((dataset) => [dataset.id, []]),
  );

  for (const layer of layers) {
    groups.get(layer.datasetId)?.push(layer);
  }

  return [...datasets]
    .sort(byOrder)
    .map((dataset) => ({
      dataset,
      layers: (groups.get(dataset.id) ?? []).sort(byOrder),
    }));
}

/** The whole workspace flattened into the order the map draws it. */
export function orderedLayers(
  datasets: Dataset[],
  layers: DatasetLayer[],
): DatasetLayer[] {
  return groupLayers(datasets, layers).flatMap((group) => group.layers);
}

export function nextLayerOrder(
  layers: DatasetLayer[],
  datasetId: string,
): number {
  return layers.filter((layer) => layer.datasetId === datasetId).length;
}

export function reindexDatasets(datasets: Dataset[]): Dataset[] {
  return [...datasets]
    .sort(byOrder)
    .map((dataset, index) => ({ ...dataset, order: index }));
}

/** Numbers the layers of each dataset from 0, in the order they are drawn. */
export function reindexLayers(layers: DatasetLayer[]): DatasetLayer[] {
  const byDataset = new Map<string, DatasetLayer[]>();

  for (const layer of layers) {
    const group = byDataset.get(layer.datasetId);

    if (group) {
      group.push(layer);
    } else {
      byDataset.set(layer.datasetId, [layer]);
    }
  }

  const renumbered = new Map<string, DatasetLayer>();

  for (const group of byDataset.values()) {
    [...group].sort(byOrder).forEach((layer, order) => {
      renumbered.set(
        layer.id,
        layer.order === order ? layer : { ...layer, order },
      );
    });
  }

  return layers.map((layer) => renumbered.get(layer.id) ?? layer);
}

/** Moves a layer one step inside its dataset; it never crosses into another. */
export function moveLayerWithinDataset(
  layers: DatasetLayer[],
  id: string,
  delta: number,
): DatasetLayer[] {
  const layer = layers.find((item) => item.id === id);

  if (!layer) {
    return layers;
  }

  const siblings = layers
    .filter((item) => item.datasetId === layer.datasetId)
    .sort(byOrder);
  const index = siblings.findIndex((item) => item.id === id);
  const target = index + delta;

  if (index < 0 || target < 0 || target >= siblings.length) {
    // The ends of a dataset are the ends of the stack; the panel offers no
    // button there, and a stale click does nothing.
    return layers;
  }

  const reordered = [...siblings];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(target, 0, moved);

  const order = new Map(reordered.map((item, position) => [item.id, position]));

  return layers.map((item) => {
    const next = order.get(item.id);
    return next === undefined || item.order === next ?
        item
      : { ...item, order: next };
  });
}

/** Moves a whole dataset one step in the outer stack. */
export function moveDataset(
  datasets: Dataset[],
  id: string,
  delta: number,
): Dataset[] {
  const ordered = [...datasets].sort(byOrder);
  const index = ordered.findIndex((dataset) => dataset.id === id);
  const target = index + delta;

  if (index < 0 || target < 0 || target >= ordered.length) {
    return datasets;
  }

  const [moved] = ordered.splice(index, 1);
  ordered.splice(target, 0, moved);

  return ordered.map((dataset, order) =>
    dataset.order === order ? dataset : { ...dataset, order },
  );
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Validates a dataset that came from a session or a project file. */
export function readStoredDataset(value: unknown): Dataset | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";

  if (!name) {
    return null;
  }

  return {
    id:
      typeof candidate.id === "string" && candidate.id ?
        candidate.id
      : newDatasetId(),
    name,
    kind:
      typeof candidate.kind === "string" &&
      DATASET_KINDS.has(candidate.kind as DatasetKind) ?
        (candidate.kind as DatasetKind)
      : "file",
    libraryId:
      typeof candidate.libraryId === "string" ? candidate.libraryId : null,
    source: typeof candidate.source === "string" ? candidate.source : null,
    collapsed: candidate.collapsed === true,
    order: finite(candidate.order, 0),
    createdAt:
      typeof candidate.createdAt === "string" ?
        candidate.createdAt
      : new Date().toISOString(),
  };
}

export interface StoredWorkspace {
  datasets: Dataset[];
  layers: DatasetLayer[];
  warnings: string[];
}

/**
 * Reads a workspace that may predate datasets. Earlier files stored one flat
 * list of layers, where a layer was the unit; those become one dataset each,
 * named after the layer they hold.
 */
export function readWorkspace(
  datasetsValue: unknown,
  layersValue: unknown,
): StoredWorkspace {
  const warnings: string[] = [];
  const stored = readStoredLayers(layersValue);
  warnings.push(...stored.warnings);

  const datasets: Dataset[] = [];
  const known = new Set<string>();

  for (const entry of Array.isArray(datasetsValue) ? datasetsValue : []) {
    const dataset = readStoredDataset(entry);

    if (!dataset) {
      warnings.push("a stored dataset had no name and was skipped");
      continue;
    }

    if (known.has(dataset.id)) {
      continue;
    }

    known.add(dataset.id);
    datasets.push(dataset);
  }

  const grouped = new Map<string, DatasetLayer[]>();
  const adopted: Dataset[] = [];

  for (const layer of stored.layers) {
    if (layer.datasetId && known.has(layer.datasetId)) {
      grouped.set(layer.datasetId, [
        ...(grouped.get(layer.datasetId) ?? []),
        layer,
      ]);
      continue;
    }

    // A layer with no dataset of its own: a file written before datasets
    // existed, or one whose dataset was dropped. Give it one rather than
    // losing it.
    const dataset = createDataset({
      name: layer.name,
      kind: "file",
      source: layer.source,
      order: datasets.length + adopted.length,
    });

    adopted.push(dataset);
    grouped.set(dataset.id, [{ ...layer, datasetId: dataset.id, order: 0 }]);
  }

  const next = reindexDatasets([...datasets, ...adopted]);

  return {
    datasets: next,
    layers: reindexLayers(
      next.flatMap((dataset) => grouped.get(dataset.id) ?? []),
    ),
    warnings,
  };
}
