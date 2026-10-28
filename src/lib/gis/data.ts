import type { BasemapAttribution, BasemapDefinition } from "./types";

export type StationStatus = "online" | "degraded" | "offline";

export interface Station {
  id: string;
  name: string;
  country: string;
  region: string;
  lon: number;
  lat: number;
  status: StationStatus;
  elevation: number;
  signal: number;
  operator: string;
  installed: string;
}

export interface Route {
  id: string;
  name: string;
  stationIds: string[];
  status: "active" | "planned";
  operator: string;
}

/**
 * Google publishes its basemaps as plain XYZ rasters behind four interchangeable
 * hosts. `lyrs` selects the layer: `m` roadmap, `s` satellite imagery, `y` the
 * hybrid of imagery plus roads and labels.
 */
function googleTiles(lyrs: string): string[] {
  return [0, 1, 2, 3].map(
    (host) =>
      `https://mt${host}.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}&hl=en`,
  );
}

const OPENFREEMAP_ATTRIBUTION: BasemapAttribution[] = [
  { label: "OpenFreeMap", href: "https://openfreemap.org" },
  { label: "OpenMapTiles", href: "https://openmaptiles.org" },
  {
    label: "OpenStreetMap",
    href: "https://www.openstreetmap.org/copyright",
  },
];

const GOOGLE_ATTRIBUTION: BasemapAttribution[] = [
  { label: "Google", href: "https://about.google/products/maps/" },
];

/** Google's satellite and hybrid imagery is licensed from Maxar. */
const GOOGLE_IMAGERY_ATTRIBUTION: BasemapAttribution[] = [
  ...GOOGLE_ATTRIBUTION,
  { label: "Maxar", href: "https://www.maxar.com" },
];

const OSM_ATTRIBUTION: BasemapAttribution[] = [
  {
    label: "OpenStreetMap",
    href: "https://www.openstreetmap.org/copyright",
  },
];

/**
 * Every basemap the workspace can draw. Vector styles come from OpenFreeMap;
 * the raster entries are served by Google, Esri and the OpenStreetMap
 * Foundation under their own terms, which is why each one carries the
 * attribution shown on the map while it is active.
 */
