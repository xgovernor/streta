import { beforeEach, describe, expect, test } from "bun:test";
import { hasCrs } from "./gis/crs";
import { parseGeoJson } from "./gis/geojson";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";
import { useUiStore } from "../state/uiStore";
import {
  ProjectError,
  applyProjectText,
  importDatasetText,
  joinTableOntoLayer,
  parseProject,
  serializeProject,
} from "./projectFile";

const survey = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "zrh",
      geometry: { type: "Point", coordinates: [8.5417, 47.3769] },
      properties: { name: "Zurich", signal: 98 },
    },
  ],
});

function seedProject() {
  const { layers } = useProjectStore.getState().addDataset({
    name: "Field survey",
    kind: "file",
    source: "survey.geojson",
    layers: [
      {
        name: "Survey",
        features: parseGeoJson(survey).features,
        crs: "EPSG:4326",
        format: "geojson",
        source: "survey.geojson",
      },
    ],
  });
  const layer = layers[0];

  useProjectStore.getState().setLayerStyle(layer.id, {
    color: "#4db2ff",
    labelField: "name",
  });
  useProjectStore.getState().setLayerOpacity(layer.id, 0.6);
  useProjectStore.getState().setLayerVisible(layer.id, false);
  useUiStore.getState().setTheme("light");
  useUiStore.getState().setBasemap("midnight");
  useMapStore.getState().setCamera({
    lon: 5,
    lat: 45,
    zoom: 7.5,
    rotation: 0.2,
    resolution: 1000,
  });

  return layer;
}

describe("project files", () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useUiStore.getState().setTheme("dark");
    useUiStore.getState().setBasemap("positron");
  });

  test("round-trips layers, styling, view and preferences", () => {
    seedProject();

    const text = serializeProject();
    const parsed = parseProject(text);

    expect(parsed.warnings).toEqual([]);
    expect(parsed.datasets.length).toBe(1);
    expect(parsed.datasets[0].name).toBe("Field survey");
    expect(parsed.layers.length).toBe(1);
    expect(parsed.layers[0].name).toBe("Survey");
    expect(parsed.layers[0].datasetId).toBe(parsed.datasets[0].id);
    expect(parsed.layers[0].style.color).toBe("#4db2ff");
    expect(parsed.layers[0].style.labelField).toBe("name");
    expect(parsed.layers[0].opacity).toBeCloseTo(0.6, 5);
    expect(parsed.layers[0].visible).toBe(false);
    expect(parsed.layers[0].features[0].properties.name).toBe("Zurich");
    expect(parsed.project.preferences.theme).toBe("light");
    expect(parsed.project.preferences.basemap).toBe("midnight");
    expect(parsed.project.view.zoom).toBeCloseTo(7.5, 5);
  });

  test("applies a project to the stores in place", () => {
    seedProject();

    const text = serializeProject();
    useProjectStore.getState().newProject();

    const result = applyProjectText(
      text,
      "field-work.strata",
      "/tmp/field-work.strata",
    );
    const state = useProjectStore.getState();

    expect(result.name).toBe("field-work");
    expect(result.layerCount).toBe(1);
    expect(result.featureCount).toBe(1);
    expect(state.layers.length).toBe(1);
    expect(state.projectName).toBe("field-work");
    expect(state.projectPath).toBe("/tmp/field-work.strata");
    expect(state.dirty).toBe(false);
    expect(useUiStore.getState().theme).toBe("light");
    expect(useUiStore.getState().basemap).toBe("midnight");
    expect(useMapStore.getState().camera.zoom).toBeCloseTo(7.5, 5);
  });

  test("registers custom projections carried by the file", () => {
    const document = JSON.parse(serializeProject()) as Record<string, unknown>;

    document.layers = [
      {
        name: "Custom grid",
        crs: "CUSTOM:9901",
        features: [
          {
            id: "f1",
            geometry: { type: "Point", coordinates: [500_000, 200_000] },
            properties: { name: "Site" },
          },
        ],
      },
    ];
    document.crsDefinitions = [
      {
        code: "CUSTOM:9901",
        name: "Local grid",
        proj: "+proj=tmerc +lat_0=0 +lon_0=9 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs",
      },
    ];

    const parsed = parseProject(JSON.stringify(document));

    expect(hasCrs("CUSTOM:9901")).toBe(true);
    expect(parsed.layers[0].crs).toBe("CUSTOM:9901");
    expect(parsed.warnings).toEqual([]);
  });

  test("opens a version 1 file by giving each layer its own dataset", () => {
    const layer = {
      name: "Old boundaries",
      crs: "EPSG:4326",
      features: [
        {
          id: "f1",
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: { name: "Site" },
        },
      ],
    };

    const parsed = parseProject(
      JSON.stringify({
        schema: "strata.project",
        version: 1,
        name: "Legacy",
        layers: [layer, { ...layer, name: "Old sites" }],
      }),
    );

    expect(parsed.layers.length).toBe(2);
    expect(parsed.datasets.map((dataset) => dataset.name)).toEqual([
      "Old boundaries",
      "Old sites",
    ]);
    expect(parsed.layers.map((item) => item.datasetId)).toEqual(
      parsed.datasets.map((dataset) => dataset.id),
    );
  });

  test("refuses files that are not projects and drops unreadable layers", () => {
    expect(() => parseProject("not json")).toThrow(ProjectError);
    expect(() => parseProject("[]")).toThrow(/must be a JSON object/);
    expect(() => parseProject('{"schema":"other","version":1}')).toThrow(
      /not a Strata project/,
    );
    expect(() =>
      parseProject('{"schema":"strata.project","version":99,"layers":[]}'),
    ).toThrow(/newer version/);

    const document = JSON.parse(serializeProject()) as Record<string, unknown>;
    document.layers = [
      { name: "No CRS", features: [] },
      {
        name: "Good",
        crs: "EPSG:4326",
        features: [
          {
            id: "f1",
            geometry: { type: "Point", coordinates: [1, 2] },
            properties: {},
          },
        ],
      },
    ];

    const parsed = parseProject(JSON.stringify(document));
    expect(parsed.layers.length).toBe(1);
    expect(parsed.warnings.length).toBe(1);
  });
});

