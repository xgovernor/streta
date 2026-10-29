import Feature, { type FeatureLike } from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorLayer from "ol/layer/Vector";
import type OlMap from "ol/Map";
import { fromLonLat } from "ol/proj";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style } from "ol/style";
import type { EarthquakeTarget, FireTarget, FlightTarget, SatelliteTarget, VesselTarget } from "../lib/gis/types";

export interface TelemetryLayers {
  flightsLayer: WebGLVectorLayer | VectorLayer<VectorSource>;
  earthquakesLayer: WebGLVectorLayer | VectorLayer<VectorSource>;
  satellitesLayer: WebGLVectorLayer | VectorLayer<VectorSource>;
  firesLayer: WebGLVectorLayer | VectorLayer<VectorSource>;
  vesselsLayer: WebGLVectorLayer | VectorLayer<VectorSource>;
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

let flightsLayer: WebGLVectorLayer | VectorLayer<VectorSource> | null = null;
let earthquakesLayer: WebGLVectorLayer | VectorLayer<VectorSource> | null = null;
let satellitesLayer: WebGLVectorLayer | VectorLayer<VectorSource> | null = null;
let firesLayer: WebGLVectorLayer | VectorLayer<VectorSource> | null = null;
let vesselsLayer: WebGLVectorLayer | VectorLayer<VectorSource> | null = null;
let tracksLayer: VectorLayer<VectorSource> | null = null;

const fireCanvasStyle = (feature: FeatureLike) => {
  const frp = (feature.get("frp") as number) || 10;
  const radius = Math.min(18, Math.max(4, 4 + Math.sqrt(frp)));
  const color = frp > 200 ? "#ef4444" : frp > 50 ? "#f97316" : "#eab308";
  return new Style({
    image: new CircleStyle({
      radius,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: "#ffffff", width: 1 }),
    }),
  });
};

const vesselCanvasStyle = (feature: FeatureLike) => {
  const course = (feature.get("course") as number) || 0;
  return new Style({
    image: new RegularShape({
      points: 3,
      radius: 7,
      rotation: (course * Math.PI) / 180,
      rotateWithView: true,
      fill: new Fill({ color: "#06b6d4" }),
      stroke: new Stroke({ color: "#ffffff", width: 1 }),
    }),
  });
};

const flightCanvasStyle = (feature: FeatureLike) => {
  const heading = (feature.get("heading") as number) || 0;
  const alt = (feature.get("altitude") as number) || 0;
  const color =
    alt > 10000 ? "#f59e0b" : alt > 7000 ? "#10b981" : alt > 3000 ? "#06b6d4" : "#38bdf8";
  return new Style({
    image: new RegularShape({
      points: 3,
      radius: 8,
      rotation: (heading * Math.PI) / 180,
      rotateWithView: true,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: "#ffffff", width: 1 }),
    }),
  });
};

const earthquakeCanvasStyle = (feature: FeatureLike) => {
  const mag = (feature.get("magnitude") as number) || 3;
  const color =
    mag >= 6.0
      ? "rgba(239, 68, 68, 0.85)"
      : mag >= 4.5
        ? "rgba(245, 158, 11, 0.8)"
        : "rgba(6, 182, 212, 0.75)";
  const radius = Math.min(22, Math.max(5, 4 + mag * 2.5));
  return new Style({
    image: new CircleStyle({
      radius,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: "#ffffff", width: 1.5 }),
    }),
  });
};

const satelliteCanvasStyle = () => {
  return new Style({
    image: new RegularShape({
      points: 4,
      radius: 9,
      fill: new Fill({ color: "#c084fc" }),
      stroke: new Stroke({ color: "#ffffff", width: 1.5 }),
    }),
  });
};

function checkWebGLSupport(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    return Boolean(gl);
  } catch {
    return false;
  }
}

