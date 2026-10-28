import proj4 from "proj4";
import { positionsAreFinite } from "./geometry";
import type { Geometry, Position } from "./types";

/** The map view projection. Raster and vector basemaps are Web Mercator. */
export const VIEW_CRS = "EPSG:3857";

/** Geographic CRS that GeoJSON, WKT and most field data arrives in. */
export const GEOGRAPHIC_CRS = "EPSG:4326";

export type CrsUnits = "degree" | "metre";

export interface CrsInfo {
  code: string;
  name: string;
  geographic: boolean;
  units: CrsUnits;
  builtin: boolean;
}

interface CrsRecord extends CrsInfo {
  proj: string;
}

export class CrsError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? `Unknown coordinate reference system ${code}`);
    this.name = "CrsError";
    this.code = code;
  }
}

const UTM_ZONES = Array.from({ length: 60 }, (_, index) => index + 1);

/**
 * Built-in definitions. The list covers the global defaults plus the national
 * grids and continental projections most field data arrives in; anything else
 * can be registered from a proj4 string (a project file may carry its own).
 */
const BUILTINS: { code: string; name: string; proj: string }[] = [
  {
    code: "EPSG:4326",
    name: "WGS 84",
    proj: "+proj=longlat +datum=WGS84 +no_defs +type=crs",
  },
  {
    code: "EPSG:3857",
    name: "WGS 84 / Pseudo-Mercator",
    proj: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs +type=crs",
  },
  {
    code: "EPSG:4258",
    name: "ETRS89",
    proj: "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs +type=crs",
  },
  {
    code: "EPSG:4269",
    name: "NAD83",
    proj: "+proj=longlat +datum=NAD83 +no_defs +type=crs",
  },
  {
    code: "EPSG:3035",
    name: "ETRS89-extended / LAEA Europe",
    proj: "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:25832",
    name: "ETRS89 / UTM zone 32N",
    proj: "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:25833",
    name: "ETRS89 / UTM zone 33N",
    proj: "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:2154",
    name: "RGF93 v1 / Lambert-93",
    proj: "+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:27572",
    name: "NTF (Paris) / Lambert zone II",
    proj: "+proj=lcc +lat_1=46.8 +lat_0=46.8 +lon_0=0 +k_0=0.99987742 +x_0=600000 +y_0=2200000 +a=6378249.2 +b=6356515 +towgs84=-168,-60,320,0,0,0,0 +pm=paris +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:27700",
    name: "OSGB36 / British National Grid",
    proj: "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:29903",
    name: "TM65 / Irish Grid",
    proj: "+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=1.000035 +x_0=200000 +y_0=250000 +ellps=mod_airy +towgs84=482.5,-130.6,564.6,-1.042,-0.214,-0.631,8.15 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:2056",
    name: "CH1903+ / LV95",
    proj: "+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:21781",
    name: "CH1903 / LV03",
    proj: "+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 +x_0=600000 +y_0=200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:28992",
    name: "Amersfoort / RD New",
    proj: "+proj=sterea +lat_0=52.1561605555556 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.4171,50.3319,465.5524,-0.3989574,0.3439878,-1.8774015,4.0725 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:31370",
    name: "BD72 / Belgian Lambert 72",
    proj: "+proj=lcc +lat_1=51.1666672333333 +lat_2=49.8333339 +lat_0=90 +lon_0=4.36748666666667 +x_0=150000.013 +y_0=5400088.438 +ellps=intl +towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:31467",
    name: "DHDN / 3-degree Gauss-Kruger zone 3",
    proj: "+proj=tmerc +lat_0=0 +lon_0=9 +k=1 +x_0=3500000 +y_0=0 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:3006",
    name: "SWEREF99 TM",
    proj: "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:2193",
    name: "NZGD2000 / New Zealand Transverse Mercator 2000",
    proj: "+proj=tmerc +lat_0=0 +lon_0=173 +k=0.9996 +x_0=1600000 +y_0=10000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:3577",
    name: "GDA94 / Australian Albers",
    proj: "+proj=aea +lat_1=-18 +lat_2=-36 +lat_0=0 +lon_0=132 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:5070",
    name: "NAD83 / Conus Albers",
    proj: "+proj=aea +lat_1=29.5 +lat_2=45.5 +lat_0=23 +lon_0=-96 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:3413",
    name: "NSIDC Sea Ice Polar Stereographic North",
    proj: "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:3031",
    name: "Antarctic Polar Stereographic",
    proj: "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:54009",
    name: "World Mollweide",
    proj: "+proj=moll +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs +type=crs",
  },
  // Bangladesh's own grids. Survey of Bangladesh topographic work arrives in
  // TM 90 NE; water resource data more often in BTM, which differs only by its
  // false northing.
  {
    code: "EPSG:3106",
    name: "Gulshan 303 / TM 90 NE",
    proj: "+proj=tmerc +lat_0=0 +lon_0=90 +k=0.9996 +x_0=500000 +y_0=0 +ellps=evrst30 +towgs84=283.729,735.942,261.143,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:9678",
    name: "Gulshan 303 / Bangladesh Transverse Mercator",
    proj: "+proj=tmerc +lat_0=0 +lon_0=90 +k=0.9996 +x_0=500000 +y_0=-2000000 +ellps=evrst30 +towgs84=283.729,735.942,261.143,0,0,0,0 +units=m +no_defs +type=crs",
  },
];

