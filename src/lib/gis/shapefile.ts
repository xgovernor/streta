import proj4 from "proj4";
import { combine, parseDbf, parseShp, parseZip, type ShapefileGeoJson } from "shpjs";
import { GEOGRAPHIC_CRS } from "./crs";
import { DataError, importGeoJsonValue, type ImportResult } from "./geojson";

/**
 * Shapefiles reach this app two ways: as the zipped archives every portal hands
 * out, or as the loose `.shp` / `.dbf` / `.prj` set that sits in a working
 * folder. Both end up in the same GeoJSON shape, so the rest of the importer
 * stays unaware of the format.
 *
 * A `.prj` inside the archive is honoured — shpjs converts the coordinates to
 * WGS 84 as it reads them. Without one, the coordinates are passed through and
 * the caller is told the projection is an assumption.
 */

/** A shapefile is a set of companion files; only the .shp is essential. */
export interface ShapefileParts {
  shp?: Uint8Array;
  dbf?: Uint8Array;
  prj?: Uint8Array;
  cpg?: Uint8Array;
}

export interface ShapefileSet {
  name: string;
  path?: string | null;
  parts: ShapefileParts;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export function looksLikeZip(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((byte, index) => bytes[index] === byte);
}

function decodeUtf8(bytes: Uint8Array | undefined): string | null {
  if (!bytes) {
    return null;
  }

  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Every `.shp` inside an archive, as separate GeoJSON documents. */
async function readZip(bytes: Uint8Array): Promise<ShapefileGeoJson[]> {
  const parsed = await parseZip(bytes);
  const documents = Array.isArray(parsed) ? parsed : [parsed];

  if (!documents.length) {
    throw new DataError("That archive holds no shapefile or GeoJSON layer");
  }

  return documents;
}

/**
 * Combines loose files into one document. Without a `.dbf` the geometries still
 * load, they just arrive with no attributes to show or join on.
 */
function readParts(set: ShapefileSet): ShapefileGeoJson {
  const { shp, dbf, prj } = set.parts;

  if (!shp) {
    throw new DataError(
      `“${set.name}” was selected without its .shp file, so there is nothing to read`,
    );
  }

  const view = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);

  // shpjs wants a proj4 projection, not the WKT text a .prj holds: given the
  // raw string it silently mangles every coordinate instead of complaining.
  let projection: unknown = false;
  const projectionText = decodeUtf8(prj);

  if (projectionText) {
    try {
      projection = proj4(projectionText);
    } catch {
      projection = false;
    }
  }

  const geometries = parseShp(view, projection);
  const attributes = dbf ? parseDbf(dbf, set.parts.cpg) : undefined;

  return combine(attributes ? [geometries, attributes] : [geometries]);
}

export async function readShapefileArchive(bytes: Uint8Array): Promise<ImportResult[]> {
  const documents = await readZip(bytes);

  if (!documents.length) {
    throw new DataError("No shapefile was found inside that archive");
  }

  const layers = documents.map((document) => {
    const result = importGeoJsonValue(document, {
      format: "shapefile",
      fallbackName: typeof document.fileName === "string" ? document.fileName : null,
    });
    const source = result.name ?? "Shapefile";

    if (!result.features.length) {
      throw new DataError(`“${source}” in that archive holds no features`);
    }

    return result;
  });

  return layers;
}

export function readShapefileSet(set: ShapefileSet): ImportResult {
  const document = readParts(set);
  const warnings: string[] = [];

  if (!set.parts.dbf) {
    warnings.push(
      "No .dbf was selected, so this layer has geometry only. Open the zipped shapefile, or select the .dbf alongside it, to keep the attributes.",
    );
  }

  if (!set.parts.prj) {
    warnings.push(
      `No .prj was selected, so the coordinates were assumed to be ${GEOGRAPHIC_CRS}. Set the layer projection if the source is projected.`,
    );
  }

  const result = importGeoJsonValue(document, {
    format: "shapefile",
    fallbackName: set.name,
  });

  if (!result.features.length) {
    throw new DataError("That shapefile holds no features");
  }

  // A .prj means shpjs already handed back WGS 84 coordinates.
  const crs = set.parts.prj ? GEOGRAPHIC_CRS : null;

  return { ...result, crs, warnings: [...result.warnings, ...warnings] };
}
