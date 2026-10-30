import { layerFormatForFile, parseCsv, toCsv } from "./gis/csv";
import {
  CrsError,
  GEOGRAPHIC_CRS,
  hasCrs,
  projectFeatures,
  registerCrs,
} from "./gis/crs";
import { eachPosition } from "./gis/geometry";
import {
  DataError,
  guessFormat,
  importGeoJsonValue,
  layerNameFromFile,
  parseGeoJson,
  toGeoJson,
  type ImportResult,
} from "./gis/geojson";
import { parseGeoPackage } from "./gis/gpkg";
import {
  parseJoinTable,
  joinTable,
  type JoinOutcome,
  type JoinTable,
} from "./gis/join";
import { readWorkspace } from "./gis/datasets";
import { paletteColor } from "./gis/layers";
import {
  readShapefileArchive,
  readShapefileSet,
  type ShapefileSet,
} from "./gis/shapefile";
import {
  isTauriEnvironment,
  loadGeoParquetLayer,
  loadSpatialDatasetNative,
} from "./gis/tiledBackend";


import type {
  BasemapId,
  CameraState,
  CoordinateFormat,
  Dataset,
  DatasetLayer,
  ThemeMode,
} from "./gis/types";
import { parseWkt } from "./gis/wkt";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";
import { DEFAULT_PREFERENCES, useUiStore } from "../state/uiStore";
import {
  isBinaryFile,
  isTauri,
  isTextFile,
  openDatasetFiles,
  openTextFile,
  readTextFileAt,
  saveTextFile,
  type FileFilter,
  type OpenedFile,
} from "./fileIo";

export const PROJECT_SCHEMA = "strata.project";
/**
 * Version 2 nests layers inside the datasets that own them. Version 1 files
 * still open: each of their layers becomes a dataset of its own.
 */
export const PROJECT_VERSION = 2;

const DATASET_FILTERS: FileFilter[] = [
  {
    name: "Datasets",
    extensions: [
      "geojson",
      "json",
      "csv",
      "tsv",
      "txt",
      "wkt",
      "shp",
      "zip",
      "dbf",
      "prj",
      "cpg",
      "gpkg",
      "parquet",
      "geoparquet",
    ],
  },
];

const PROJECT_FILTERS: FileFilter[] = [
  { name: "Strata project", extensions: ["strata", "json"] },
];

export interface CrsDefinitionRecord {
  code: string;
  name: string;
  proj: string;
}

export interface ProjectDocument {
  schema: typeof PROJECT_SCHEMA;
  version: number;
  name: string;
  savedAt: string;
  view: CameraState;
  preferences: {
    basemap: BasemapId;
    coordFormat: CoordinateFormat;
    theme: ThemeMode;
    graticule: boolean;
  };
  /** Projections beyond the built-in list that this project's data needs. */
  crsDefinitions: CrsDefinitionRecord[];
  datasets: Dataset[];
  layers: DatasetLayer[];
}

export interface ImportOutcome {
  /** The dataset the import created; one file, one dataset. */
  dataset: Dataset;
  layer: DatasetLayer;
  warnings: string[];
  featureCount: number;
  crs: string;
}

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

function projectNameFromFile(fileName: string): string {
  return fileName.replace(/\.(strata|json)$/i, "").trim() || "Untitled project";
}

function safeFileName(name: string, fallback: string): string {
  return name.replace(/[^\w -]+/g, "").trim() || fallback;
}

export function buildProjectDocument(): ProjectDocument {
  const ui = useUiStore.getState();
  const store = useProjectStore.getState();

  return {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    name: store.projectName,
    savedAt: new Date().toISOString(),
    view: useMapStore.getState().camera,
    preferences: {
      basemap: ui.basemap,
      coordFormat: ui.coordFormat,
      theme: ui.theme,
      graticule: ui.graticule,
    },
    crsDefinitions: [],
    datasets: store.datasets,
    layers: store.layers,
  };
}

export function serializeProject(): string {
  return JSON.stringify(buildProjectDocument(), null, 2);
}

/**
 * Parses a project file. Custom CRS definitions are registered before layers
 * are validated, because the layers may be stored in one of them.
 */
