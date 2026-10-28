import { describe, expect, test } from "bun:test";
import {
  activeFilters,
  addFilter,
  facetValues,
  featureMatches,
  filterableFields,
  filterKey,
  hasActiveFilters,
  readFilters,
  removeFilter,
  toggleFilterValue,
  visibleFeatures,
} from "./filter";
import { createLayer } from "./layers";
import type { FeatureRecord, LayerFilter } from "./types";

const sites: FeatureRecord[] = [
  {
    id: "a",
    geometry: { type: "Point", coordinates: [8.5, 47.3] },
    properties: { name: "Zurich", operator: "Equinix", material: "concrete" },
  },
  {
    id: "b",
    geometry: { type: "Point", coordinates: [4.8, 45.7] },
    properties: { name: "Lyon", operator: "Equinix", material: "soil" },
  },
  {
    id: "c",
    geometry: { type: "Point", coordinates: [2.3, 48.8] },
    properties: { name: "Paris", operator: "EDF", material: null },
  },
];

function layer(filters: LayerFilter[] = []) {
  return createLayer({
    name: "Sites",
    datasetId: "dataset-a",
    features: sites,
    crs: "EPSG:4326",
    format: "geojson",
    filters,
  });
}

describe("filterKey", () => {
  test("reads attributes as the text a stored filter holds", () => {
    expect(filterKey("Equinix")).toBe("Equinix");
    expect(filterKey(7)).toBe("7");
    expect(filterKey(false)).toBe("false");
    expect(filterKey(null)).toBe("");
    expect(filterKey(undefined)).toBe("");
  });
});

describe("featureMatches", () => {
  test("ORs values inside a field and ANDs fields together", () => {
    const operatorOnly = [{ field: "operator", values: ["EDF"] }];
    const both = [
      { field: "operator", values: ["Equinix"] },
      { field: "material", values: ["soil"] },
    ];

    expect(featureMatches(sites[2], operatorOnly)).toBe(true);
    expect(featureMatches(sites[1], both)).toBe(true);
    expect(featureMatches(sites[0], both)).toBe(false);
  });

  test("an empty facet has no opinion", () => {
    expect(activeFilters([{ field: "operator", values: [] }])).toEqual([]);
    expect(featureMatches(sites[0], [])).toBe(true);
  });
});

describe("visibleFeatures", () => {
  test("hands back the layer's own array when nothing is filtered", () => {
    const built = layer();

    expect(visibleFeatures(built)).toBe(built.features);
    expect(hasActiveFilters(built)).toBe(false);
  });

  test("keeps the matching features and caches the result", () => {
    const built = layer([{ field: "operator", values: ["Equinix"] }]);
    const shown = visibleFeatures(built);

    expect(shown.map((feature) => feature.id)).toEqual(["a", "b"]);
    expect(visibleFeatures(built)).toBe(shown);
    // The layer itself still holds every feature.
    expect(built.features.length).toBe(3);
  });

  test("a new filter list is a new result", () => {
    const built = layer([{ field: "operator", values: ["Equinix"] }]);
    const next = { ...built, filters: [{ field: "operator", values: ["EDF"] }] };

    expect(visibleFeatures(built).map((feature) => feature.id)).toEqual(["a", "b"]);
    expect(visibleFeatures(next).map((feature) => feature.id)).toEqual(["c"]);
  });
});

describe("facetValues", () => {
  test("counts distinct non-empty values, most common first", () => {
    const values = facetValues(sites, "operator");

    expect(values).toEqual([
      { value: "Equinix", count: 2 },
      { value: "EDF", count: 1 },
    ]);
    expect(facetValues(sites, "material")).toEqual([
      { value: "concrete", count: 1 },
      { value: "soil", count: 1 },
    ]);
  });

  test("a missing field offers no facet", () => {
    expect(facetValues(sites, "missing")).toEqual([]);
  });
});

describe("filterableFields", () => {
  test("offers fields with at least two distinct values", () => {
    const built = createLayer({
      name: "Mixed",
      datasetId: "dataset-a",
      features: [
        {
          id: "a",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: { kind: "same", value: "one" },
        },
        {
          id: "b",
          geometry: { type: "Point", coordinates: [1, 1] },
          properties: { kind: "same", value: "two" },
        },
      ],
      crs: "EPSG:4326",
      format: "geojson",
    });

    expect(filterableFields(built)).toEqual([{ field: "value", distinct: 2 }]);
  });
});

describe("filter editing", () => {
  const filters: LayerFilter[] = [{ field: "operator", values: ["EDF"] }];

  test("adds a field once", () => {
    expect(addFilter(filters, "material")).toEqual([
      { field: "operator", values: ["EDF"] },
      { field: "material", values: [] },
    ]);
    expect(addFilter(filters, "operator")).toEqual(filters);
    expect(addFilter(filters, "")).toEqual(filters);
  });

  test("toggles a value on and off without reordering the facets", () => {
    const added = toggleFilterValue(filters, "operator", "Equinix");

    expect(added).toEqual([
      { field: "operator", values: ["EDF", "Equinix"] },
    ]);
    expect(toggleFilterValue(added, "operator", "EDF")).toEqual([
      { field: "operator", values: ["Equinix"] },
    ]);
    expect(toggleFilterValue(added, "material", "soil")).toEqual([
      { field: "operator", values: ["EDF", "Equinix"] },
      { field: "material", values: ["soil"] },
    ]);
  });

  test("removes a facet", () => {
    expect(removeFilter(filters, "operator")).toEqual([]);
    expect(removeFilter(filters, "material")).toEqual(filters);
  });
});

describe("readFilters", () => {
  const fields = new Set(["operator", "material"]);

  test("keeps known fields and drops the rest", () => {
    expect(
      readFilters(
        [
          { field: "operator", values: ["EDF", "EDF", "Equinix"] },
          { field: "name", values: ["Paris"] },
          { field: "material", values: [] },
        ],
        fields,
      ),
    ).toEqual([{ field: "operator", values: ["EDF", "Equinix"] }]);
  });

  test("rejects anything that is not a facet", () => {
    expect(readFilters(null, fields)).toEqual([]);
    expect(readFilters("operator", fields)).toEqual([]);
    expect(readFilters([null, 42, { field: 7, values: ["x"] }], fields)).toEqual([]);
    expect(
      readFilters([{ field: "operator", values: [null, 3, ""] }], fields),
    ).toEqual([]);
  });

  test("keeps one facet per field", () => {
    expect(
      readFilters(
        [
          { field: "operator", values: ["EDF"] },
          { field: "operator", values: ["Equinix"] },
        ],
        fields,
      ),
    ).toEqual([{ field: "operator", values: ["EDF"] }]);
  });
});
