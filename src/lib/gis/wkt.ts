import type { Geometry, GeometryKind, Position } from "./types";

export class WktError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WktError";
  }
}

const SUPPORTED: Record<string, GeometryKind> = {
  POINT: "Point",
  LINESTRING: "LineString",
  POLYGON: "Polygon",
  MULTIPOINT: "MultiPoint",
  MULTILINESTRING: "MultiLineString",
  MULTIPOLYGON: "MultiPolygon",
};

const WKT_PATTERN =
  /^\s*(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON)\s*(ZM|Z|M)?\s*(EMPTY\b|\()/i;

export function looksLikeWkt(value: string): boolean {
  return WKT_PATTERN.test(value);
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";

  for (const character of input) {
    if (character === "(" || character === ")" || character === ",") {
      if (current.trim()) {
        tokens.push(current.trim());
      }
      current = "";
      tokens.push(character);
      continue;
    }

    current += character;
  }

  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens;
}

/**
 * Reads the WKT geometry types a field dataset realistically carries. Z
 * ordinates are preserved, M ordinates are parsed and dropped, and
 * GeometryCollection is rejected with a message the importer can surface.
 */
// Dimension alternatives are ordered longest-first so "ZM" is not read as "Z".
const HEADER = /^\s*([A-Za-z]+)\s*(ZM|Z|M)?\s*(EMPTY)?\s*/i;

export function parseWkt(input: string): Geometry {
  const header = HEADER.exec(input);
  const typeToken = (header?.[1] ?? "").toUpperCase();

  if (!typeToken) {
    throw new WktError("Empty WKT input");
  }

  if (typeToken.startsWith("GEOMETRYCOLLECTION")) {
    throw new WktError("GeometryCollection cannot be stored in one layer");
  }

  const type = SUPPORTED[typeToken];

  if (!type) {
    throw new WktError(`Unsupported WKT type "${typeToken}"`);
  }

  const dimension = (header?.[2]?.toUpperCase() ?? null) as "Z" | "M" | "ZM" | null;
  const empty = Boolean(header?.[3]);

  const tokens = tokenize(input.slice(header?.[0].length ?? 0));
  let cursor = 0;

  const peek = (offset = 0) => tokens[cursor + offset];
  const next = () => tokens[cursor++];

  const parsePosition = (token: string): Position => {
    const parts = token.split(/\s+/).filter(Boolean);

    if (parts.length < 2) {
      throw new WktError(`Coordinate "${token}" needs at least X and Y`);
    }

    const values = parts.map(Number);

    if (values.some((value) => !Number.isFinite(value))) {
      throw new WktError(`Coordinate "${token}" is not numeric`);
    }

    if (dimension === "M") {
      return values.slice(0, 2);
    }

    if (dimension === "ZM") {
      return values.slice(0, 3);
    }

    return values;
  };

  const parseRing = (): Position[] => {
    if (next() !== "(") {
      throw new WktError("Expected an opening parenthesis");
    }

    const ring: Position[] = [];

    while (peek() !== ")") {
      const token = next();

      if (token === undefined) {
        throw new WktError("Unterminated coordinate sequence");
      }

      if (token === ",") {
        continue;
      }

      ring.push(parsePosition(token));
    }

    next();
    return ring;
  };

  if (empty) {
    return { type, coordinates: [] };
  }

  let geometry: Geometry;

  switch (type) {
    case "Point": {
      if (next() !== "(") {
        throw new WktError("Expected an opening parenthesis after POINT");
      }
      const point = parsePosition(next() ?? "");
      if (next() !== ")") {
        throw new WktError("Unterminated point");
      }
      geometry = { type, coordinates: point };
      break;
    }
    case "LineString": {
      geometry = { type, coordinates: parseRing() };
      break;
    }
    case "Polygon": {
      if (next() !== "(") {
        throw new WktError("Expected an opening parenthesis after POLYGON");
      }
      const rings: Position[][] = [];

      while (peek() === "(") {
        rings.push(parseRing());
        if (peek() === ",") next();
      }

      if (next() !== ")") {
        throw new WktError("Unterminated polygon");
      }

      geometry = { type, coordinates: rings };
      break;
    }
    case "MultiPoint": {
      if (next() !== "(") {
        throw new WktError("Expected an opening parenthesis after MULTIPOINT");
      }
      const points: Position[] = [];

      while (peek() !== ")") {
        const token = next();

        if (token === undefined || token === ",") {
          continue;
        }

        if (token === "(") {
          points.push(parsePosition(next() ?? ""));
          if (next() !== ")") {
            throw new WktError("Unterminated multipoint member");
          }
          continue;
        }

        points.push(parsePosition(token));
      }

      next();
      geometry = { type, coordinates: points };
      break;
    }
    case "MultiLineString": {
      if (next() !== "(") {
        throw new WktError("Expected an opening parenthesis after MULTILINESTRING");
      }
      const lines: Position[][] = [];

      while (peek() === "(") {
        lines.push(parseRing());
        if (peek() === ",") next();
      }

      if (next() !== ")") {
        throw new WktError("Unterminated multilinestring");
      }

      geometry = { type, coordinates: lines };
      break;
    }
    case "MultiPolygon": {
      if (next() !== "(") {
        throw new WktError("Expected an opening parenthesis after MULTIPOLYGON");
      }
      const polygons: Position[][][] = [];

      while (peek() === "(") {
        next();
        const rings: Position[][] = [];

        while (peek() === "(") {
          rings.push(parseRing());
          if (peek() === ",") next();
        }

        if (next() !== ")") {
          throw new WktError("Unterminated multipolygon member");
        }

        polygons.push(rings);
        if (peek() === ",") next();
      }

      if (next() !== ")") {
        throw new WktError("Unterminated multipolygon");
      }

      geometry = { type, coordinates: polygons };
      break;
    }
    default:
      throw new WktError(`Unsupported WKT type "${typeToken}"`);
  }

  if (cursor !== tokens.length) {
    throw new WktError("Trailing content after the geometry");
  }

  return geometry;
}

function formatPosition(position: Position): string {
  return position
    .map((value) =>
      Number.isInteger(value) ? String(value) : String(Number(value.toFixed(9))),
    )
    .join(" ");
}

function formatSequence(positions: Position[]): string {
  return `(${positions.map(formatPosition).join(", ")})`;
}

/** Serialises a geometry to WKT, used by the CSV exporter. */
export function serializeWkt(geometry: Geometry): string {
  switch (geometry.type) {
    case "Point":
      return `POINT ${formatSequence([geometry.coordinates as Position])}`;
    case "LineString":
      return `LINESTRING ${formatSequence(geometry.coordinates as Position[])}`;
    case "Polygon":
      return `POLYGON (${(geometry.coordinates as Position[][])
        .map(formatSequence)
        .join(", ")})`;
    case "MultiPoint":
      return `MULTIPOINT (${(geometry.coordinates as Position[])
        .map((position) => `(${formatPosition(position)})`)
        .join(", ")})`;
    case "MultiLineString":
      return `MULTILINESTRING (${(geometry.coordinates as Position[][])
        .map(formatSequence)
        .join(", ")})`;
    case "MultiPolygon":
      return `MULTIPOLYGON (${(geometry.coordinates as Position[][][])
        .map((polygon) => `(${polygon.map(formatSequence).join(", ")})`)
        .join(", ")})`;
    default:
      return "";
  }
}
