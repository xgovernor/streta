export type BasemapId =
  | "positron"
  | "atlas"
  | "bright"
  | "midnight"
  | "google-maps"
  | "satellite-imagery"
  | "maxar-satellite"
  | "hybrid-basemap"
  | "openstreetmap";

export type PanelId =
  | "search"
  | "data"
  | "basemaps"
  | "feature"
  | "settings"
  | "layer"
  | "table"
  | "measure"
  | "join"
  | "project";

export type ThemeMode = "dark" | "light";

export type CoordinateFormat = "decimal" | "dms" | "projected";

export type GeometryKind =
  | "Point"
  | "LineString"
  | "Polygon"
  | "MultiPoint"
  | "MultiLineString"
  | "MultiPolygon";

/** A single coordinate, either [x, y] or [x, y, z]. */
export type Position = number[];

export interface Geometry {
  type: GeometryKind;
  coordinates: unknown;
}

export type AttributeValue = string | number | boolean | null;

export type Attributes = Record<string, AttributeValue>;

export interface FeatureRecord {
  id: string;
  geometry: Geometry;
  properties: Attributes;
}

export type FieldType = "number" | "text" | "boolean" | "empty";

export interface FieldInfo {
  name: string;
  type: FieldType;
  /** Share of features that carry a non-empty value, 0–1. */
  fill: number;
}

/**
 * A display filter over one attribute field. Features whose value is not in
 * `values` are not drawn and not listed; the stored data is untouched.
 */
export interface LayerFilter {
  field: string;
  values: string[];
}

export interface LayerStyle {
  color: string;
  strokeWidth: number;
  pointRadius: number;
  fillOpacity: number;
  labelField: string | null;
}

export type LayerFormat =
  | "geojson"
  | "csv"
  | "wkt"
  | "sample"
  | "shapefile"
  | "gpkg";

/** Every format a stored layer may declare; unknown values fall back to GeoJSON. */
export const LAYER_FORMATS: LayerFormat[] = [
  "geojson",
  "csv",
  "wkt",
  "sample",
  "shapefile",
  "gpkg",
];

export function isLayerFormat(value: unknown): value is LayerFormat {
  return typeof value === "string" && (LAYER_FORMATS as string[]).includes(value);
}

export type Extent = [number, number, number, number];

/** Where a dataset came from, which decides how it can be reloaded. */
export type DatasetKind = "file" | "library" | "sample" | "join";

/**
 * A dataset owns a stack of layers. One file can carry several (a GeoPackage,
 * an archive of shapefiles) and one library product can too (countries and
 * their states), so the layer is not the unit the user loads — the dataset is.
 */
export interface Dataset {
  id: string;
  name: string;
  kind: DatasetKind;
  /** Library product this dataset came from, when it did. */
  libraryId: string | null;
  /** File, URL or library product the data came from. */
  source: string | null;
  /** Presentation only: the group is folded in the panels. */
  collapsed: boolean;
  /** Position in the outer stack; lower draws first. */
  order: number;
  createdAt: string;
}

export interface DatasetLayer {
  id: string;
  /** The dataset whose stack this layer belongs to. */
  datasetId: string;
  name: string;
  /** CRS of the stored coordinates, e.g. "EPSG:4326". */
  crs: string;
  format: LayerFormat;
  /** Original file name or path, when the layer came from disk. */
  source: string | null;
  geometryKind: GeometryKind | "Mixed";
  features: FeatureRecord[];
  fields: FieldInfo[];
  /** Extent in the layer CRS. */
  extent: Extent | null;
  style: LayerStyle;
  /** Facets ANDed together; an empty list draws every feature. */
  filters: LayerFilter[];
  visible: boolean;
  opacity: number;
  /** Position in the stack; lower draws first. */
  order: number;
  createdAt: string;
}

export interface Selection {
  layerId: string;
  featureId: string;
}

export interface BasemapAttribution {
  label: string;
  href: string;
}

interface BasemapBase {
  id: BasemapId;
  name: string;
  tone: string;
  attribution: BasemapAttribution[];
}

/** A vector tile style document, loaded by `ol-mapbox-style`. */
export interface VectorBasemap extends BasemapBase {
  kind: "style";
  url: string;
}

/** A raster tile service: Web Mercator XYZ templates, one or more hosts. */
export interface RasterBasemap extends BasemapBase {
  kind: "raster";
  /** URL templates carrying `{x}`, `{y}` and `{z}`. */
  urls: string[];
  /** Deepest zoom the service publishes; the view keeps zooming past it. */
  maxZoom: number;
}

export type BasemapDefinition = VectorBasemap | RasterBasemap;

export interface CameraState {
  lon: number;
  lat: number;
  zoom: number;
  rotation: number;
  resolution: number;
}

export type MeasureMode = "off" | "distance" | "area";

export interface MeasureSummary {
  mode: Exclude<MeasureMode, "off">;
  /** Geodesic length in metres (distance mode, or the outline in area mode). */
  distance: number;
  /** Geodesic area in square metres (area mode only). */
  area: number;
  vertices: number;
}