function utmProj(zone: number, south: boolean): string {
  return `+proj=utm +zone=${zone}${south ? " +south" : ""} +datum=WGS84 +units=m +no_defs +type=crs`;
}

const records = new Map<string, CrsRecord>();

type CrsListener = (code: string) => void;

const listeners = new Set<CrsListener>();

/**
 * Notifies whoever mirrors this registry (the map layer, which feeds
 * OpenLayers) that a definition became available.
 */
export function onCrsRegistered(listener: CrsListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function remember(record: CrsRecord): CrsRecord {
  records.set(record.code, record);

  if (!proj4.defs(record.code)) {
    proj4.defs(record.code, record.proj);
  }

  for (const listener of listeners) {
    listener(record.code);
  }

  return record;
}

for (const builtin of BUILTINS) {
  remember({
    ...builtin,
    geographic: builtin.proj.includes("+proj=longlat"),
    units: builtin.proj.includes("+proj=longlat") ? "degree" : "metre",
    builtin: true,
  });
}

/** WGS 84 UTM zones are generated rather than listed, 326xx north / 327xx south. */
for (const zone of UTM_ZONES) {
  for (const south of [false, true]) {
    const code = `EPSG:${south ? 327 : 326}${String(zone).padStart(2, "0")}`;

    if (records.has(code)) {
      continue;
    }

    remember({
      code,
      name: `WGS 84 / UTM zone ${zone}${south ? "S" : "N"}`,
      proj: utmProj(zone, south),
      geographic: false,
      units: "metre",
      builtin: true,
    });
  }
}

const CODE_PATTERNS: RegExp[] = [
  /^\s*urn:ogc:def:crs:epsg(?::[\d.]*)?::?(\d+)\s*$/i,
  /^\s*https?:\/\/www\.opengis\.net\/def\/crs\/epsg\/[\d.]+\/(\d+)\s*$/i,
  /^\s*epsg\s*:+\s*(\d+)\s*$/i,
  /^\s*(\d{4,5})\s*$/,
];

/**
 * Accepts the many spellings a file may use for a CRS and returns the
 * canonical "EPSG:xxxx" code, or null when it cannot be recognised.
 */
export function normalizeCrsCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const raw = value.trim();

  if (!raw) {
    return null;
  }

  if (/^epsg:\d+$/i.test(raw)) {
    return raw.toUpperCase().replace(/\s+/g, "");
  }

  if (/^[A-Za-z][\w-]*:\d+$/.test(raw)) {
    return raw.toUpperCase();
  }

  for (const pattern of CODE_PATTERNS) {
    const match = raw.match(pattern);
    if (match) {
      return `EPSG:${match[1]}`;
    }
  }

  return null;
}

export function hasCrs(code: string): boolean {
  return records.has(code) || Boolean(proj4.defs(code));
}

export function crsInfo(code: string): CrsInfo | null {
  const record = records.get(code);
  if (record) {
    return record;
  }

  const definition = proj4.defs(code);
  if (!definition) {
    return null;
  }

  return {
    code,
    name: code,
    geographic: definition.projName === "longlat",
    units: definition.units === "degrees" ? "degree" : "metre",
    builtin: false,
  };
}