describe("dataset import", () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
  });

  test("imports GeoJSON text and reports the feature count", () => {
    const outcome = importDatasetText(
      survey,
      "survey.geojson",
      "survey.geojson",
    );

    expect(outcome.featureCount).toBe(1);
    expect(outcome.crs).toBe("EPSG:4326");
    expect(outcome.warnings).toEqual([]);
    expect(useProjectStore.getState().layers.length).toBe(1);
    expect(useProjectStore.getState().layers[0].source).toBe("survey.geojson");
  });

  test("imports CSV text and warns when the coordinates look projected", () => {
    const outcome = importDatasetText(
      "easting;northing;name\n463000;5247000;Zurich",
      "sites.csv",
      null,
    );

    expect(outcome.layer.features.length).toBe(1);
    expect(outcome.warnings.join(" ")).toMatch(/look projected/);
    expect(useProjectStore.getState().layers[0].crs).toBe("EPSG:4326");
  });

  test("a join lands as its own dataset and leaves the boundary layer alone", () => {
    const target = seedProject();
    const before = useProjectStore.getState().datasets.length;

    const result = joinTableOntoLayer({
      tableText: "name,T_TL\nZurich,42\n",
      tableName: "population",
      keyColumn: "name",
      targetLayerId: target.id,
      targetField: "name",
    });

    const state = useProjectStore.getState();
    const untouched = state.layers.find((layer) => layer.id === target.id);

    expect(state.datasets.length).toBe(before + 1);
    expect(result.layer.datasetId).not.toBe(target.datasetId);
    expect(state.datasets.find((item) => item.id === result.layer.datasetId)?.kind).toBe(
      "join",
    );
    expect(Number(result.layer.features[0].properties.T_TL)).toBe(42);
    expect(untouched?.features[0].properties.T_TL).toBeUndefined();
  });

  test("imports a WKT line file", () => {
    const outcome = importDatasetText(
      "POINT (7.44 46.95)\tBern\nLINESTRING (0 0, 1 1)",
      "shapes.wkt",
      null,
    );

    expect(outcome.featureCount).toBe(2);
    expect(outcome.layer.geometryKind).toBe("Mixed");
  });
});
