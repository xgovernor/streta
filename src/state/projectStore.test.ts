import { beforeEach, describe, expect, test } from "bun:test";
import { GEOGRAPHIC_CRS } from "../lib/gis/crs";
import { groupLayers, orderedLayers } from "../lib/gis/datasets";
import { parseGeoJson } from "../lib/gis/geojson";
import { useProjectStore } from "./projectStore";

const survey = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "zrh",
      geometry: { type: "Point", coordinates: [8.5417, 47.3769] },
      properties: { name: "Zurich", signal: 98 },
    },
    {
      type: "Feature",
      id: "lis",
      geometry: { type: "Point", coordinates: [-9.1393, 38.7223] },
      properties: { name: "Lisbon", signal: 91 },
    },
  ],
});

function addImportedDataset(name = "Imported survey") {
  const { features } = parseGeoJson(survey);

  return useProjectStore.getState().addDataset({
    name,
    kind: "file",
    source: `${name}.geojson`,
    layers: [
      {
        name,
        features,
        crs: GEOGRAPHIC_CRS,
        format: "geojson",
        source: `${name}.geojson`,
      },
    ],
  });
}

describe("project store", () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
  });

  test("starts empty after a new project and can be seeded again", () => {
    expect(useProjectStore.getState().layers.length).toBe(0);
    expect(useProjectStore.getState().datasets.length).toBe(0);

    useProjectStore.getState().addSampleDataset();
    const state = useProjectStore.getState();

    expect(state.datasets.map((dataset) => dataset.name)).toEqual([
      "Survey network",
    ]);
    expect(state.layers.map((layer) => layer.name)).toEqual([
      "Survey routes",
      "Survey stations",
    ]);
    expect(state.layers.every((layer) => layer.datasetId === state.datasets[0].id)).toBe(
      true,
    );

    // Seeding twice does not duplicate the sample.
    useProjectStore.getState().addSampleDataset();
    expect(useProjectStore.getState().datasets.length).toBe(1);
    expect(useProjectStore.getState().layers.length).toBe(2);
  });

  test("adds a dataset with its own layer stack, uniquely named and activated", () => {
    const first = useProjectStore.getState().addDataset({
      name: "Survey",
      layers: [
        { name: "Survey", features: parseGeoJson(survey).features, crs: GEOGRAPHIC_CRS, format: "geojson" },
        { name: "Survey", features: parseGeoJson(survey).features, crs: GEOGRAPHIC_CRS, format: "geojson" },
      ],
    });
    const second = addImportedDataset("Survey");

    const state = useProjectStore.getState();

    expect(state.datasets.map((dataset) => dataset.name)).toEqual([
      "Survey",
      "Survey 2",
    ]);
    // Layer names stay unique across the workspace, and each dataset numbers
    // its own stack from zero.
    expect(state.layers.map((layer) => layer.name)).toEqual([
      "Survey",
      "Survey 2",
      "Survey 3",
    ]);
    expect(first.layers.map((layer) => layer.order)).toEqual([0, 1]);
    expect(second.layers[0].order).toBe(0);
    expect(first.layers.map((layer) => layer.datasetId)).toEqual([
      first.dataset.id,
      first.dataset.id,
    ]);
    expect(state.activeLayerId).toBe(second.layers[0].id);
    expect(state.dirty).toBe(true);
  });

  test("orders the workspace by dataset first, then by the layer stack", () => {
    const first = addImportedDataset("First");
    const second = addImportedDataset("Second");
    const state = useProjectStore.getState();

    expect(
      orderedLayers(state.datasets, state.layers).map((layer) => layer.name),
    ).toEqual(["First", "Second"]);

    useProjectStore
      .getState()
      .moveDataset(second.dataset.id, -1);

    const moved = useProjectStore.getState();

    expect(
      groupLayers(moved.datasets, moved.layers).map((group) => group.dataset.name),
    ).toEqual(["Second", "First"]);
    expect(moved.layers.map((layer) => layer.id)).toEqual([
      first.layers[0].id,
      second.layers[0].id,
    ]);
  });

  test("moves a layer inside its dataset without crossing into another", () => {
    const { dataset, layers } = useProjectStore.getState().addDataset({
      name: "Two layers",
      layers: [
        { name: "A", features: parseGeoJson(survey).features, crs: GEOGRAPHIC_CRS, format: "geojson" },
        { name: "B", features: parseGeoJson(survey).features, crs: GEOGRAPHIC_CRS, format: "geojson" },
      ],
    });
    const other = addImportedDataset("Other");
    const store = useProjectStore.getState();

    const stackOf = (id: string) => {
      const state = useProjectStore.getState();
      return groupLayers(state.datasets, state.layers).find(
        (group) => group.dataset.id === id,
      );
    };

    // B is already at the top of its dataset, so this does nothing.
    store.moveLayer(layers[1].id, 1);
    expect(stackOf(dataset.id)?.layers.map((layer) => layer.name)).toEqual([
      "A",
      "B",
    ]);

    store.moveLayer(layers[1].id, -1);

    const top = stackOf(dataset.id)?.layers ?? [];
    expect(top.map((layer) => layer.name)).toEqual(["B", "A"]);
    expect(top.map((layer) => layer.order)).toEqual([0, 1]);

    // A layer never leaves its dataset through the stack buttons.
    expect(
      useProjectStore
        .getState()
        .layers.filter((layer) => layer.datasetId === other.dataset.id)
        .map((layer) => layer.name),
    ).toEqual(["Other"]);
  });

  test("trusts no payload: reprojects a layer in place and updates its extent", () => {
    const layer = addImportedDataset().layers[0];

    useProjectStore.getState().setLayerCrs(layer.id, "EPSG:25832");

    const updated = useProjectStore.getState().layers[0];

    // Lisbon sits far outside zone 32, so it lands west of the false easting;
    // Zurich lands near 463 km east and 5 247 km north.
    expect(updated.crs).toBe("EPSG:25832");
    expect(updated.extent?.[0]).toBeLessThan(0);
    expect(updated.extent?.[2]).toBeGreaterThan(400_000);

    const [easting, northing] = updated.features[0].geometry
      .coordinates as number[];

    expect(easting).toBeGreaterThan(400_000);
    expect(easting).toBeLessThan(470_000);
    expect(northing).toBeGreaterThan(5_240_000);
  });

  test("keeps styling, visibility and opacity per layer", () => {
    const layer = addImportedDataset().layers[0];
    const store = useProjectStore.getState();

    store.setLayerStyle(layer.id, { color: "#4db2ff", labelField: "name" });
    store.setLayerOpacity(layer.id, 1.4);
    store.setLayerVisible(layer.id, false);

    const updated = useProjectStore.getState().layers[0];

    expect(updated.style.color).toBe("#4db2ff");
    expect(updated.style.labelField).toBe("name");
    expect(updated.opacity).toBe(1);
    expect(updated.visible).toBe(false);
  });

  test("toggles every layer of a dataset at once", () => {
    useProjectStore.getState().addSampleDataset();
    const dataset = useProjectStore.getState().datasets[0];

    useProjectStore.getState().setDatasetVisible(dataset.id, false);
    expect(useProjectStore.getState().layers.every((layer) => !layer.visible)).toBe(
      true,
    );

    useProjectStore.getState().setDatasetVisible(dataset.id, true);
    expect(useProjectStore.getState().layers.every((layer) => layer.visible)).toBe(
      true,
    );
  });

  test("records and clears the selection with its layer", () => {
    const layer = addImportedDataset().layers[0];

    useProjectStore.getState().select({ layerId: layer.id, featureId: "zrh" });
    expect(useProjectStore.getState().selection).toEqual({
      layerId: layer.id,
      featureId: "zrh",
    });

    useProjectStore.getState().clearSelection();
    expect(useProjectStore.getState().selection).toBeNull();
  });

  test("removes the dataset when its last layer goes", () => {
    const layer = addImportedDataset().layers[0];

    useProjectStore.getState().select({ layerId: layer.id, featureId: "zrh" });
    useProjectStore.getState().removeLayer(layer.id);

    expect(useProjectStore.getState().layers.length).toBe(0);
    expect(useProjectStore.getState().datasets.length).toBe(0);
    expect(useProjectStore.getState().selection).toBeNull();
    expect(useProjectStore.getState().activeLayerId).toBeNull();
  });

  test("removing a dataset takes its layers and leaves the others alone", () => {
    useProjectStore.getState().addSampleDataset();
    const kept = addImportedDataset("Kept");
    const sample = useProjectStore.getState().datasets[0];

    useProjectStore.getState().removeDataset(sample.id);

    const state = useProjectStore.getState();

    expect(state.datasets.map((dataset) => dataset.name)).toEqual(["Kept"]);
    expect(state.layers.map((layer) => layer.id)).toEqual([kept.layers[0].id]);
    expect(state.datasets[0].order).toBe(0);
  });

  test("tracks measurement state", () => {
    const store = useProjectStore.getState();

    store.setMeasureMode("area");
    expect(useProjectStore.getState().measureMode).toBe("area");

    useProjectStore.getState().setMeasureSummary({
      mode: "area",
      distance: 1000,
      area: 10_000,
      vertices: 4,
    });
    expect(useProjectStore.getState().measureSummary?.area).toBe(10_000);

    useProjectStore.getState().setMeasureMode("off");
    expect(useProjectStore.getState().measureMode).toBe("off");
    // Summary is preserved on pause so measurements stay visible
    expect(useProjectStore.getState().measureSummary?.area).toBe(10_000);

    useProjectStore.getState().setMeasureSummary(null);
    expect(useProjectStore.getState().measureSummary).toBeNull();
  });
});