export function parseProject(text: string): {
  project: ProjectDocument;
  datasets: Dataset[];
  layers: DatasetLayer[];
  warnings: string[];
} {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ProjectError(
      `This file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ProjectError(
      "A project file must be a JSON object, not an array",
    );
  }

  const document = parsed as Partial<ProjectDocument>;

  if (document.schema !== PROJECT_SCHEMA) {
    throw new ProjectError("This is not a Strata project file");
  }

  if (
    typeof document.version === "number" &&
    document.version > PROJECT_VERSION
  ) {
    throw new ProjectError(
      `This project was written by a newer version of Strata (file version ${document.version})`,
    );
  }

  const warnings: string[] = [];

  for (const definition of document.crsDefinitions ?? []) {
    if (definition?.code && definition.proj && !hasCrs(definition.code)) {
      if (!registerCrs(definition.code, definition.proj, definition.name)) {
        warnings.push(`Could not register the projection ${definition.code}`);
      }
    }
  }

  const stored = readWorkspace(document.datasets, document.layers);
  warnings.push(...stored.warnings);

  if (!stored.layers.length && (document.layers ?? []).length) {
    throw new ProjectError("None of the layers in this project could be read");
  }

  return {
    project: {
      schema: PROJECT_SCHEMA,
      version: document.version ?? PROJECT_VERSION,
      name:
        typeof document.name === "string" && document.name.trim() ?
          document.name
        : "Untitled project",
      savedAt:
        typeof document.savedAt === "string" ?
          document.savedAt
        : new Date().toISOString(),
      view: document.view ?? useMapStore.getState().camera,
      preferences: {
        basemap: document.preferences?.basemap ?? DEFAULT_PREFERENCES.basemap,
        coordFormat:
          document.preferences?.coordFormat ?? DEFAULT_PREFERENCES.coordFormat,
        theme: document.preferences?.theme ?? DEFAULT_PREFERENCES.theme,
        graticule:
          document.preferences?.graticule ?? DEFAULT_PREFERENCES.graticule,
      },
      crsDefinitions: document.crsDefinitions ?? [],
      datasets: stored.datasets,
      layers: stored.layers,
    },
    datasets: stored.datasets,
    layers: stored.layers,
    warnings,
  };
}

export async function saveProjectFile(): Promise<boolean> {
  const store = useProjectStore.getState();
  const suggested = `${safeFileName(store.projectName, "project")}.strata`;

  const path = await saveTextFile(
    suggested,
    serializeProject(),
    PROJECT_FILTERS,
    "application/json",
  );

  if (!path) {
    return false;
  }

  useProjectStore.getState().markSaved();
  return true;
}

export interface ApplyProjectResult {
  name: string;
  layerCount: number;
  datasetCount: number;
  featureCount: number;
  /** Camera to move the map to; the caller owns the map wiring. */
  view: CameraState;
  warnings: string[];
}

/** Loads a parsed project into the stores and returns a summary for the UI. */
export function applyProjectText(
  text: string,
  fileName: string,
  path: string | null,
): ApplyProjectResult {
  const { project, datasets, layers, warnings } = parseProject(text);
  const ui = useUiStore.getState();

  useProjectStore.getState().loadProject({
    name: projectNameFromFile(fileName),
    path,
    datasets,
    layers,
  });

  ui.setBasemap(project.preferences.basemap);
  ui.setCoordFormat(project.preferences.coordFormat);
  ui.setTheme(project.preferences.theme);
  ui.setGraticule(project.preferences.graticule);
  useMapStore.getState().setCamera(project.view);

  return {
    name: projectNameFromFile(fileName),
    layerCount: layers.length,
    datasetCount: datasets.length,
    featureCount: layers.reduce(
      (total, layer) => total + layer.features.length,
      0,
    ),
    view: project.view,
    warnings,
  };
}

export async function openProjectFile(): Promise<ApplyProjectResult | null> {
  const file = await openTextFile(PROJECT_FILTERS);

  if (!file) {
    return null;
  }

  return applyProjectText(file.text, file.name, file.path);
}

/** True when the coordinates are too large to be degrees. */
function looksProjected(features: ImportResult["features"]): boolean {
  let projected = false;

  eachPosition(features[0].geometry, (position) => {
    if (Math.abs(position[0]) > 360 || Math.abs(position[1]) > 180) {
      projected = true;
    }
  });

  return projected;
}

/** The checks every parsed source shares, before it becomes a layer. */
function checkImport(result: ImportResult): {
  crs: string;
  warnings: string[];
} {
  const crs = result.crs ?? GEOGRAPHIC_CRS;
  const warnings = [...result.warnings];

  if (
    crs === GEOGRAPHIC_CRS &&
    result.format !== "geojson" &&
    looksProjected(result.features)
  ) {
    warnings.push(
      "Coordinates look projected, not degrees. Set the layer projection before measuring or exporting.",
    );
  }

  // A sample is enough to catch a file whose CRS cannot reach the view.
  const sample = projectFeatures(result.features.slice(0, 500), crs);

  if (sample.failures.length) {
    warnings.push(
      `${sample.failures.length} of the first ${sample.projected.length + sample.failures.length} features fall outside ${crs} and will not be drawn`,
    );
  }

  return { crs, warnings };
}

/**
 * Turns the parsed results of one file into a single dataset. A zipped archive
 * of shapefiles arrives as several results and lands as several layers of one
 * dataset, which is what it is.
 */
function registerImports(
  results: ImportResult[],
  fileName: string,
  source: string | null,
): ImportOutcome[] {
  const prepared = results.map((result) => {
    const { crs, warnings } = checkImport(result);

    return { result, crs, warnings };
  });

  const name =
    prepared[0]?.result.name ??
    layerNameFromFile(fileName) ??
    "Imported dataset";

  const { dataset, layers } = useProjectStore.getState().addDataset({
    name,
    kind: "file",
    source: source ?? fileName,
    layers: prepared.map(({ result, crs }) => ({
      name: result.name ?? layerNameFromFile(fileName) ?? "Imported layer",
      features: result.features,
      crs,
      format: result.format,
      tileUrl: result.tileUrl,
      source: source ?? fileName,
      color: paletteColor(0),
    })),
  });

  return layers.map((layer, index) => ({
    dataset,
    layer,
    warnings: prepared[index].warnings,
    featureCount: layer.features.length,
    crs: layer.crs,
  }));
}

function registerImport(
  result: ImportResult,
  fileName: string,
  source: string | null,
): ImportOutcome {
  return registerImports([result], fileName, source)[0];
}

export function importDatasetText(
  text: string,
  fileName: string,
  path: string | null,
): ImportOutcome {
  const format = guessFormat(fileName, text);
  let result: ImportResult;

  if (format === "geojson") {
    result = parseGeoJson(text);
  } else if (layerFormatForFile(fileName) === "wkt") {
    result = parseWktList(text);
  } else {
    result = parseCsv(text, { crs: GEOGRAPHIC_CRS });
  }

  return registerImport(result, fileName, path);
}

export interface DatasetImportSummary {
  outcomes: ImportOutcome[];
  /** Files that could not be read, one message each. */
  failures: string[];
}

const SHAPEFILE_PARTS = new Set(["shp", "shx", "dbf", "prj", "cpg"]);
const TEXT_FORMATS = new Set(["geojson", "json", "csv", "tsv", "txt", "wkt"]);

function extensionOf(fileName: string): string {
  const match = /\.([^.]+)$/.exec(fileName);
  return match ? match[1].toLowerCase() : "";
}

function baseNameOf(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
}

/** One unit of work the importer performs, however many files it was fed. */
type ImportJob =
  | { kind: "text"; name: string; source: string | null; text: string }
  | { kind: "shapefile"; set: ShapefileSet; source: string | null }
  | { kind: "archive"; name: string; source: string | null; bytes: Uint8Array }
  | { kind: "gpkg"; name: string; source: string | null; bytes: Uint8Array }
  | { kind: "parquet"; name: string; source: string | null; path: string | null };

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Groups the picked files into jobs. A shapefile spread across .shp/.dbf/.prj
 * becomes one job per basename; everything else stands on its own.
 */
function planImports(files: OpenedFile[]): {
  jobs: ImportJob[];
  orphans: string[];
} {
  const jobs: ImportJob[] = [];
  const orphans: string[] = [];
  const sets = new Map<string, ShapefileSet>();
  const skipped = new Set<string>();

  for (const file of files) {
    const extension = extensionOf(file.name);
    const source = file.path ?? file.name;

    if (SHAPEFILE_PARTS.has(extension)) {
      if (!isBinaryFile(file)) {
        skipped.add(file.name);
        continue;
      }

      const key = `${file.path ?? ""}${baseNameOf(file.name)}`;
      const set = sets.get(key) ?? { name: baseNameOf(file.name), parts: {} };

      if (extension === "shp") {
        set.parts.shp = file.bytes;
        set.path = file.path;
      } else if (
        extension === "dbf" ||
        extension === "cpg" ||
        extension === "prj"
      ) {
        set.parts[extension] = file.bytes;
      }

      sets.set(key, set);
      continue;
    }

    if (extension === "shx") {
      // The spatial index is not needed to read the geometries.
      continue;
    }

    if (extension === "parquet" || extension === "geoparquet") {
      jobs.push({
        kind: "parquet",
        name: baseNameOf(file.name),
        source,
        path: file.path,
      });
      continue;
    }

    if (extension === "zip" || extension === "gpkg") {
      if (!isBinaryFile(file)) {
        skipped.add(file.name);
        continue;
      }

      jobs.push({
        kind: extension === "zip" ? "archive" : "gpkg",
        name: baseNameOf(file.name),
        source,
        bytes: file.bytes,
      });
      continue;
    }

    if (TEXT_FORMATS.has(extension) || isTextFile(file)) {
      jobs.push({
        kind: "text",
        name: file.name,
        source,
        text: isTextFile(file) ? file.text : decode(file.bytes),
      });
      continue;
    }

    skipped.add(file.name);
  }

  for (const [key, set] of sets) {
    if (!set.parts.shp) {
      orphans.push(`${set.name} (no .shp selected)`);
      sets.delete(key);
      continue;
    }

    jobs.push({ kind: "shapefile", set, source: set.path ?? set.name });
  }

  for (const name of skipped) {
    orphans.push(name);
  }

  return { jobs, orphans };
}

/** A label for progress and failure messages, whatever shape the job takes. */
function jobLabel(job: ImportJob): string {
  return job.kind === "shapefile" ? job.set.name : job.name;
}

/**
 * Opens one or more dataset files and imports every layer it finds. Formats
 * that need converting elsewhere (GeoJSON, CSV, WKT) and formats that do not
 * (Shapefile, GeoPackage) come through the same picker.
 */
export async function importDatasetFiles(): Promise<DatasetImportSummary | null> {
  const files = await openDatasetFiles(DATASET_FILTERS);

  if (!files.length) {
    return null;
  }

  const { jobs, orphans } = planImports(files);
  const outcomes: ImportOutcome[] = [];
  const failures = orphans.map(
    (name) => `${name} is not a format this importer reads`,
  );

  for (const job of jobs) {
    try {
      if (job.kind === "text") {
        outcomes.push(importDatasetText(job.text, job.name, job.source));
        continue;
      }

      if (job.kind === "shapefile") {
        if (
          isTauriEnvironment() &&
          job.source &&
          (job.source.endsWith(".shp") || job.source.endsWith(".SHP"))
        ) {
          const res = await loadSpatialDatasetNative(job.source, job.set.name);
          if (res?.feature_collection) {
            const parsed = importGeoJsonValue(res.feature_collection);
            parsed.tileUrl = res.tile_url;
            outcomes.push(registerImport(parsed, job.set.name, job.source));
            continue;
          }
        }
        outcomes.push(
          registerImport(readShapefileSet(job.set), job.set.name, job.source),
        );
        continue;
      }

      if (job.kind === "gpkg") {
        if (isTauriEnvironment() && job.source && !job.source.startsWith("data:")) {
          const res = await loadSpatialDatasetNative(job.source, job.name);
          if (res?.feature_collection) {
            const parsed = importGeoJsonValue(res.feature_collection);
            parsed.tileUrl = res.tile_url;
            outcomes.push(registerImport(parsed, job.name, job.source));
            continue;
          }
        }
        const result = await parseGeoPackage(job.bytes);
        outcomes.push(registerImport(result, job.name, job.source));
        continue;
      }

      if (job.kind === "parquet") {
        if (!job.path) {
          throw new DataError(
            "GeoParquet files must be read from the local file system inside the desktop application.",
          );
        }
        const res = await loadSpatialDatasetNative(job.path, job.name);
        if (res?.feature_collection) {
          const parsed = importGeoJsonValue(res.feature_collection);
          parsed.tileUrl = res.tile_url;
          outcomes.push(registerImport(parsed, job.name, job.source));
          continue;
        }
        const parquetRes = await loadGeoParquetLayer(job.path);
        if (!parquetRes || !parquetRes.feature_collection) {
          throw new DataError(`Failed to decode GeoParquet file "${job.name}"`);
        }
        const parsed = importGeoJsonValue(parquetRes.feature_collection);
        outcomes.push(registerImport(parsed, job.name, job.source));
        continue;
      }

      // A zipped archive may hold several shapefiles: it lands as one
      // dataset holding one layer per shapefile.
      const results = await readShapefileArchive(job.bytes);
      outcomes.push(...registerImports(results, job.name, job.source));
    } catch (error) {
      failures.push(`${jobLabel(job)}: ${describeError(error)}`);
    }
  }

  if (!outcomes.length && failures.length) {
    throw new DataError(failures[0]);
  }

  return { outcomes, failures };
}

/** Loads a dataset served next to the app, used by the bundled samples. */
export async function importDatasetFromUrl(
  url: string,
  name: string,
): Promise<ImportOutcome> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new DataError(`Could not fetch ${name} (HTTP ${response.status})`);
  }

  return importDatasetText(await response.text(), name, url);
}

/** True for sources that are served over the app rather than read from disk. */
function isUrlSource(source: string): boolean {
  return /^(https?:|\/)/.test(source);
}

/** A .wkt file holds one geometry per line, with optional attributes after a tab. */
function parseWktList(text: string): ImportResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new DataError("This file is empty");
  }

  const warnings: string[] = [];
  const features: ImportResult["features"] = [];

  lines.forEach((line, index) => {
    const [geometry, ...rest] = line.split("\t");

    try {
      features.push({
        id: `w${index + 1}`,
        geometry: parseWkt(geometry),
        properties: rest.length ? { description: rest.join(" ").trim() } : {},
      });
    } catch (error) {
      warnings.push(
        `Line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  if (!features.length) {
    throw new DataError("No line in this file held a readable geometry");
  }

  return { features, crs: null, format: "wkt", name: null, warnings };
}

export async function exportLayerAs(
  layerId: string,
  format: "geojson" | "csv",
): Promise<boolean> {
  const layer = useProjectStore
    .getState()
    .layers.find((item) => item.id === layerId);

  if (!layer) {
    return false;
  }

  const name = safeFileName(layer.name, "layer");

  if (format === "geojson") {
    const path = await saveTextFile(
      `${name}.geojson`,
      toGeoJson(layer.features, { crs: layer.crs, name: layer.name }),
      [{ name: "GeoJSON", extensions: ["geojson", "json"] }],
      "application/geo+json",
    );

    return Boolean(path);
  }

  const path = await saveTextFile(
    `${name}.csv`,
    toCsv(
      layer.features,
      layer.fields.map((field) => field.name),
      { crs: layer.crs },
    ),
    [{ name: "CSV", extensions: ["csv"] }],
    "text/csv",
  );

  return Boolean(path);
}

/**
 * Re-reads a dataset that was left out of the last session because it was too
 * large to keep in memory. The path is only readable if the file is still
 * granted to the window; otherwise the caller falls back to the file picker.
 */
export async function reloadRecentLayer(
  source: string,
  name: string,
): Promise<ImportOutcome | null> {
  if (!source) {
    return null;
  }

  if (isUrlSource(source)) {
    return importDatasetFromUrl(source, name);
  }

  if (!isTauri()) {
    return null;
  }

  const text = await readTextFileAt(source);
  return importDatasetText(text, name, source);
}

export interface JoinRequest {
  tableText: string;
  tableName: string;
  keyColumn: string;
  targetLayerId: string;
  targetField: string;
}

export interface JoinResult {
  layer: DatasetLayer;
  outcome: JoinOutcome;
  table: JoinTable;
}

/**
 * Joins a table file onto an existing layer and adds the result as a new layer,
 * leaving the boundary layer it read from untouched.
 */
export function joinTableOntoLayer(request: JoinRequest): JoinResult {
  const store = useProjectStore.getState();
  const target = store.layers.find(
    (layer) => layer.id === request.targetLayerId,
  );

  if (!target) {
    throw new ProjectError("Choose the layer to join onto");
  }

  const table = parseJoinTable(request.tableText, request.tableName);
  const outcome = joinTable(
    target,
    table,
    request.keyColumn,
    request.targetField,
  );

  // A join is its own dataset: it borrows the boundary geometry but carries
  // a different set of attributes, and the layer it read stays untouched.
  const { layers } = store.addDataset({
    name: `${target.name} · ${table.name}`,
    kind: "join",
    source: `join:${table.name}`,
    layers: [
      {
        name: `${target.name} · ${table.name}`,
        features: outcome.features,
        crs: target.crs,
        format: target.format,
        source: null,
      },
    ],
  });
  return { layer: layers[0], outcome, table };
}

export function describeError(error: unknown): string {
  if (
    error instanceof DataError ||
    error instanceof ProjectError ||
    error instanceof CrsError ||
    error instanceof Error
  ) {
    return error.message;
  }

  return String(error);
}
