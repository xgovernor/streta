import { describe, expect, test } from "bun:test";
import {
  createDataset,
  groupLayers,
  moveDataset,
  moveLayerWithinDataset,
  orderedLayers,
  readWorkspace,
  reindexLayers,
  uniqueDatasetName,
} from "./datasets";
import { createLayer } from "./layers";
import type { FeatureRecord } from "./types";

const point: FeatureRecord = {
  id: "p1",
  geometry: { type: "Point", coordinates: [1, 2] },
  properties: { name: "Site" },
};

function layer(datasetId: string, name: string, order: number) {
  return createLayer({
    name,
    datasetId,
    features: [point],
    crs: "EPSG:4326",
    format: "geojson",
    order,
  });
}

describe("dataset grouping", () => {
  test("draws datasets in order, and each dataset's own stack in order", () => {
    const older = createDataset({ name: "Older", order: 0 });
    const newer = createDataset({ name: "Newer", order: 1 });

    const layers = [
      layer(older.id, "older top", 1),
      layer(newer.id, "newer bottom", 0),
      layer(older.id, "older bottom", 0),
    ];

    const groups = groupLayers([newer, older], layers);

    expect(groups.map((group) => group.dataset.name)).toEqual([
      "Older",
      "Newer",
    ]);
    expect(groups[0].layers.map((item) => item.name)).toEqual([
      "older bottom",
      "older top",
    ]);
    expect(
      orderedLayers([newer, older], layers).map((item) => item.name),
    ).toEqual(["older bottom", "older top", "newer bottom"]);
  });

  test("renumbers each dataset from zero without mixing stacks together", () => {
    const first = createDataset({ name: "First", order: 0 });
    const second = createDataset({ name: "Second", order: 1 });

    const renumbered = reindexLayers([
      layer(first.id, "a", 0),
      layer(second.id, "b", 5),
      layer(first.id, "c", 9),
    ]);

    const orderOf = (name: string) =>
      renumbered.find((item) => item.name === name)?.order;

    expect(orderOf("a")).toBe(0);
    expect(orderOf("c")).toBe(1);
    expect(orderOf("b")).toBe(0);
  });

  test("moves a layer only within its dataset", () => {
    const dataset = createDataset({ name: "Group", order: 0 });
    const other = createDataset({ name: "Other", order: 1 });

    const layers = [
      layer(dataset.id, "bottom", 0),
      layer(dataset.id, "top", 1),
      layer(other.id, "elsewhere", 0),
    ];

    const moved = moveLayerWithinDataset(layers, layers[0].id, 1);
    const group = groupLayers([dataset, other], moved);

    expect(group[0].layers.map((item) => item.name)).toEqual(["top", "bottom"]);
    // The neighbouring dataset is untouched by its neighbour's shuffle.
    expect(group[1].layers.map((item) => item.name)).toEqual(["elsewhere"]);

    // Past the top of its own dataset: nothing happens.
    const clamped = moveLayerWithinDataset(moved, layers[0].id, 1);
    expect(groupLayers([dataset, other], clamped)[0].layers[1].name).toBe(
      "bottom",
    );
  });

  test("moves whole datasets and renumbers the outer stack", () => {
    const first = createDataset({ name: "First", order: 0 });
    const second = createDataset({ name: "Second", order: 1 });
    const third = createDataset({ name: "Third", order: 2 });

    const moved = moveDataset([first, second, third], third.id, -1);

    expect(groupLayers(moved, []).map((group) => group.dataset.name)).toEqual([
      "First",
      "Third",
      "Second",
    ]);
    expect(moved.map((dataset) => dataset.order)).toEqual([0, 1, 2]);

    // The first dataset cannot move below the bottom of the stack.
    expect(
      groupLayers(moveDataset(moved, first.id, -1), []).map(
        (group) => group.dataset.name,
      ),
    ).toEqual(["First", "Third", "Second"]);
  });

  test("keeps dataset names distinct", () => {
    expect(uniqueDatasetName([], " Boundaries ")).toBe("Boundaries");
    expect(uniqueDatasetName(["Boundaries"], "Boundaries")).toBe(
      "Boundaries 2",
    );
    expect(uniqueDatasetName([], "   ")).toBe("Untitled dataset");
  });
});

describe("readWorkspace", () => {
  test("turns a flat list of layers from an older file into datasets", () => {
    const stored = [
      { name: "Boundaries", crs: "EPSG:4326", features: [point] },
      { name: "Sites", crs: "EPSG:4326", features: [point], order: 3 },
    ];

    const { datasets, layers, warnings } = readWorkspace(undefined, stored);

    expect(warnings).toEqual([]);
    expect(datasets.map((dataset) => dataset.name)).toEqual([
      "Boundaries",
      "Sites",
    ]);
    expect(layers.map((item) => item.datasetId)).toEqual(
      datasets.map((dataset) => dataset.id),
    );
    // Each dataset numbers its own single-layer stack from zero.
    expect(layers.map((item) => item.order)).toEqual([0, 0]);
  });

  test("keeps a layer whose dataset is missing, with a dataset of its own", () => {
    const known = createDataset({ name: "Known", order: 0 });

    const { datasets, layers, warnings } = readWorkspace(
      [known, { name: "", order: 1 }, "not a dataset"],
      [
        { datasetId: known.id, name: "Inside", crs: "EPSG:4326", features: [point], order: 0 },
        { datasetId: "dataset-gone", name: "Orphan", crs: "EPSG:4326", features: [point] },
      ],
    );

    expect(warnings.length).toBe(2);
    expect(datasets.map((dataset) => dataset.name)).toEqual([
      "Known",
      "Orphan",
    ]);
    expect(layers.find((item) => item.name === "Orphan")?.datasetId).toBe(
      datasets[1].id,
    );
  });

  test("reverses a round trip of datasets and their layers", () => {
    const dataset = createDataset({ name: "Round trip", order: 0 });
    const layers = [layer(dataset.id, "one", 0), layer(dataset.id, "two", 1)];

    const read = readWorkspace([dataset], layers);

    expect(read.datasets[0]).toMatchObject({
      id: dataset.id,
      name: "Round trip",
      kind: "file",
    });
    expect(read.layers.map((item) => item.name)).toEqual(["one", "two"]);
    expect(groupLayers(read.datasets, read.layers)[0].layers.length).toBe(2);
  });
});
