import { describe, expect, test } from "bun:test";
import { crsInfo } from "./crs";
import {
  createLayer,
  layerGeometryKinds,
  measureLayer,
  paletteColor,
  readStoredLayer,
  readStoredLayers,
  reprojectLayer,
  uniqueLayerName,
} from "./layers";
import type { FeatureRecord } from "./types";

const points: FeatureRecord[] = [
  {
    id: "a",
    geometry: { type: "Point", coordinates: [8.5417, 47.3769] },
    properties: { name: "Zurich", signal: 98 },
  },
  {
    id: "b",
    geometry: { type: "Point", coordinates: [-9.1393, 38.7223] },
    properties: { name: "Lisbon", signal: 91 },
  },
];

const square: FeatureRecord[] = [
  {
    id: "area",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    },
    properties: { name: "Degree square" },
  },
];

describe("createLayer", () => {
  test("derives fields, extent, kind and styling", () => {
    const layer = createLayer({
      datasetId: "dataset-a",
      name: "  Stations  ",
      features: points,
      crs: "epsg:4326",
      format: "geojson",
      color: paletteColor(1),
    });

    expect(layer.name).toBe("Stations");
    expect(layer.crs).toBe("EPSG:4326");
    expect(layer.geometryKind).toBe("Point");
    expect(layer.features.length).toBe(2);
    expect(layer.fields.map((field) => field.name)).toEqual(["name", "signal"]);
    expect(layer.extent?.[0]).toBeCloseTo(-9.1393, 6);
    expect(layer.extent?.[3]).toBeCloseTo(47.3769, 6);
    expect(layer.visible).toBe(true);
    expect(layer.opacity).toBe(1);
    expect(layer.style.color).toBe(paletteColor(1));
    expect(layer.style.labelField).toBeNull();
  });

  test("falls back to WGS 84 for an unknown CRS", () => {
    const layer = createLayer({
      datasetId: "dataset-a",
      name: "Unlabelled",
      features: points,
      crs: "EPSG:999999",
      format: "csv",
    });

    expect(layer.crs).toBe("EPSG:4326");
    expect(layer.name).toBe("Unlabelled");
  });
});

describe("naming and ordering", () => {
  test("keeps layer names distinct", () => {
    expect(uniqueLayerName([], "Field")).toBe("Field");
    expect(uniqueLayerName(["Field"], "Field")).toBe("Field 2");
    expect(uniqueLayerName(["Field", "Field 2"], "Field")).toBe("Field 3");
    expect(uniqueLayerName([], "   ")).toBe("Untitled layer");
  });

  test("gives a new layer the dataset it was created for", () => {
    const layer = createLayer({
      datasetId: "dataset-a",
      name: "A",
      features: points,
      crs: "EPSG:4326",
      format: "csv",
    });

    expect(layer.datasetId).toBe("dataset-a");
  });
});

describe("reprojectLayer", () => {
  test("reprojects the coordinates and recomputes the extent", () => {
    const layer = createLayer({
      datasetId: "dataset-a",
      name: "Stations",
      features: points,
      crs: "EPSG:4326",
      format: "geojson",
    });

    const projected = reprojectLayer(layer, "EPSG:25832").layer;
    const [easting, northing] = projected.features[0].geometry.coordinates as number[];

    expect(projected.crs).toBe("EPSG:25832");
    expect(easting).toBeGreaterThan(455_000);
    expect(easting).toBeLessThan(470_000);
    expect(northing).toBeGreaterThan(5_240_000);
    expect(northing).toBeLessThan(5_260_000);
    expect(projected.extent?.[2]).toBeGreaterThan(400_000);
    expect(crsInfo(projected.crs)?.units).toBe("metre");
  });

  test("is a no-op for the same CRS", () => {
    const layer = createLayer({
      datasetId: "dataset-a",
      name: "Stations",
      features: points,
      crs: "EPSG:4326",
      format: "geojson",
    });

    expect(reprojectLayer(layer, "EPSG:4326").layer).toBe(layer);
    expect(reprojectLayer(layer, "not a crs").layer).toBe(layer);
    expect(reprojectLayer(layer, "EPSG:4326").dropped).toBe(0);
  });

  test("reports features that fall outside the target projection", () => {
    const worldwide = createLayer({
      datasetId: "dataset-a",
      name: "Worldwide",
      features: [
        {
          id: "zrh",
          geometry: { type: "Point", coordinates: [8.5417, 47.3769] },
          properties: {},
        },
        {
          id: "sin",
          geometry: { type: "Point", coordinates: [103.8198, 1.3521] },
          properties: {},
        },
      ],
      crs: "EPSG:4326",
      format: "geojson",
    });

    const outcome = reprojectLayer(worldwide, "EPSG:25832");

    expect(outcome.dropped).toBe(1);
    expect(outcome.layer.features.map((feature) => feature.id)).toEqual(["zrh"]);
    expect(outcome.layer.extent?.[0]).toBeGreaterThan(400_000);
  });
});

