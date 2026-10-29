import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import VectorLayer from "ol/layer/Vector";
import type OlMap from "ol/Map";
import { fromLonLat } from "ol/proj";
import VectorSource from "ol/source/Vector";
import { Stroke, Style } from "ol/style";
import type { EarthquakeTarget, FireTarget, FlightTarget, SatelliteTarget, VesselTarget } from "../lib/gis/types";
import {
  getEarthquakeStyle,
  getFireStyle,
  getFlightStyle,
  getSatelliteStyle,
  getVesselStyle,
} from "./telemetryIcons";

export interface TelemetryLayers {
  flightsLayer: VectorLayer<VectorSource>;
  earthquakesLayer: VectorLayer<VectorSource>;
  satellitesLayer: VectorLayer<VectorSource>;
  firesLayer: VectorLayer<VectorSource>;
  vesselsLayer: VectorLayer<VectorSource>;
  tracksLayer: VectorLayer<VectorSource>;
}

const TELEMETRY_TRACKS_Z = 790;
const TELEMETRY_POINTS_Z = 800;

let flightsSource: VectorSource | null = null;
let earthquakesSource: VectorSource | null = null;
let satellitesSource: VectorSource | null = null;
let firesSource: VectorSource | null = null;
let vesselsSource: VectorSource | null = null;
let tracksSource: VectorSource | null = null;

let flightsLayer: VectorLayer<VectorSource> | null = null;
let earthquakesLayer: VectorLayer<VectorSource> | null = null;
let satellitesLayer: VectorLayer<VectorSource> | null = null;
let firesLayer: VectorLayer<VectorSource> | null = null;
let vesselsLayer: VectorLayer<VectorSource> | null = null;
let tracksLayer: VectorLayer<VectorSource> | null = null;

/**
 * Creates and attaches high-fidelity telemetry layers with category-specific
 * vector icons (airliners, helicopters, drones, satellites, container ships, tankers,
 * cruise ships, flames, and seismic epicenter rings) to the OpenLayers map.
 */
export function createTelemetryLayers(map: OlMap): TelemetryLayers {
  // Clean up any existing instances first
  if (flightsLayer) map.removeLayer(flightsLayer);
  if (earthquakesLayer) map.removeLayer(earthquakesLayer);
  if (satellitesLayer) map.removeLayer(satellitesLayer);
  if (firesLayer) map.removeLayer(firesLayer);
  if (vesselsLayer) map.removeLayer(vesselsLayer);
  if (tracksLayer) map.removeLayer(tracksLayer);

  flightsSource = new VectorSource();
  earthquakesSource = new VectorSource();
  satellitesSource = new VectorSource();
  firesSource = new VectorSource();
  vesselsSource = new VectorSource();
  tracksSource = new VectorSource();

  // 1. ADS-B Flights: Category-specific aircraft silhouette (Airliner / Heavy / Rotorcraft / Drone / Prop)
  flightsLayer = new VectorLayer({
    source: flightsSource,
    style: getFlightStyle,
    zIndex: TELEMETRY_POINTS_Z,
  });

  // 2. Real-Time Earthquakes: Concentric seismic shockwave epicenter rings
  earthquakesLayer = new VectorLayer({
    source: earthquakesSource,
    style: getEarthquakeStyle,
    zIndex: TELEMETRY_POINTS_Z + 1,
  });

  // 3. Orbital Satellites: Satellite bus with dual solar array wings
  satellitesLayer = new VectorLayer({
    source: satellitesSource,
    style: getSatelliteStyle,
    zIndex: TELEMETRY_POINTS_Z + 2,
  });

  // 4. NASA FIRMS Active Fires: Thermal hotspot flame glyphs
  firesLayer = new VectorLayer({
    source: firesSource,
    style: getFireStyle,
    zIndex: TELEMETRY_POINTS_Z + 3,
  });

  // 5. AIS Maritime Vessels: Category-specific ship hulls (Container / Tanker / Cruise / Tug)
  vesselsLayer = new VectorLayer({
    source: vesselsSource,
    style: getVesselStyle,
    zIndex: TELEMETRY_POINTS_Z,
  });

  // 6. Satellite Ground Tracks (LineStrings)
  tracksLayer = new VectorLayer({
    source: tracksSource,
    style: new Style({
      stroke: new Stroke({
        color: "rgba(192, 132, 252, 0.65)",
        width: 2,
        lineDash: [6, 4],
      }),
    }),
    zIndex: TELEMETRY_TRACKS_Z,
  });

  map.addLayer(tracksLayer);
  map.addLayer(flightsLayer);
  map.addLayer(earthquakesLayer);
  map.addLayer(satellitesLayer);
  map.addLayer(firesLayer);
  map.addLayer(vesselsLayer);

  return {
    flightsLayer,
    earthquakesLayer,
    satellitesLayer,
    firesLayer,
    vesselsLayer,
    tracksLayer,
  };
}

