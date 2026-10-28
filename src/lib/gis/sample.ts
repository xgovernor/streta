import { GEOGRAPHIC_CRS } from "./crs";
import { ROUTES, STATIONS, getRouteStations } from "./data";
import { createDataset } from "./datasets";
import { createLayer, paletteColor } from "./layers";
import type { Dataset, DatasetLayer, FeatureRecord } from "./types";

export const SAMPLE_DATASET_NAME = "Survey network";

/**
 * The bundled sample dataset. It exists so a fresh install has something to
 * look at; it is an ordinary dataset and can be removed like any other.
 */
export function createSampleDataset(
  order = 0,
): { dataset: Dataset; layers: DatasetLayer[] } {
  const stations: FeatureRecord[] = STATIONS.map((station) => ({
    id: `station-${station.id}`,
    geometry: { type: "Point", coordinates: [station.lon, station.lat] },
    properties: {
      name: station.name,
      country: station.country,
      region: station.region,
      status: station.status,
      elevation_m: station.elevation,
      signal_pct: station.signal,
      operator: station.operator,
      installed: station.installed,
    },
  }));

  const routes: FeatureRecord[] = ROUTES.map((route) => ({
    id: `route-${route.id}`,
    geometry: {
      type: "LineString",
      coordinates: getRouteStations(route).map((station) => [station.lon, station.lat]),
    },
    properties: {
      name: route.name,
      status: route.status,
      operator: route.operator,
      stations: route.stationIds.length,
      sequence: getRouteStations(route)
        .map((station) => station.name)
        .join(" → "),
    },
  }));

  const dataset = createDataset({
    name: SAMPLE_DATASET_NAME,
    kind: "sample",
    source: "sample",
    order,
  });

  return {
    dataset,
    layers: [
      createLayer({
        name: "Survey routes",
        datasetId: dataset.id,
        features: routes,
        crs: GEOGRAPHIC_CRS,
        format: "sample",
        style: { color: paletteColor(0), strokeWidth: 1.8, labelField: null },
        order: 0,
      }),
      createLayer({
        name: "Survey stations",
        datasetId: dataset.id,
        features: stations,
        crs: GEOGRAPHIC_CRS,
        format: "sample",
        style: { color: paletteColor(0), pointRadius: 4.5, labelField: "name" },
        order: 1,
      }),
    ],
  };
}
