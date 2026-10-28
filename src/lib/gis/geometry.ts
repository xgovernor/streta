import type {
  Attributes,
  Extent,
  FeatureRecord,
  FieldInfo,
  Geometry,
  GeometryKind,
  Position,
} from "./types";

const EARTH_RADIUS = 6371008.8;
const TO_RADIANS = Math.PI / 180;

/** Walks every coordinate of a geometry. */
export function eachPosition(
  geometry: Geometry,
  visit: (position: Position) => void,
): void {
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) {
      return;
    }

    if (value.length > 0 && typeof value[0] === "number") {
      visit(value as Position);
      return;
    }

    value.forEach(walk);
  };

  walk(geometry.coordinates);
}

export function positionsAreFinite(geometry: Geometry): boolean {
  let finite = true;

  eachPosition(geometry, (position) => {
    if (!Number.isFinite(position[0]) || !Number.isFinite(position[1])) {
      finite = false;
    }
  });

  return finite;
}

/** Bounding box of a geometry, recomputed after any reprojection. */
export function geometryExtent(geometry: Geometry): Extent | null {
  let extent: Extent | null = null;

  eachPosition(geometry, ([x, y]) => {
    if (!extent) {
      extent = [x, y, x, y];
      return;
    }

    if (x < extent[0]) extent[0] = x;
    if (y < extent[1]) extent[1] = y;
    if (x > extent[2]) extent[2] = x;
    if (y > extent[3]) extent[3] = y;
  });

  return extent;
}

export function haversineMeters(a: Position, b: Position): number {
  const deltaLat = (b[1] - a[1]) * TO_RADIANS;
  const deltaLon = (b[0] - a[0]) * TO_RADIANS;
  const latA = a[1] * TO_RADIANS;
  const latB = b[1] * TO_RADIANS;

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function lineLength(positions: Position[]): number {
  let total = 0;

  for (let index = 1; index < positions.length; index += 1) {
    total += haversineMeters(positions[index - 1], positions[index]);
  }

  return total;
}

/**
 * Geodesic area of a ring on a sphere, via the trapezoid formula. Positive for
 * rings wound counter-clockwise in lon/lat.
 */
function ringArea(ring: Position[]): number {
  if (ring.length < 3) {
    return 0;
  }

  let total = 0;

  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    total += (next[0] - current[0]) * (2 + Math.sin(current[1] * TO_RADIANS) + Math.sin(next[1] * TO_RADIANS));
  }

  return (total * TO_RADIANS * EARTH_RADIUS * EARTH_RADIUS) / 2;
}

/** Length in metres of any geometry, treating rings as outlines. */
export function geometryLength(geometry: Geometry): number {
  const coordinates = geometry.coordinates as never;

  switch (geometry.type) {
    case "Point":
    case "MultiPoint":
      return 0;
    case "LineString":
      return lineLength(coordinates as Position[]);
    case "MultiLineString":
      return (coordinates as Position[][]).reduce(
        (total, line) => total + lineLength(line),
        0,
      );
    case "Polygon":
      return (coordinates as Position[][]).reduce(
        (total, ring) => total + lineLength(ring),
        0,
      );
    case "MultiPolygon":
      return (coordinates as Position[][][]).reduce(
        (total, polygon) => total + geometryLength({ type: "Polygon", coordinates: polygon }),
        0,
      );
    default:
      return 0;
  }
}

/** Geodesic area in square metres. Points, lines and open rings report 0. */
export function geometryArea(geometry: Geometry): number {
  switch (geometry.type) {
    case "Polygon": {
      const rings = geometry.coordinates as Position[][];
      return rings.reduce(
        (total, ring, index) => total + (index === 0 ? Math.abs(ringArea(ring)) : -Math.abs(ringArea(ring))),
        0,
      );
    }
    case "MultiPolygon":
      return (geometry.coordinates as Position[][][]).reduce(
        (total, polygon) => total + geometryArea({ type: "Polygon", coordinates: polygon }),
        0,
      );
    default:
      return 0;
  }
}

export function geometryVertexCount(geometry: Geometry): number {
  let count = 0;
  eachPosition(geometry, () => {
    count += 1;
  });
  return count;
}

/** Arithmetic centre of a geometry's coordinates, used for labels and zoom. */
export function geometryCentroid(geometry: Geometry): Position | null {
  let x = 0;
  let y = 0;
  let count = 0;

  eachPosition(geometry, (position) => {
    x += position[0];
    y += position[1];
    count += 1;
  });

  return count ? [x / count, y / count] : null;
}