/**
 * Updates active flight vector features on the telemetry layer.
 */
export function updateFlightFeatures(flights: FlightTarget[]) {
  if (!flightsSource) return;

  const features: Feature[] = [];
  for (const flight of flights) {
    if (
      flight.longitude == null ||
      flight.latitude == null ||
      isNaN(flight.longitude) ||
      isNaN(flight.latitude)
    ) {
      continue;
    }

    const isEmergency = Boolean(flight.emergency);
    const feature = new Feature({
      geometry: new Point(fromLonLat([flight.longitude, flight.latitude])),
      telemetryType: "flight",
      id: flight.icao24,
      callsign: flight.callsign || flight.icao24,
      heading: flight.headingDeg || 0,
      altitude: flight.altitudeMeters || 0,
      velocity: flight.velocityMps || 0,
      country: flight.originCountry,
      isEmergency: isEmergency ? 1 : 0,
      squawk: flight.squawk || "",
      category: flight.category || 0,
      categoryLabel: flight.categoryLabel || "",
      raw: flight,
    });
    features.push(feature);
  }

  flightsSource.clear();
  flightsSource.addFeatures(features);
}

/**
 * Updates earthquake epicenter features on the telemetry layer.
 */
export function updateEarthquakeFeatures(earthquakes: EarthquakeTarget[]) {
  if (!earthquakesSource) return;

  const features: Feature[] = [];
  for (const eq of earthquakes) {
    if (
      eq.longitude == null ||
      eq.latitude == null ||
      isNaN(eq.longitude) ||
      isNaN(eq.latitude)
    ) {
      continue;
    }

    const feature = new Feature({
      geometry: new Point(fromLonLat([eq.longitude, eq.latitude])),
      telemetryType: "earthquake",
      id: eq.id,
      magnitude: eq.magnitude,
      place: eq.place,
      depthKm: eq.depthKm,
      time: eq.time,
      raw: eq,
    });
    features.push(feature);
  }

  earthquakesSource.clear();
  earthquakesSource.addFeatures(features);
}

/**
 * Updates satellite sub-points and orbital ground track line strings.
 */
export function updateSatelliteFeatures(satellites: SatelliteTarget[]) {
  if (!satellitesSource || !tracksSource) return;

  const pointFeatures: Feature[] = [];
  const trackFeatures: Feature[] = [];

  for (const sat of satellites) {
    if (
      sat.longitude == null ||
      sat.latitude == null ||
      isNaN(sat.longitude) ||
      isNaN(sat.latitude)
    ) {
      continue;
    }

    const point = new Feature({
      geometry: new Point(fromLonLat([sat.longitude, sat.latitude])),
      telemetryType: "satellite",
      id: String(sat.noradId),
      name: sat.name,
      altitudeKm: sat.altitudeKm,
      velocityKmh: sat.velocityKmh,
      raw: sat,
    });
    pointFeatures.push(point);

    if (sat.groundTrack && sat.groundTrack.length > 1) {
      const coords = sat.groundTrack.map(([lon, lat]) => fromLonLat([lon, lat]));

      // Split track at antimeridian (when adjacent points jump > 180° longitude)
      let currentSegment: number[][] = [coords[0]];
      for (let i = 1; i < coords.length; i++) {
        const prev = coords[i - 1];
        const curr = coords[i];
        if (Math.abs(curr[0] - prev[0]) > 20000000) {
          if (currentSegment.length > 1) {
            trackFeatures.push(
              new Feature({
                geometry: new LineString(currentSegment),
                telemetryType: "satellite_track",
                id: `${sat.noradId}_track_${i}`,
                satelliteName: sat.name,
              })
            );
          }
          currentSegment = [curr];
        } else {
          currentSegment.push(curr);
        }
      }

      if (currentSegment.length > 1) {
        trackFeatures.push(
          new Feature({
            geometry: new LineString(currentSegment),
            telemetryType: "satellite_track",
            id: `${sat.noradId}_track_end`,
            satelliteName: sat.name,
          })
        );
      }
    }
  }

  satellitesSource.clear();
  satellitesSource.addFeatures(pointFeatures);

  tracksSource.clear();
  tracksSource.addFeatures(trackFeatures);
}