describe("measureLayer", () => {
  test("reports geodesic totals whatever the storage CRS", () => {
    const layer = createLayer({
      datasetId: "dataset-a",
      name: "Square",
      features: square,
      crs: "EPSG:4326",
      format: "geojson",
    });

    const measures = measureLayer(layer);

    expect(measures.counts).toEqual({ point: 0, line: 0, polygon: 1 });
    expect(measures.areaSquareMeters / 1_000_000).toBeGreaterThan(12_240);
    expect(measures.areaSquareMeters / 1_000_000).toBeLessThan(12_490);
    expect(measures.lengthMeters).toBeCloseTo(444_780, -2);
    expect(layerGeometryKinds(layer)).toBe("1 area");
  });
});

describe("readStoredLayer", () => {
  test("rebuilds derived values and defaults", () => {
    const result = readStoredLayer({
      name: "Imported",
      crs: "EPSG:25832",
      features: [
        {
          id: "f1",
          geometry: { type: "Point", coordinates: [463_000, 5_247_000] },
          properties: { name: "Zurich" },
        },
      ],
      style: { color: "#4db2ff", strokeWidth: 3 },
    });

    expect("layer" in result).toBe(true);

    if (!("layer" in result)) {
      return;
    }

    expect(result.layer.crs).toBe("EPSG:25832");
    expect(result.layer.fields[0].name).toBe("name");
    expect(result.layer.extent).toEqual([463_000, 5_247_000, 463_000, 5_247_000]);
    expect(result.layer.style.strokeWidth).toBe(3);
    expect(result.layer.style.fillOpacity).toBeCloseTo(0.22, 5);
    expect(result.layer.visible).toBe(true);
    expect(result.layer.filters).toEqual([]);
  });

  test("keeps stored filters that still match a field", () => {
    const result = readStoredLayer({
      name: "Sites",
      crs: "EPSG:4326",
      features: [
        {
          id: "f1",
          geometry: { type: "Point", coordinates: [8.5, 47.3] },
          properties: { operator: "Equinix" },
        },
      ],
      filters: [
        { field: "operator", values: ["Equinix"] },
        // A facet from another dataset would hide every feature here.
        { field: "material", values: ["concrete"] },
      ],
    });

    expect("layer" in result).toBe(true);

    if (!("layer" in result)) {
      return;
    }

    expect(result.layer.filters).toEqual([
      { field: "operator", values: ["Equinix"] },
    ]);
  });

  test("rejects broken layers with a reason", () => {
    expect(readStoredLayer(null)).toMatchObject({ reason: expect.any(String) });
    expect(readStoredLayer({ name: "", crs: "EPSG:4326", features: [] })).toMatchObject({
      reason: expect.any(String),
    });
    expect(
      readStoredLayer({ name: "Nowhere", crs: "EPSG:12000", features: [] }),
    ).toMatchObject({ reason: expect.stringContaining("EPSG:12000") });
    expect(readStoredLayer({ name: "Empty", crs: "EPSG:4326", features: [] })).toMatchObject({
      reason: expect.any(String),
    });
  });

  test("validates a whole stack and renumbers the order", () => {
    const { layers, warnings } = readStoredLayers([
      { name: "Broken", crs: "EPSG:4326", features: [] },
      {
        name: "Good",
        crs: "EPSG:4326",
        order: 7,
        features: [
          {
            id: "f1",
            geometry: { type: "Point", coordinates: [1, 2] },
            properties: {},
          },
        ],
      },
      "not a layer",
    ]);

    expect(layers.length).toBe(1);
    expect(layers[0].name).toBe("Good");
    // The order is kept as stored; the workspace reader numbers each dataset.
    expect(layers[0].order).toBe(7);
    expect(warnings.length).toBe(2);
  });
});
