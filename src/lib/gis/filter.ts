import type {
  AttributeValue,
  DatasetLayer,
  FeatureRecord,
  LayerFilter,
} from "./types";

/**
 * Attribute filters are a view, not a cut: the layer keeps every feature and the
 * map and table read the ones the facets let through. Values are compared as
 * text, because that is what a stored filter can carry through a project file
 * without guessing the field's type back.
 */

/** The value a facet compares against; empty means the field has no value. */
export function filterKey(value: AttributeValue | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function isFilterActive(filter: LayerFilter): boolean {
  return filter.values.length > 0;
}

/** The facets that actually narrow the layer; an empty one means "all". */
export function activeFilters(filters: LayerFilter[]): LayerFilter[] {
  return filters.filter(isFilterActive);
}

export function hasActiveFilters(layer: Pick<DatasetLayer, "filters">): boolean {
  return activeFilters(layer.filters).length > 0;
}

/** Every facet must pass: fields are ANDed, values inside a field are ORed. */
export function featureMatches(
  feature: FeatureRecord,
  filters: LayerFilter[],
): boolean {
  return filters.every((filter) =>
    filter.values.includes(filterKey(feature.properties[filter.field])),
  );
}

const visibleCache = new WeakMap<
  FeatureRecord[],
  { filters: LayerFilter[]; features: FeatureRecord[] }
>();

/**
 * The features the layer currently shows. Unfiltered layers hand back their own
 * array, and a filtered result is cached per feature array and filter list, so
 * rendering can call this without copying thousands of features each time.
 */
export function visibleFeatures(layer: DatasetLayer): FeatureRecord[] {
  const filters = activeFilters(layer.filters);

  if (!filters.length) {
    return layer.features;
  }

  const cached = visibleCache.get(layer.features);

  if (cached && cached.filters === layer.filters) {
    return cached.features;
  }

  const matches = layer.features.filter((feature) =>
    featureMatches(feature, filters),
  );

  visibleCache.set(layer.features, { filters: layer.filters, features: matches });
  return matches;
}

export interface FacetValue {
  value: string;
  count: number;
}

/** Distinct non-empty values of a field, most common first. */
export function facetValues(
  features: FeatureRecord[],
  field: string,
): FacetValue[] {
  const counts = new Map<string, number>();

  for (const feature of features) {
    const key = filterKey(feature.properties[field]);

    if (!key) {
      continue;
    }

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

export interface FilterableField {
  field: string;
  distinct: number;
}

/** Fields worth offering as a facet: two or more distinct values. */
export function filterableFields(layer: DatasetLayer): FilterableField[] {
  const fields: FilterableField[] = [];

  for (const { name } of layer.fields) {
    const distinct = new Set<string>();

    for (const feature of layer.features) {
      const key = filterKey(feature.properties[name]);

      if (key) {
        distinct.add(key);
      }
    }

    if (distinct.size >= 2) {
      fields.push({ field: name, distinct: distinct.size });
    }
  }

  return fields;
}

export function addFilter(filters: LayerFilter[], field: string): LayerFilter[] {
  if (!field || filters.some((filter) => filter.field === field)) {
    return filters;
  }

  return [...filters, { field, values: [] }];
}

export function removeFilter(
  filters: LayerFilter[],
  field: string,
): LayerFilter[] {
  return filters.filter((filter) => filter.field !== field);
}

export function toggleFilterValue(
  filters: LayerFilter[],
  field: string,
  value: string,
): LayerFilter[] {
  const existing = filters.find((filter) => filter.field === field);

  if (!existing) {
    return [...filters, { field, values: [value] }];
  }

  const values = existing.values.includes(value)
    ? existing.values.filter((item) => item !== value)
    : [...existing.values, value];

  return filters.map((filter) =>
    filter.field === field ? { field, values } : filter,
  );
}

/**
 * Filters come from a session or a project file, so only fields the layer still
 * has are kept; a facet left over from a different dataset is dropped instead of
 * silently hiding every feature.
 */
export function readFilters(
  value: unknown,
  fields: Set<string>,
): LayerFilter[] {
  const filters: LayerFilter[] = [];
  const seen = new Set<string>();

  for (const entry of Array.isArray(value) ? value : []) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const candidate = entry as Record<string, unknown>;
    const field = typeof candidate.field === "string" ? candidate.field : "";

    if (!field || !fields.has(field) || seen.has(field)) {
      continue;
    }

    const values = Array.isArray(candidate.values)
      ? [
        ...new Set(
          candidate.values.filter(
            (item): item is string => typeof item === "string" && item !== "",
          ),
        ),
      ]
      : [];

    if (!values.length) {
      continue;
    }

    seen.add(field);
    filters.push({ field, values: values.sort() });
  }

  return filters;
}