/**
 * Creates and attaches high-performance WebGL telemetry layers to the OpenLayers map,
 * with an automatic fallback to 2D Canvas VectorLayers if WebGL is unavailable or fails.
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

  const hasWebGL = checkWebGLSupport();

  if (hasWebGL) {
    try {
      // 1. ADS-B Flights: GPU Triangle symbol rotated by heading & colored by altitude
      flightsLayer = new WebGLVectorLayer({
        source: flightsSource,
        style: {
          "shape-points": 3,
          "shape-radius": 8,
          "shape-rotation": ["*", ["get", "heading"], Math.PI / 180],
          "shape-rotate-with-view": true,
          "shape-fill-color": [
            "interpolate",
            ["linear"],
            ["get", "altitude"],
            0,
            "#38bdf8",
            3000,
            "#06b6d4",
            7000,
            "#10b981",
            11000,
            "#f59e0b",
          ],
          "shape-stroke-color": "#ffffff",
          "shape-stroke-width": 1,
        },
        zIndex: TELEMETRY_POINTS_Z,
      });

      // 2. Real-Time Earthquakes: Proportional pulsating circles by magnitude
      earthquakesLayer = new WebGLVectorLayer({
        source: earthquakesSource,
        style: {
          "circle-radius": ["+", 4, ["*", ["get", "magnitude"], 2.5]],
          "circle-fill-color": [
            "case",
            [">=", ["get", "magnitude"], 6.0],
            "rgba(239, 68, 68, 0.85)",
            [">=", ["get", "magnitude"], 4.5],
            "rgba(245, 158, 11, 0.8)",
            "rgba(6, 182, 212, 0.75)",
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
        zIndex: TELEMETRY_POINTS_Z + 1,
      });

      // 3. Orbital Satellites: Diamond symbol
      satellitesLayer = new WebGLVectorLayer({
        source: satellitesSource,
        style: {
          "shape-points": 4,
          "shape-radius": 9,
          "shape-fill-color": "#c084fc",
          "shape-stroke-color": "#ffffff",
          "shape-stroke-width": 1.5,
        },
        zIndex: TELEMETRY_POINTS_Z + 2,
      });

      // 4. NASA FIRMS Active Fires: Intense heat anomaly circles
      firesLayer = new WebGLVectorLayer({
        source: firesSource,
        style: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["get", "frp"],
            0,
            4,
            100,
            10,
            500,
            18,
          ],
          "circle-fill-color": [
            "case",
            [">=", ["get", "frp"], 200],
            "rgba(239, 68, 68, 0.9)",
            [">=", ["get", "frp"], 50],
            "rgba(249, 115, 22, 0.85)",
            "rgba(234, 179, 8, 0.8)",
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1,
        },
        zIndex: TELEMETRY_POINTS_Z + 3,
      });

      // 5. AIS Maritime Vessels: Directional ship hulls
      vesselsLayer = new WebGLVectorLayer({
        source: vesselsSource,
        style: {
          "shape-points": 3,
          "shape-radius": 7,
          "shape-rotation": ["*", ["get", "course"], Math.PI / 180],
          "shape-rotate-with-view": true,
          "shape-fill-color": "#06b6d4",
          "shape-stroke-color": "#ffffff",
          "shape-stroke-width": 1,
        },
        zIndex: TELEMETRY_POINTS_Z,
      });
    } catch (err) {
      console.warn("WebGL layer init failed, using Canvas fallback:", err);
      flightsLayer = null;
      earthquakesLayer = null;
      satellitesLayer = null;
      firesLayer = null;
      vesselsLayer = null;
    }
  }

  // Graceful fallback to Canvas VectorLayers
  if (!flightsLayer) {
    flightsLayer = new VectorLayer({
      source: flightsSource,
      style: flightCanvasStyle,
      zIndex: TELEMETRY_POINTS_Z,
    });
  }
  if (!earthquakesLayer) {
    earthquakesLayer = new VectorLayer({
      source: earthquakesSource,
      style: earthquakeCanvasStyle,
      zIndex: TELEMETRY_POINTS_Z + 1,
    });
  }
  if (!satellitesLayer) {
    satellitesLayer = new VectorLayer({
      source: satellitesSource,
      style: satelliteCanvasStyle,
      zIndex: TELEMETRY_POINTS_Z + 2,
    });
  }
  if (!firesLayer) {
    firesLayer = new VectorLayer({
      source: firesSource,
      style: fireCanvasStyle,
      zIndex: TELEMETRY_POINTS_Z + 3,
    });
  }
  if (!vesselsLayer) {
    vesselsLayer = new VectorLayer({
      source: vesselsSource,
      style: vesselCanvasStyle,
      zIndex: TELEMETRY_POINTS_Z,
    });
  }

  // Satellite Ground Tracks (LineStrings)
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

    const feature = new Feature({
      geometry: new Point(fromLonLat([flight.longitude, flight.latitude])),
      telemetryType: "flight",
      id: flight.icao24,
      callsign: flight.callsign || flight.icao24,
      heading: flight.headingDeg || 0,
      altitude: flight.altitudeMeters || 0,
      velocity: flight.velocityMps || 0,
      country: flight.originCountry,
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

  const satFeatures: Feature[] = [];
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

    // Point feature for the satellite
    const ptFeature = new Feature({
      geometry: new Point(fromLonLat([sat.longitude, sat.latitude])),
      telemetryType: "satellite",
      id: sat.id,
      name: sat.name,
      altitude: sat.altitudeKm,
      velocity: sat.velocityKmh,
      raw: sat,
    });
    satFeatures.push(ptFeature);

    // Ground track lines
    if (sat.groundTrack && sat.groundTrack.length > 1) {
      let currentSegment: [number, number][] = [];
      for (let i = 0; i < sat.groundTrack.length; i++) {
        const [lon, lat] = sat.groundTrack[i];
        if (currentSegment.length > 0) {
          const prevLon = currentSegment[currentSegment.length - 1][0];
          if (Math.abs(lon - prevLon) > 180) {
            if (currentSegment.length > 1) {
              const lineCoords = currentSegment.map((c) => fromLonLat(c));
              trackFeatures.push(
                new Feature({
                  geometry: new LineString(lineCoords),
                  telemetryType: "satellite_track",
                  satelliteId: sat.id,
                })
              );
            }
            currentSegment = [];
          }
        }
        currentSegment.push([lon, lat]);
      }
      if (currentSegment.length > 1) {
        const lineCoords = currentSegment.map((c) => fromLonLat(c));
        trackFeatures.push(
          new Feature({
            geometry: new LineString(lineCoords),
            telemetryType: "satellite_track",
            satelliteId: sat.id,
          })
        );
      }
    }
  }

  satellitesSource.clear();
  satellitesSource.addFeatures(satFeatures);

  tracksSource.clear();
  tracksSource.addFeatures(trackFeatures);
}

/**
 * Updates active NASA FIRMS fire vector features on the telemetry layer.
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