export function mergeExtents(a: Extent | null, b: Extent | null): Extent | null {
  if (!a) return b;
  if (!b) return a;
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

export function featureExtent(features: FeatureRecord[]): Extent | null {
  let extent: Extent | null = null;

  for (const feature of features) {
    extent = mergeExtents(extent, geometryExtent(feature.geometry));
  }

  return extent;
}

export function isEmptyGeometry(geometry: Geometry): boolean {
  return geometryExtent(geometry) === null;
}

/**
 * Single and multi geometries of the same family describe the same layer: a
 * district shapefile is polygons whether or not a few districts come in parts.
 * Only a layer that genuinely mixes points, lines and polygons reports Mixed.
 */
const GEOMETRY_FAMILY: Record<GeometryKind, GeometryKind> = {
  Point: "Point",
  MultiPoint: "Point",
  LineString: "LineString",
  MultiLineString: "LineString",
  Polygon: "Polygon",
  MultiPolygon: "Polygon",
};

export function geometryKindOf(features: FeatureRecord[]): GeometryKind | "Mixed" {
  let family: GeometryKind | null = null;
  let kind: GeometryKind | null = null;

  for (const feature of features) {
    const type = feature.geometry.type;
    const group = GEOMETRY_FAMILY[type];

    if (family === null) {
      family = group;
      kind = type;
    } else if (family !== group) {
      return "Mixed";
    } else if (kind !== type) {
      kind = group;
    }
  }

  return kind ?? "Point";
}

/** Layers of point/line/polygon counts, used by the catalogue and summaries. */
export function kindCounts(features: FeatureRecord[]): Record<string, number> {
  const counts: Record<string, number> = {
    point: 0,
    line: 0,
    polygon: 0,
  };

  for (const feature of features) {
    const type = feature.geometry.type;

    if (type === "Point" || type === "MultiPoint") {
      counts.point += 1;
    } else if (type === "LineString" || type === "MultiLineString") {
      counts.line += 1;
    } else {
      counts.polygon += 1;
    }
  }

  return counts;
}

function attributeType(value: unknown): FieldInfo["type"] {
  if (value === null || value === undefined || value === "") {
    return "empty";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  return "text";
}

/** Field list for a dataset, in first-seen order, with fill ratios. */
export function inferFields(features: FeatureRecord[]): FieldInfo[] {
  const order: string[] = [];
  const stats = new Map<string, { numbers: number; texts: number; booleans: number; filled: number }>();

  for (const feature of features) {
    for (const [name, value] of Object.entries(feature.properties)) {
      let entry = stats.get(name);

      if (!entry) {
        entry = { numbers: 0, texts: 0, booleans: 0, filled: 0 };
        stats.set(name, entry);
        order.push(name);
      }

      switch (attributeType(value)) {
        case "number":
          entry.numbers += 1;
          entry.filled += 1;
          break;
        case "boolean":
          entry.booleans += 1;
          entry.filled += 1;
          break;
        case "text":
          entry.texts += 1;
          entry.filled += 1;
          break;
        default:
          break;
      }
    }
  }

  const total = Math.max(1, features.length);

  return order.map((name) => {
    const entry = stats.get(name) as { numbers: number; texts: number; booleans: number; filled: number };

    let type: FieldInfo["type"] = "empty";
    if (entry.numbers > 0 && entry.numbers >= entry.texts) {
      type = "number";
    } else if (entry.texts > 0) {
      type = "text";
    } else if (entry.booleans > 0) {
      type = "boolean";
    }

    return { name, type, fill: entry.filled / total };
  });
}

/** Numeric range of a field, or null when it holds no numbers. */
export function numericRange(
  features: FeatureRecord[],
  field: string,
): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let found = false;

  for (const feature of features) {
    const value = feature.properties[field];
    const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;

    if (!Number.isFinite(numeric)) {
      continue;
    }

    found = true;
    min = Math.min(min, numeric);
    max = Math.max(max, numeric);
  }

  return found ? { min, max } : null;
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }

  if (typeof value === "number") {
    return Number.isInteger(value)
      ? new Intl.NumberFormat("en-US").format(value)
      : value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }

  return String(value);
}

/** Attribute rows used by the search index and the attribute table. */
export function searchableText(
  properties: Attributes,
  fields: string[],
): string {
  return fields.map((field) => displayValue(properties[field])).join(" ").toLowerCase();
}