/**
 * Updates active thermal hotspot features (NASA FIRMS) on the telemetry layer.
 */
export function updateFireFeatures(fires: FireTarget[]) {
  if (!firesSource) return;

  const features: Feature[] = [];
  for (const fire of fires) {
    if (
      fire.lon == null ||
      fire.lat == null ||
      isNaN(fire.lon) ||
      isNaN(fire.lat)
    ) {
      continue;
    }

    const feature = new Feature({
      geometry: new Point(fromLonLat([fire.lon, fire.lat])),
      telemetryType: "fire",
      id: fire.id,
      frp: fire.frpMw || 0,
      brightness: fire.brightnessK || 0,
      confidence: fire.confidence || "n",
      acqDate: fire.acqDate || "",
      acqTime: fire.acqTime || "",
      satellite: fire.satellite || "VIIRS",
      dayNight: fire.dayNight || "N",
      raw: fire,
    });
    features.push(feature);
  }

  firesSource.clear();
  firesSource.addFeatures(features);
}

/**
 * Updates active maritime vessel vector features on the telemetry layer.
 */
export function updateVesselFeatures(vessels: VesselTarget[]) {
  if (!vesselsSource) return;

  const features: Feature[] = [];
  for (const vessel of vessels) {
    if (
      vessel.lon == null ||
      vessel.lat == null ||
      isNaN(vessel.lon) ||
      isNaN(vessel.lat)
    ) {
      continue;
    }

    const feature = new Feature({
      geometry: new Point(fromLonLat([vessel.lon, vessel.lat])),
      telemetryType: "vessel",
      id: String(vessel.mmsi),
      name: vessel.name || `MMSI ${vessel.mmsi}`,
      callsign: vessel.callsign || "",
      shipType: vessel.shipType || "Cargo",
      speed: vessel.speedKnots || 0,
      course: vessel.courseDeg || 0,
      heading: vessel.headingDeg ?? vessel.courseDeg ?? 0,
      destination: vessel.destination || "",
      status: vessel.status || "Under way",
      raw: vessel,
    });
    features.push(feature);
  }

  vesselsSource.clear();
  vesselsSource.addFeatures(features);
}

/**
 * Toggles visibility of specific telemetry layers.
 */
export function setTelemetryLayerVisibility(
  feed: "flights" | "earthquakes" | "satellites" | "fires" | "vessels",
  visible: boolean
) {
  if (feed === "flights" && flightsLayer) {
    flightsLayer.setVisible(visible);
  } else if (feed === "earthquakes" && earthquakesLayer) {
    earthquakesLayer.setVisible(visible);
  } else if (feed === "satellites") {
    if (satellitesLayer) satellitesLayer.setVisible(visible);
    if (tracksLayer) tracksLayer.setVisible(visible);
  } else if (feed === "fires" && firesLayer) {
    firesLayer.setVisible(visible);
  } else if (feed === "vessels" && vesselsLayer) {
    vesselsLayer.setVisible(visible);
  }
}

/**
 * Clears all telemetry features.
 */
export function clearTelemetryLayers() {
  flightsSource?.clear();
  earthquakesSource?.clear();
  satellitesSource?.clear();
  firesSource?.clear();
  vesselsSource?.clear();
  tracksSource?.clear();
}
