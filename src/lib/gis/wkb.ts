import type { Geometry, GeometryKind, Position } from "./types";

/**
 * Well-known binary, read-only. GeoPackage stores every geometry as a WKB blob
 * behind its own header, so this is the piece that turns those bytes into the
 * same shape the GeoJSON reader produces.
 *
 * ISO WKB carries dimensions in the type code: +1000 is Z, +2000 is M, +3000
 * both. Z ordinates are kept (the app already carries three-value positions),
 * M ordinates are read and dropped.
 */

export class WkbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WkbError";
  }
}

const BASE_TYPES: Record<number, GeometryKind> = {
  1: "Point",
  2: "LineString",
  3: "Polygon",
  4: "MultiPoint",
  5: "MultiLineString",
  6: "MultiPolygon",
};

/** Expected child type of each multi-geometry, used to spot nested encoding. */
const CHILD_TYPE: Partial<Record<GeometryKind, number>> = {
  MultiPoint: 1,
  MultiLineString: 2,
  MultiPolygon: 3,
};

interface Cursor {
  view: DataView;
  offset: number;
  little: boolean;
}

interface Dimensions {
  kind: GeometryKind;
  hasZ: boolean;
  hasM: boolean;
}

function uint32(cursor: Cursor): number {
  const value = cursor.view.getUint32(cursor.offset, cursor.little);
  cursor.offset += 4;
  return value;
}

function double(cursor: Cursor): number {
  const value = cursor.view.getFloat64(cursor.offset, cursor.little);
  cursor.offset += 8;
  return value;
}

function readType(cursor: Cursor): Dimensions {
  const raw = uint32(cursor);
  const kind = BASE_TYPES[raw % 1000];

  if (!kind) {
    throw new WkbError(`Unsupported geometry type ${raw}`);
  }

  return {
    kind,
    hasZ: (raw >= 1000 && raw < 2000) || raw >= 3000,
    hasM: raw >= 2000,
  };
}

function readPosition(cursor: Cursor, dimensions: Dimensions): Position {
  const x = double(cursor);
  const y = double(cursor);

  if (dimensions.hasZ && dimensions.hasM) {
    const z = double(cursor);
    double(cursor);
    return [x, y, z];
  }

  if (dimensions.hasZ) {
    return [x, y, double(cursor)];
  }

  if (dimensions.hasM) {
    double(cursor);
  }

  return [x, y];
}

function readPositions(cursor: Cursor, dimensions: Dimensions, count: number): Position[] {
  const positions: Position[] = [];

  for (let index = 0; index < count; index += 1) {
    positions.push(readPosition(cursor, dimensions));
  }

  return positions;
}

function readRing(cursor: Cursor, dimensions: Dimensions): Position[] {
  return readPositions(cursor, dimensions, uint32(cursor));
}

/**
 * OGC WKB nests a full geometry (byte order and type code included) inside each
 * multi-geometry, but some writers emit the children as bare coordinate arrays
 * instead. The first child settles which encoding this file uses.
 */
function childrenAreNested(cursor: Cursor, kind: GeometryKind): boolean {
  const order = cursor.view.getUint8(cursor.offset);

  if (order !== 0 && order !== 1) {
    return false;
  }

  const next = cursor.view.getUint32(cursor.offset + 1, order === 1);
  return next % 1000 === CHILD_TYPE[kind];
}

function readGeometry(cursor: Cursor): Geometry {
  const order = cursor.view.getUint8(cursor.offset);
  cursor.offset += 1;

  if (order !== 0 && order !== 1) {
    throw new WkbError(`Unknown byte order ${order}`);
  }

  cursor.little = order === 1;
  const dimensions = readType(cursor);

  switch (dimensions.kind) {
    case "Point":
      return { type: "Point", coordinates: readPosition(cursor, dimensions) };

    case "LineString":
      return {
        type: "LineString",
        coordinates: readPositions(cursor, dimensions, uint32(cursor)),
      };

    case "Polygon": {
      const rings = uint32(cursor);
      const coordinates: Position[][] = [];

      for (let index = 0; index < rings; index += 1) {
        coordinates.push(readRing(cursor, dimensions));
      }

      return { type: "Polygon", coordinates };
    }

    case "MultiPoint": {
      const count = uint32(cursor);

      if (!childrenAreNested(cursor, "MultiPoint")) {
        return { type: "MultiPoint", coordinates: readPositions(cursor, dimensions, count) };
      }

      const coordinates: Position[] = [];

      for (let index = 0; index < count; index += 1) {
        const point = readGeometry(cursor);

        if (point.type === "Point") {
          coordinates.push(point.coordinates as Position);
        }
      }

      return { type: "MultiPoint", coordinates };
    }

    case "MultiLineString": {
      const count = uint32(cursor);
      const nested = childrenAreNested(cursor, "MultiLineString");
      const coordinates: Position[][] = [];

      for (let index = 0; index < count; index += 1) {
        if (nested) {
          const line = readGeometry(cursor);

          if (line.type === "LineString") {
            coordinates.push(line.coordinates as Position[]);
          }
        } else {
          coordinates.push(readPositions(cursor, dimensions, uint32(cursor)));
        }
      }

      return { type: "MultiLineString", coordinates };
    }

    default: {
      const count = uint32(cursor);
      const nested = childrenAreNested(cursor, "MultiPolygon");
      const coordinates: Position[][][] = [];

      for (let index = 0; index < count; index += 1) {
        if (nested) {
          const polygon = readGeometry(cursor);

          if (polygon.type === "Polygon") {
            coordinates.push(polygon.coordinates as Position[][]);
          }

          continue;
        }

        const rings = uint32(cursor);
        const rings_: Position[][] = [];

        for (let ring = 0; ring < rings; ring += 1) {
          rings_.push(readRing(cursor, dimensions));
        }

        coordinates.push(rings_);
      }

      return { type: "MultiPolygon", coordinates };
    }
  }
}

/**
 * Reads one geometry from a buffer and reports where it ended, so callers can
 * walk records that follow one another.
 */
export function readWkb(buffer: Uint8Array, offset = 0): { geometry: Geometry; offset: number } {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const cursor: Cursor = { view, offset, little: true };
  const geometry = readGeometry(cursor);

  return { geometry, offset: cursor.offset };
}
