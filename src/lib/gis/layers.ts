import {
  GEOGRAPHIC_CRS,
  hasCrs,
  normalizeCrsCode,
  transformGeometry,
} from "./crs";
import {
  featureExtent,
  geometryArea,
  geometryKindOf,
  geometryLength,
  inferFields,
  kindCounts,
  positionsAreFinite,
} from "./geometry";
import { readFilters } from "./filter";
import { isLayerFormat } from "./types";
import type {
  DatasetLayer,
  FeatureRecord,
  Geometry,
  GeometryKind,
  LayerFilter,
  LayerFormat,
  LayerStyle,
} from "./types";

/** Distinct hues that stay readable on both basemap families. */
export const PALETTE = [
  "#ff8a4d",
  "#4db2ff",
  "#5fd6a4",
  "#ffc857",
  "#c48cff",
  "#ff6b8b",
  "#7ce0d3",
  "#b8e06a",
];

export function paletteColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export function defaultStyle(color: string): LayerStyle {
  return {
    color,
    strokeWidth: 1.8,
    pointRadius: 4.5,
    fillOpacity: 0.22,
    labelField: null,
  };
}

let counter = 0;

export function layerId(): string {
  counter += 1;
  return `layer-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function uniqueLayerName(existing: string[], wanted: string): string {
  const base = wanted.trim() || "Untitled layer";

  if (!existing.includes(base)) {
    return base;
  }

  let suffix = 2;

  while (existing.includes(`${base} ${suffix}`)) {
    suffix += 1;
  }

  return `${base} ${suffix}`;
}

export interface CreateLayerInput {
  name: string;
  /** The dataset whose stack the layer joins. */
  datasetId: string;
  features: FeatureRecord[];
  crs: string;
  format: LayerFormat;
  source?: string | null;
  style?: Partial<LayerStyle>;
  filters?: LayerFilter[];
  color?: string;
  order?: number;
}

export function createLayer(input: CreateLayerInput): DatasetLayer {
  // A CRS that cannot be resolved would render as nothing on the map, so it is
  // replaced with WGS 84 and the importer reports the substitution.
  const requested = normalizeCrsCode(input.crs);
  const crs = requested && hasCrs(requested) ? requested : GEOGRAPHIC_CRS;
  const color = input.style?.color ?? input.color ?? paletteColor(0);

  return {
    id: layerId(),
    datasetId: input.datasetId,
    name: input.name.trim() || "Untitled layer",
    crs,
    format: input.format,
    source: input.source ?? null,
    geometryKind: geometryKindOf(input.features),
    features: input.features,
    fields: inferFields(input.features),
    extent: featureExtent(input.features),
    style: { ...defaultStyle(color), ...input.style },
    filters: input.filters ?? [],
    visible: true,
    opacity: 1,
    order: input.order ?? 0,
    createdAt: new Date().toISOString(),
  };
}

export interface ReprojectOutcome {
  layer: DatasetLayer;
  /** Features that fall outside the target projection and were dropped. */
  dropped: number;
}

/**
 * Materialises the layer's features in another CRS. Coordinates are stored in
 * the layer's own CRS, so switching CRS must reproject the data, not just the
 * label. Projections have finite domains — a global dataset squeezed into a
 * national grid loses the points outside it, which the caller reports.
 */
export function reprojectLayer(layer: DatasetLayer, crs: string): ReprojectOutcome {
  const target = normalizeCrsCode(crs);

  if (!target || target === layer.crs) {
    return { layer, dropped: 0 };
  }

  const features: FeatureRecord[] = [];
  let dropped = 0;

  for (const feature of layer.features) {
    try {
      const geometry = transformGeometry(feature.geometry, layer.crs, target);

      if (!positionsAreFinite(geometry)) {
        dropped += 1;
        continue;
      }

      features.push({ ...feature, geometry });
    } catch {
      dropped += 1;
    }
  }

  return {
    layer: {
      ...layer,
      crs: target,
      features,
      extent: featureExtent(features),
      geometryKind: geometryKindOf(features.length ? features : layer.features),
    },
    dropped,
  };
}

export interface LayerMeasures {
  lengthMeters: number;
  areaSquareMeters: number;
  counts: Record<string, number>;
}

/**
 * Geodesic totals for the layer. Coordinates are pulled back to WGS 84 first,
 * so the numbers are metres whatever CRS the data is stored in.
 */
export function measureLayer(layer: DatasetLayer): LayerMeasures {
  let lengthMeters = 0;
  let areaSquareMeters = 0;

  for (const feature of layer.features) {
    try {
      const geometry: Geometry =
        layer.crs === GEOGRAPHIC_CRS
          ? feature.geometry
          : transformGeometry(feature.geometry, layer.crs, GEOGRAPHIC_CRS);

      lengthMeters += geometryLength(geometry);
      areaSquareMeters += geometryArea(geometry);
    } catch {
      // A feature that cannot be pulled back to WGS 84 contributes nothing,
      // rather than breaking the panel that displays the totals.
    }
  }

  return {
    lengthMeters,
    areaSquareMeters,
    counts: kindCounts(layer.features),
  };
}

const GEOMETRY_TYPES = new Set<GeometryKind>([
  "Point",
  "LineString",
  "Polygon",
  "MultiPoint",
  "MultiLineString",
  "MultiPolygon",
]);

function readFeature(value: unknown): FeatureRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const geometry = candidate.geometry as
    | { type?: unknown; coordinates?: unknown }
    | undefined;

  if (
    typeof candidate.id !== "string" ||
    !geometry ||
    typeof geometry.type !== "string" ||
    !GEOMETRY_TYPES.has(geometry.type as GeometryKind) ||
    !Array.isArray(geometry.coordinates)
  ) {
    return null;
  }

  const record: FeatureRecord = {
    id: candidate.id,
    geometry: {
      type: geometry.type as GeometryKind,
      coordinates: geometry.coordinates,
    },
    properties:
      typeof candidate.properties === "object" && candidate.properties !== null
        ? (candidate.properties as FeatureRecord["properties"])
        : {},
  };

  return positionsAreFinite(record.geometry) ? record : null;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Validates a layer that came from disk (a session or a project file). Ids, CRS
 * codes and features are all checked, and every derived value is recomputed
 * rather than trusted.
 */
export function readStoredLayer(
  value: unknown,
): { layer: DatasetLayer } | { reason: string } {
  if (typeof value !== "object" || value === null) {
    return { reason: "a stored layer was not an object" };
  }

  const candidate = value as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const crs = normalizeCrsCode(candidate.crs) ?? "";

  if (!name) {
    return { reason: "a stored layer had no name" };
  }

  if (!crs || !hasCrs(crs)) {
    return {
      reason: `“${name}” uses ${String(candidate.crs ?? "an unknown CRS")}, which is not registered`,
    };
  }

  if (!Array.isArray(candidate.features)) {
    return { reason: `“${name}” had no feature data` };
  }

  const features = candidate.features
    .map(readFeature)
    .filter((feature): feature is FeatureRecord => feature !== null);

  if (!features.length) {
    return { reason: `“${name}” had no readable features` };
  }

  const style = (candidate.style ?? {}) as Partial<LayerStyle>;
  const format = isLayerFormat(candidate.format) ? candidate.format : "geojson";
  const fields = inferFields(features);

  return {
    layer: {
      id:
        typeof candidate.id === "string"
          ? candidate.id
          : `layer-${Math.random().toString(36).slice(2)}`,
      // An empty id marks a layer from a file that predates datasets; the
      // workspace reader gives it one of its own.
      datasetId:
        typeof candidate.datasetId === "string" ? candidate.datasetId : "",
      name,
      crs,
      format,
      source: typeof candidate.source === "string" ? candidate.source : null,
      geometryKind: geometryKindOf(features),
      features,
      fields,
      extent: featureExtent(features),
      style: {
        color: typeof style.color === "string" ? style.color : paletteColor(0),
        strokeWidth: finite(style.strokeWidth, 1.8),
        pointRadius: finite(style.pointRadius, 4.5),
        fillOpacity: finite(style.fillOpacity, 0.22),
        labelField: typeof style.labelField === "string" ? style.labelField : null,
      },
      filters: readFilters(
        candidate.filters,
        new Set(fields.map((field) => field.name)),
      ),
      visible: candidate.visible !== false,
      opacity: Math.min(1, Math.max(0, finite(candidate.opacity, 1))),
      order: finite(candidate.order, 0),
      createdAt:
        typeof candidate.createdAt === "string"
          ? candidate.createdAt
          : new Date().toISOString(),
    },
  };
}

export function readStoredLayers(value: unknown): {
  layers: DatasetLayer[];
  warnings: string[];
} {
  const layers: DatasetLayer[] = [];
  const warnings: string[] = [];

  for (const entry of Array.isArray(value) ? value : []) {
    const result = readStoredLayer(entry);

    if ("layer" in result) {
      layers.push(result.layer);
    } else {
      warnings.push(result.reason);
    }
  }

  // Order is left as stored: it is an index inside a dataset, and the workspace
  // reader numbers each dataset's stack once the layers are grouped.
  return { layers, warnings };
}

export function layerGeometryKinds(layer: DatasetLayer): string {
  const { counts } = measureLayer(layer);
  const parts: string[] = [];

  if (counts.point) parts.push(`${counts.point} point${counts.point === 1 ? "" : "s"}`);
  if (counts.line) parts.push(`${counts.line} line${counts.line === 1 ? "" : "s"}`);
  if (counts.polygon) parts.push(`${counts.polygon} area${counts.polygon === 1 ? "" : "s"}`);

  return parts.join(" · ") || "empty";
}