export function crsName(code: string): string {
  return crsInfo(code)?.name ?? code;
}

export function isGeographic(code: string): boolean {
  return crsInfo(code)?.geographic ?? false;
}

export function listCrs(): CrsInfo[] {
  return [...records.values()]
    .map(({ code, name, geographic, units, builtin }) => ({
      code,
      name,
      geographic,
      units,
      builtin,
    }))
    .sort((a, b) => {
      const zoneA = Number.parseInt(a.code.slice(5), 10);
      const zoneB = Number.parseInt(b.code.slice(5), 10);
      return zoneA - zoneB;
    });
}

/**
 * Registers a CRS from a proj4 string. Used for the long tail of national
 * grids, and for definitions carried inside a project file.
 */
export function registerCrs(code: string, proj: string, name?: string): boolean {
  const normalized = normalizeCrsCode(code) ?? code.trim();

  if (!normalized || !proj.trim()) {
    return false;
  }

  try {
    proj4.defs(normalized, proj);
    remember({
      code: normalized,
      name: name ?? normalized,
      proj,
      geographic: proj.includes("+proj=longlat"),
      units: proj.includes("+proj=longlat") ? "degree" : "metre",
      builtin: false,
    });
    return true;
  } catch {
    return false;
  }
}

function resolve(code: string): CrsRecord {
  const record = records.get(code);
  if (record) {
    return record;
  }

  const definition = proj4.defs(code);
  if (!definition) {
    throw new CrsError(code);
  }

  return remember({
    code,
    name: code,
    proj: "",
    geographic: definition.projName === "longlat",
    units: definition.units === "degrees" ? "degree" : "metre",
    builtin: false,
  });
}

/** Transforms one coordinate between two CRSs. */
export function transformPosition(
  position: Position,
  from: string,
  to: string,
): Position {
  if (from === to) {
    return position;
  }

  resolve(from);
  resolve(to);

  const [x, y, z] = position;

  try {
    const [nextX, nextY] = proj4(from, to, [x, y]);
    return z === undefined ? [nextX, nextY] : [nextX, nextY, z];
  } catch (error) {
    throw new CrsError(from, `Cannot reproject ${from} → ${to}: ${String(error)}`);
  }
}

export function toView(position: Position, from: string): Position {
  return transformPosition(position, from, VIEW_CRS);
}

export function fromView(position: Position): Position {
  return transformPosition(position, VIEW_CRS, GEOGRAPHIC_CRS);
}

function mapCoordinates(value: unknown, fn: (position: Position) => Position): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  if (value.length > 0 && typeof value[0] === "number") {
    return fn(value as Position);
  }

  return value.map((child) => mapCoordinates(child, fn));
}

/** Reprojects a whole geometry, keeping the Z ordinate untouched. */
export function transformGeometry(
  geometry: Geometry,
  from: string,
  to: string,
): Geometry {
  if (from === to) {
    return geometry;
  }

  return {
    type: geometry.type,
    coordinates: mapCoordinates(geometry.coordinates, (position) =>
      transformPosition(position, from, to),
    ),
  };
}

export interface ProjectionFailure {
  featureIndex: number;
  reason: string;
}

/**
 * Reprojects every feature to the view CRS. Features whose coordinates cannot
 * be represented (NaN, infinite, wrong CRS) are reported instead of silently
 * rendering as garbage on the map.
 */
export function projectFeatures<T extends { geometry: Geometry }>(
  features: T[],
  from: string,
  to: string = VIEW_CRS,
): { projected: T[]; failures: ProjectionFailure[] } {
  const projected: T[] = [];
  const failures: ProjectionFailure[] = [];

  features.forEach((feature, index) => {
    try {
      const geometry = transformGeometry(feature.geometry, from, to);

      if (!positionsAreFinite(geometry)) {
        failures.push({ featureIndex: index, reason: "coordinates are not finite" });
        return;
      }

      projected.push({ ...feature, geometry });
    } catch (error) {
      failures.push({
        featureIndex: index,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return { projected, failures };
}