export const BASEMAPS: BasemapDefinition[] = [
  {
    id: "positron",
    name: "Positron",
    tone: "Neutral · light",
    kind: "style",
    url: "https://tiles.openfreemap.org/styles/positron",
    attribution: OPENFREEMAP_ATTRIBUTION,
  },
  {
    id: "atlas",
    name: "Atlas",
    tone: "Terrain · warm",
    kind: "style",
    url: "https://tiles.openfreemap.org/styles/liberty",
    attribution: OPENFREEMAP_ATTRIBUTION,
  },
  {
    id: "bright",
    name: "Bright",
    tone: "Streets · colour",
    kind: "style",
    url: "https://tiles.openfreemap.org/styles/bright",
    attribution: OPENFREEMAP_ATTRIBUTION,
  },
  {
    id: "midnight",
    name: "Midnight",
    tone: "Dark · technical",
    kind: "style",
    url: "https://tiles.openfreemap.org/styles/dark",
    attribution: OPENFREEMAP_ATTRIBUTION,
  },
  {
    id: "google-maps",
    name: "Google Maps",
    tone: "Streets · Google",
    kind: "raster",
    urls: googleTiles("m"),
    maxZoom: 20,
    attribution: GOOGLE_ATTRIBUTION,
  },
  {
    id: "satellite-imagery",
    name: "Satellite Imagery",
    tone: "Imagery · Esri",
    kind: "raster",
    urls: [
      "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    maxZoom: 19,
    attribution: [
      { label: "Esri", href: "https://www.esri.com" },
      { label: "Maxar", href: "https://www.maxar.com" },
      {
        label: "Earthstar Geographics",
        href: "https://www.earthstar-geo.com",
      },
    ],
  },
  {
    id: "maxar-satellite",
    name: "Maxar Satellite",
    tone: "Imagery · Maxar",
    kind: "raster",
    urls: googleTiles("s"),
    maxZoom: 20,
    attribution: GOOGLE_IMAGERY_ATTRIBUTION,
  },
  {
    id: "hybrid-basemap",
    name: "Hybrid Basemap",
    tone: "Imagery · labelled",
    kind: "raster",
    urls: googleTiles("y"),
    maxZoom: 20,
    attribution: GOOGLE_IMAGERY_ATTRIBUTION,
  },
  {
    id: "openstreetmap",
    name: "OpenStreetMap",
    tone: "Streets · OSM",
    kind: "raster",
    urls: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    maxZoom: 19,
    attribution: OSM_ATTRIBUTION,
  },
];

/**
 * The bundled sample dataset: a station network and its corridors. It seeds a
 * fresh workspace so the map is not empty, and can be removed like any layer.
 */
export const STATIONS: Station[] = [
  {
    id: "zrh",
    name: "Zurich",
    country: "Switzerland",
    region: "Alpine Foreland",
    lon: 8.5417,
    lat: 47.3769,
    status: "online",
    elevation: 408,
    signal: 98,
    operator: "Alpine Survey",
    installed: "2023-04-12",
  },
  {
    id: "lis",
    name: "Lisbon",
    country: "Portugal",
    region: "Iberian Shelf",
    lon: -9.1393,
    lat: 38.7223,
    status: "online",
    elevation: 62,
    signal: 91,
    operator: "Atlantic Array",
    installed: "2023-06-28",
  },
  {
    id: "rey",
    name: "Reykjavik",
    country: "Iceland",
    region: "North Atlantic Ridge",
    lon: -21.8277,
    lat: 64.1265,
    status: "degraded",
    elevation: 45,
    signal: 64,
    operator: "North Ridge",
    installed: "2022-09-01",
  },
  {
    id: "cpt",
    name: "Cape Town",
    country: "South Africa",
    region: "Cape Basin",
    lon: 18.4241,
    lat: -33.9249,
    status: "online",
    elevation: 25,
    signal: 89,
    operator: "Southern Cross",
    installed: "2023-11-19",
  },
  {
    id: "dxb",
    name: "Dubai",
    country: "United Arab Emirates",
    region: "Persian Gulf",
    lon: 55.2708,
    lat: 25.2048,
    status: "online",
    elevation: 5,
    signal: 95,
    operator: "Indo-Pacific",
    installed: "2024-01-22",
  },
  {
    id: "bom",
    name: "Mumbai",
    country: "India",
    region: "Konkan Coast",
    lon: 72.8777,
    lat: 19.076,
    status: "degraded",
    elevation: 14,
    signal: 72,
    operator: "Indo-Pacific",
    installed: "2022-12-11",
  },
  {
    id: "sin",
    name: "Singapore",
    country: "Singapore",
    region: "Malacca Strait",
    lon: 103.8198,
    lat: 1.3521,
    status: "online",
    elevation: 15,
    signal: 96,
    operator: "Indo-Pacific",
    installed: "2024-04-23",
  },
  {
    id: "tyo",
    name: "Tokyo",
    country: "Japan",
    region: "Kanto Plain",
    lon: 139.6917,
    lat: 35.6895,
    status: "online",
    elevation: 40,
    signal: 99,
    operator: "Pacific Ring",
    installed: "2023-09-30",
  },
  {
    id: "syd",
    name: "Sydney",
    country: "Australia",
    region: "Tasman Sea",
    lon: 151.2093,
    lat: -33.8688,
    status: "online",
    elevation: 58,
    signal: 94,
    operator: "Southern Cross",
    installed: "2024-01-14",
  },
  {
    id: "akl",
    name: "Auckland",
    country: "New Zealand",
    region: "Hauraki Gulf",
    lon: 174.7633,
    lat: -36.8485,
    status: "offline",
    elevation: 26,
    signal: 0,
    operator: "Southern Cross",
    installed: "2023-03-05",
  },
  {
    id: "yvr",
    name: "Vancouver",
    country: "Canada",
    region: "Salish Sea",
    lon: -123.1207,
    lat: 49.2827,
    status: "online",
    elevation: 70,
    signal: 88,
    operator: "North Ridge",
    installed: "2024-02-19",
  },
  {
    id: "den",
    name: "Denver",
    country: "United States",
    region: "Front Range",
    lon: -104.9903,
    lat: 39.7392,
    status: "online",
    elevation: 1609,
    signal: 92,
    operator: "Continental Divide",
    installed: "2023-10-08",
  },
  {
    id: "gru",
    name: "Sao Paulo",
    country: "Brazil",
    region: "Serra do Mar",
    lon: -46.6333,
    lat: -23.5505,
    status: "online",
    elevation: 760,
    signal: 85,
    operator: "Atlantic Array",
    installed: "2024-06-02",
  },
  {
    id: "psn",
    name: "Port Stanley",
    country: "Falkland Islands",
    region: "South Atlantic",
    lon: -57.85,
    lat: -51.7,
    status: "offline",
    elevation: 30,
    signal: 0,
    operator: "Southern Cross",
    installed: "2022-05-17",
  },
];

export const ROUTES: Route[] = [
  {
    id: "north-atlantic",
    name: "North Atlantic",
    stationIds: ["zrh", "rey", "yvr"],
    status: "active",
    operator: "North Ridge",
  },
  {
    id: "southern-cross",
    name: "Southern Cross",
    stationIds: ["lis", "cpt", "syd", "akl"],
    status: "active",
    operator: "Southern Cross",

  },
  {
    id: "indo-pacific",
    name: "Indo-Pacific",
    stationIds: ["dxb", "bom", "sin", "tyo"],
    status: "active",
    operator: "Indo-Pacific",
  },
];

export const STATION_BY_ID = new Map(STATIONS.map((station) => [station.id, station]));

export function getRouteStations(route: Route): Station[] {
  return route.stationIds.flatMap((id) => {
    const station = STATION_BY_ID.get(id);
    return station ? [station] : [];
  });
}
