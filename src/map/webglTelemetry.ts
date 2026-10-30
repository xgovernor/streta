import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import MultiLineString from "ol/geom/MultiLineString";
import Point from "ol/geom/Point";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import type OlMap from "ol/Map";
import { fromLonLat, toLonLat } from "ol/proj";
import VectorSource from "ol/source/Vector";
import { Stroke, Style } from "ol/style";
import type { EarthquakeTarget, FireTarget, FlightTarget, SatelliteTarget, VesselTarget } from "../lib/gis/types";
import { computeVoyageRoute, formatRouteStats } from "../lib/gis/voyageRoute";
import { useTelemetryStore } from "../state/telemetryStore";
import {
  getEarthquakeStyle,
  getFireStyle,
  getFlightStyle,
  getSatelliteStyle,
  getVesselRouteLineStyle,
  getVesselRoutePortStyle,
  getVesselStyle,
} from "./telemetryIcons";

export interface TelemetryLayers {
  flightsLayer: WebGLVectorLayer<VectorSource>;
  earthquakesLayer: WebGLVectorLayer<VectorSource>;
  satellitesLayer: WebGLVectorLayer<VectorSource>;
  firesLayer: WebGLVectorLayer<VectorSource>;
  vesselsLayer: WebGLVectorLayer<VectorSource>;
  vesselRoutesLayer: WebGLVectorLayer<VectorSource>;
  tracksLayer: WebGLVectorLayer<VectorSource>;
}

const TELEMETRY_TRACKS_Z = 790;
const TELEMETRY_POINTS_Z = 800;

let activeMap: OlMap | null = null;
let flightsSource: VectorSource | null = null;
let earthquakesSource: VectorSource | null = null;
let satellitesSource: VectorSource | null = null;
let firesSource: VectorSource | null = null;
let vesselsSource: VectorSource | null = null;
let vesselRoutesSource: VectorSource | null = null;
let tracksSource: VectorSource | null = null;

let flightsLayer: WebGLVectorLayer<VectorSource> | null = null;
let earthquakesLayer: WebGLVectorLayer<VectorSource> | null = null;
let satellitesLayer: WebGLVectorLayer<VectorSource> | null = null;
let firesLayer: WebGLVectorLayer<VectorSource> | null = null;
let vesselsLayer: WebGLVectorLayer<VectorSource> | null = null;
let vesselRoutesLayer: WebGLVectorLayer<VectorSource> | null = null;
let tracksLayer: WebGLVectorLayer<VectorSource> | null = null;

/**
 * Returns the currently active OpenLayers map instance used by telemetry layers.
 */
export function getActiveTelemetryMap(): OlMap | null {
  return activeMap;
}

/**
 * Fast type guard and filter for OpenLayers layer hit detection
 */
export function isTelemetryLayer(layer: unknown): boolean {
  if (!layer || typeof (layer as { get?: (k: string) => unknown }).get !== "function") return false;
  return (layer as { get: (k: string) => unknown }).get("telemetry") === true;
}

/**
 * Creates and attaches high-fidelity telemetry layers with category-specific
 * vector icons (airliners, helicopters, drones, satellites, container ships, tankers,
 * cruise ships, flames, and seismic epicenter rings) to the OpenLayers map.
 */
export function createTelemetryLayers(map: OlMap): TelemetryLayers {
  activeMap = map;
  // Clean up any existing instances first
  if (flightsLayer) map.removeLayer(flightsLayer);
  if (earthquakesLayer) map.removeLayer(earthquakesLayer);
  if (satellitesLayer) map.removeLayer(satellitesLayer);
  if (firesLayer) map.removeLayer(firesLayer);
  if (vesselsLayer) map.removeLayer(vesselsLayer);
  if (vesselRoutesLayer) map.removeLayer(vesselRoutesLayer);
  if (tracksLayer) map.removeLayer(tracksLayer);

  flightsSource = new VectorSource();
  earthquakesSource = new VectorSource();
  satellitesSource = new VectorSource();
  firesSource = new VectorSource();
  vesselsSource = new VectorSource();
  vesselRoutesSource = new VectorSource();
  tracksSource = new VectorSource();

  // 1. ADS-B Flights: Category-specific aircraft silhouette (Airliner / Heavy / Rotorcraft / Drone / Prop)
  flightsLayer = new WebGLVectorLayer({
    source: flightsSource,
    style: getFlightStyle as any,
    zIndex: TELEMETRY_POINTS_Z,
    properties: { telemetry: true, id: "telemetry-flights" },
  });

  // 2. Real-Time Earthquakes: Concentric seismic shockwave epicenter rings
  earthquakesLayer = new WebGLVectorLayer({
    source: earthquakesSource,
    style: getEarthquakeStyle as any,
    zIndex: TELEMETRY_POINTS_Z + 1,
    properties: { telemetry: true, id: "telemetry-earthquakes" },
  });

  // 3. Orbital Satellites: Satellite bus with dual solar array wings
  satellitesLayer = new WebGLVectorLayer({
    source: satellitesSource,
    style: getSatelliteStyle as any,
    zIndex: TELEMETRY_POINTS_Z + 2,
    properties: { telemetry: true, id: "telemetry-satellites" },
  });

  // 4. NASA FIRMS Active Fires: Thermal hotspot flame glyphs
  firesLayer = new WebGLVectorLayer({
    source: firesSource,
    style: getFireStyle as any,
    zIndex: TELEMETRY_POINTS_Z + 3,
    properties: { telemetry: true, id: "telemetry-fires" },
  });

  // 5. AIS Maritime Vessels: Category-specific ship hulls (Container / Tanker / Cruise / Tug)
  vesselsLayer = new WebGLVectorLayer({
    source: vesselsSource,
    style: getVesselStyle as any,
    zIndex: TELEMETRY_POINTS_Z,
    properties: { telemetry: true, id: "telemetry-vessels" },
  });

  // 5b. Estimated voyage routes: dashed geodesic arcs (vessel fix -> resolved
  // destination port). Dashed marks "predicted, not traveled" per S-52; sits a
  // plane below the vessel icons so routes never cover ships.
  vesselRoutesLayer = new WebGLVectorLayer({
    source: vesselRoutesSource,
    style: ((feature: Feature) =>
      feature.get("routeKind") === "port"
        ? getVesselRoutePortStyle(feature)
        : getVesselRouteLineStyle(feature)) as any,
    zIndex: TELEMETRY_TRACKS_Z,
    properties: { telemetry: true, id: "telemetry-vessel-routes" },
  });

  // 6. Satellite Ground Tracks (LineStrings)
  tracksLayer = new WebGLVectorLayer({
    source: tracksSource,
    style: new Style({
      stroke: new Stroke({
        color: "rgba(255, 255, 255, 0.6)",
        width: 2,
        lineDash: [6, 4],
      }),
    }) as any,
    zIndex: TELEMETRY_TRACKS_Z,
    properties: { telemetry: true, id: "telemetry-tracks" },
  });

  map.addLayer(tracksLayer);
  map.addLayer(flightsLayer);
  map.addLayer(earthquakesLayer);
  map.addLayer(satellitesLayer);
  map.addLayer(firesLayer);
  map.addLayer(vesselRoutesLayer);
  map.addLayer(vesselsLayer);

  return {
    flightsLayer,
    earthquakesLayer,
    satellitesLayer,
    firesLayer,
    vesselsLayer,
    vesselRoutesLayer,
    tracksLayer,
  };
}

interface MovingKinematicState {
  feature: Feature;
  lon: number;
  lat: number;
  renderedLon: number;
  renderedLat: number;
  speedMps: number;
  headingDeg: number;
  targetHeadingDeg: number;
  lastUpdated: number;
  kind: "flight" | "vessel" | "satellite";
}

const activeFlightFeatures = new Map<string, Feature>();
const activeVesselFeatures = new Map<string, Feature>();
const activeEarthquakeFeatures = new Map<string, Feature>();
const activeSatelliteFeatures = new Map<string, Feature>();
const activeFireFeatures = new Map<string, Feature>();
/** Estimated voyage-route pair per vessel: dashed geodesic line + port marker. */
const activeVesselRouteFeatures = new Map<string, { line: Feature; port: Feature }>();
let emphasizedRouteHoverId: string | null = null;
let emphasizedRouteSelectedId: string | null = null;
const activeKinematics = new Map<string, MovingKinematicState>();
let deadReckoningFrameId: number | null = null;
let lastFrameTime = 0;

function getTargetKey(target: any): string | null {
  if (!target) return null;
  if (target.type === "flight") return target.data?.icao24 || null;
  if (target.type === "vessel") return target.data?.mmsi ? String(target.data.mmsi) : null;
  if (target.type === "satellite") return target.data?.noradId ? String(target.data.noradId) : null;
  return null;
}

/**
 * Returns shortest signed angle difference between two degree headings (-180° to +180°).
 * Prevents 360° spinning / flipping glitch when crossing North (359° <-> 001°).
 */
export function shortestAngleDelta(fromDeg: number, toDeg: number): number {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

/**
 * Retrieves a live vector feature by its telemetry type and primary identifier.
 */
export function getTelemetryFeatureById(type: string, id: string): Feature | undefined {
  if (type === "flight") return activeFlightFeatures.get(id);
  if (type === "vessel") return activeVesselFeatures.get(id);
  if (type === "satellite") {
    return activeSatelliteFeatures.get(String(id)) || satellitesSource?.getFeatures().find((f) => String(f.get("id")) === String(id));
  }
  if (type === "earthquake") {
    return activeEarthquakeFeatures.get(String(id)) || earthquakesSource?.getFeatures().find((f) => String(f.get("id")) === String(id));
  }
  if (type === "fire") {
    return activeFireFeatures.get(String(id)) || firesSource?.getFeatures().find((f) => String(f.get("id")) === String(id));
  }
  return undefined;
}

function ensureDeadReckoningLoop() {
  if (deadReckoningFrameId !== null || typeof requestAnimationFrame === "undefined") return;

  const loop = (timestamp: number) => {
    if (!lastFrameTime) lastFrameTime = timestamp;
    const frameDt = Math.min((timestamp - lastFrameTime) / 1000, 0.1);
    lastFrameTime = timestamp;

    const nowSec = Date.now() / 1000;
    const view = activeMap?.getView();
    const zoom = view?.getZoom() ?? 10;

    // 1. Level of Detail (LOD) Zoom Gating:
    // At zoom < 6 (resolution > 2445 m/px), physical motion is < 0.1 px/sec (imperceptible).
    // Suspend 60 FPS bulk kinematic recalculations to save up to 90% CPU/battery overhead.
    const isGlobalZoom = zoom < 6;

    // Priority targets that MUST always animate regardless of zoom or bounds
    const telemStore = useTelemetryStore.getState();
    const priorityId1 = getTargetKey(telemStore.selectedTarget);
    const priorityId2 = getTargetKey(telemStore.hoveredTarget);

    // 2. Viewport Culling:
    // Calculate visible geographic bounds (+15% padding) so off-screen targets consume 0 CPU.
    let minLon = -180, maxLon = 180, minLat = -85, maxLat = 85;
    if (!isGlobalZoom && view) {
      const extent = view.calculateExtent();
      const padX = (extent[2] - extent[0]) * 0.15;
      const padY = (extent[3] - extent[1]) * 0.15;
      const sw = toLonLat([extent[0] - padX, extent[1] - padY]);
      const ne = toLonLat([extent[2] + padX, extent[3] + padY]);
      minLon = Math.min(sw[0], ne[0]);
      maxLon = Math.max(sw[0], ne[0]);
      minLat = Math.min(sw[1], ne[1]);
      maxLat = Math.max(sw[1], ne[1]);
    }

    for (const [id, state] of activeKinematics.entries()) {
      if (state.speedMps <= 0) continue;

      const dt = nowSec - state.lastUpdated;
      if (dt > 45) {
        // Expired target
        continue;
      }

      const isPriority = id === priorityId1 || id === priorityId2;

      // LOD and Viewport Culling check
      if (!isPriority) {
        if (isGlobalZoom) continue;
        if (
          state.renderedLon < minLon ||
          state.renderedLon > maxLon ||
          state.renderedLat < minLat ||
          state.renderedLat > maxLat
        ) {
          continue;
        }
      }

      // Extrapolation damping: 100% speed for first 4s, exponential decay afterwards to prevent runaway
      const decay = dt > 4 ? Math.exp(-(dt - 4) * 0.12) : 1.0;
      const effectiveSpeed = state.speedMps * decay;

      // Shortest-path angular heading interpolation (prevents 360° flip / spin glitch)
      const dHeading = shortestAngleDelta(state.headingDeg, state.targetHeadingDeg);
      if (Math.abs(dHeading) > 0.05) {
        state.headingDeg = (state.headingDeg + dHeading * Math.min(1.0, frameDt * 3.5) + 360) % 360;
        state.feature.set("heading", state.headingDeg);
        if (state.kind === "vessel") {
          state.feature.set("course", state.headingDeg);
        }
      }

      // Spherical kinematic forward step
      const headingRad = (state.headingDeg * Math.PI) / 180;
      const dLat = (effectiveSpeed * Math.cos(headingRad) * frameDt) / 110574;
      const latRad = (state.renderedLat * Math.PI) / 180;
      const cosLat = Math.max(Math.cos(latRad), 0.05);
      const dLon = (effectiveSpeed * Math.sin(headingRad) * frameDt) / (111320 * cosLat);

      let nextLon = state.renderedLon + dLon;
      let nextLat = Math.max(-85, Math.min(85, state.renderedLat + dLat));

      // Antimeridian wrapping safety (±180°)
      if (nextLon > 180) nextLon -= 360;
      else if (nextLon < -180) nextLon += 360;

      state.renderedLon = nextLon;
      state.renderedLat = nextLat;

      const geom = state.feature.getGeometry();
      if (geom instanceof Point) {
        geom.setCoordinates(fromLonLat([nextLon, nextLat]));
      }
    }

    // 3. Feature-anchored hover popup synchronization:
    // If a moving object is hovered, update its screen pixel coordinates at 60 FPS
    if (priorityId2 && activeMap) {
      const hoveredKin = activeKinematics.get(priorityId2);
      if (hoveredKin) {
        const screenPx = activeMap.getPixelFromCoordinate(
          fromLonLat([hoveredKin.renderedLon, hoveredKin.renderedLat])
        );
        if (screenPx) {
          telemStore.updateHoverPosition({
            x: Math.round(screenPx[0]),
            y: Math.round(screenPx[1]),
          });
        }
      }
    }

    deadReckoningFrameId = requestAnimationFrame(loop);
  };

  deadReckoningFrameId = requestAnimationFrame(loop);
}

/**
 * Updates active flight vector features with persistent feature caching
 * and 60 FPS kinematic dead-reckoning (zero reallocation at steady state).
 */
export function updateFlightFeatures(flights: FlightTarget[]) {
  if (!flightsSource) return;

  const nowSec = Date.now() / 1000;
  const currentIds = new Set<string>();

  for (const flight of flights) {
    if (
      flight.longitude == null ||
      flight.latitude == null ||
      isNaN(flight.longitude) ||
      isNaN(flight.latitude)
    ) {
      continue;
    }

    currentIds.add(flight.icao24);
    const isEmergency = Boolean(flight.emergency);

    // Track staleness straight from the source fix time, so a 60 s old
    // contact reads as 60 s old regardless of when the client last polled.
    const fixEpoch =
      flight.positionTimeEpoch && flight.positionTimeEpoch > 0
        ? flight.positionTimeEpoch
        : (flight.lastContactEpoch && flight.lastContactEpoch > 0
          ? flight.lastContactEpoch
          : nowSec);
    const fixAgeSec = Math.max(0, Math.round(nowSec - fixEpoch));
    // Longer than one dead-reckoning horizon => this is a replayed instant,
    // not a live fix: draw the recorded position frozen, never extrapolate.
    const isReplay = fixAgeSec > 30;

    let feature = activeFlightFeatures.get(flight.icao24);

    if (feature) {
      // In-place property update (0 allocation, no GC pause!)
      feature.set("callsign", flight.callsign || flight.icao24);
      feature.set("heading", flight.headingDeg || 0);
      feature.set("altitude", flight.altitudeMeters || 0);
      feature.set("velocity", flight.velocityMps || 0);
      feature.set("country", flight.originCountry);
      feature.set("isEmergency", isEmergency ? 1 : 0);
      feature.set("squawk", flight.squawk || "");
      feature.set("ageSec", fixAgeSec);
      feature.set("category", flight.category || 0);
      feature.set("categoryLabel", flight.categoryLabel || "");
      feature.set("raw", flight);

      // Smooth position convergence towards new telemetry coordinate
      const kin = activeKinematics.get(flight.icao24);
      if (isReplay) {
        (feature.getGeometry() as Point).setCoordinates(fromLonLat([flight.longitude, flight.latitude]));
      } else if (kin) {
        const distDeg = Math.hypot(flight.longitude - kin.renderedLon, flight.latitude - kin.renderedLat);
        if (distDeg > 0.5) {
          // Large reposition / teleport
          kin.renderedLon = flight.longitude;
          kin.renderedLat = flight.latitude;
          (feature.getGeometry() as Point).setCoordinates(fromLonLat([flight.longitude, flight.latitude]));
        } else {
          // Smooth 40% exponential convergence
          kin.renderedLon = kin.renderedLon + (flight.longitude - kin.renderedLon) * 0.4;
          kin.renderedLat = kin.renderedLat + (flight.latitude - kin.renderedLat) * 0.4;
        }
        kin.lon = flight.longitude;
        kin.lat = flight.latitude;
        kin.speedMps = flight.velocityMps || 0;
        kin.targetHeadingDeg = flight.headingDeg || 0;
        kin.lastUpdated = nowSec;
      }
    } else {
      // New aircraft appearing
      feature = new Feature({
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
        ageSec: fixAgeSec,
        category: flight.category || 0,
        categoryLabel: flight.categoryLabel || "",
        raw: flight,
      });

      activeFlightFeatures.set(flight.icao24, feature);
      flightsSource.addFeature(feature);

      if (!isReplay && !flight.onGround && (flight.velocityMps || 0) > 0) {
        activeKinematics.set(flight.icao24, {
          feature,
          lon: flight.longitude,
          lat: flight.latitude,
          renderedLon: flight.longitude,
          renderedLat: flight.latitude,
          speedMps: flight.velocityMps || 0,
          headingDeg: flight.headingDeg || 0,
          targetHeadingDeg: flight.headingDeg || 0,
          lastUpdated: nowSec,
          kind: "flight",
        });
      }
    }
  }

  // Remove vanished aircraft
  for (const [id, feature] of activeFlightFeatures.entries()) {
    if (!currentIds.has(id)) {
      flightsSource.removeFeature(feature);
      activeFlightFeatures.delete(id);
      activeKinematics.delete(id);
    }
  }

  ensureDeadReckoningLoop();
}

/**
 * Zero-copy ultra-high-throughput telemetry updater from packed 32-byte Float32Array buffers.
 * Capable of unpacking 100,000+ aircraft coordinates directly into WebGL vertex memory in < 2ms.
 */
export function updateFlightFeaturesFromBinary(buffer: Float32Array) {
  if (!flightsSource) return;

  const count = Math.floor(buffer.length / 8);
  const currentIds = new Set<string>();

  for (let i = 0; i < count; i++) {
    const offset = i * 8;
    const idHash = buffer[offset];
    const lon = buffer[offset + 1];
    const lat = buffer[offset + 2];
    const heading = buffer[offset + 3];
    const altitude = buffer[offset + 4];
    const velocity = buffer[offset + 5];

    if (isNaN(lon) || isNaN(lat)) continue;

    const id = `bin-${idHash}`;
    currentIds.add(id);

    let feature = activeFlightFeatures.get(id);
    if (feature) {
      feature.set("heading", heading);
      feature.set("altitude", altitude);
      feature.set("velocity", velocity);
      (feature.getGeometry() as Point).setCoordinates(fromLonLat([lon, lat]));
    } else {
      feature = new Feature({
        geometry: new Point(fromLonLat([lon, lat])),
        telemetryType: "flight",
        id,
        callsign: id,
        heading,
        altitude,
        velocity,
        country: "",
        isEmergency: 0,
        squawk: "",
        ageSec: 0,
        category: 0,
        categoryLabel: "Airliner",
      });
      activeFlightFeatures.set(id, feature);
      flightsSource.addFeature(feature);
    }
  }

  for (const [id, feature] of activeFlightFeatures.entries()) {
    if (id.startsWith("bin-") && !currentIds.has(id)) {
      flightsSource.removeFeature(feature);
      activeFlightFeatures.delete(id);
    }
  }
}

/**
 * Renders an aircraft historical flight trail on the tracks layer.
 */
export function displayFlightTrail(trailGeojson: any) {
  if (!tracksSource || !trailGeojson?.geometry?.coordinates) return;

  const coords = trailGeojson.geometry.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return;

  clearFlightTrails();

  const projectedCoords = coords.map(([lon, lat]: [number, number]) => fromLonLat([lon, lat]));

  const trailFeature = new Feature({
    geometry: new LineString(projectedCoords),
    telemetryType: "flight_trail",
    icao24: trailGeojson.properties?.icao24 || "",
  });

  trailFeature.setStyle(
    new Style({
      stroke: new Stroke({
        color: "#ffffff",
        width: 3,
        lineCap: "round",
        lineJoin: "round",
      }),
    })
  );

  tracksSource.addFeature(trailFeature);
}

/**
 * Removes any active flight breadcrumb trails from the tracks layer.
 */
export function clearFlightTrails() {
  if (!tracksSource) return;
  const existing = tracksSource.getFeatures();
  for (const f of existing) {
    if (f.get("telemetryType") === "flight_trail") {
      tracksSource.removeFeature(f);
    }
  }
}

/**
 * Updates earthquake epicenter features on the telemetry layer
 * with zero-reallocation in-place caching.
 */
export function updateEarthquakeFeatures(earthquakes: EarthquakeTarget[]) {
  if (!earthquakesSource) return;

  const currentIds = new Set<string>();

  for (const eq of earthquakes) {
    if (
      eq.longitude == null ||
      eq.latitude == null ||
      isNaN(eq.longitude) ||
      isNaN(eq.latitude)
    ) {
      continue;
    }

    currentIds.add(eq.id);
    let feature = activeEarthquakeFeatures.get(eq.id);

    if (feature) {
      feature.set("magnitude", eq.magnitude);
      feature.set("place", eq.place);
      feature.set("depthKm", eq.depthKm);
      feature.set("time", eq.time);
      feature.set("raw", eq);
      (feature.getGeometry() as Point).setCoordinates(fromLonLat([eq.longitude, eq.latitude]));
    } else {
      feature = new Feature({
        geometry: new Point(fromLonLat([eq.longitude, eq.latitude])),
        telemetryType: "earthquake",
        id: eq.id,
        magnitude: eq.magnitude,
        place: eq.place,
        depthKm: eq.depthKm,
        time: eq.time,
        raw: eq,
      });
      activeEarthquakeFeatures.set(eq.id, feature);
      earthquakesSource.addFeature(feature);
    }
  }

  for (const [id, feature] of activeEarthquakeFeatures.entries()) {
    if (!currentIds.has(id)) {
      earthquakesSource.removeFeature(feature);
      activeEarthquakeFeatures.delete(id);
    }
  }
}

/**
 * Updates satellite sub-points and orbital ground track line strings
 * with in-place persistent feature reuse.
 */
export function updateSatelliteFeatures(satellites: SatelliteTarget[]) {
  if (!satellitesSource || !tracksSource) return;

  const currentIds = new Set<string>();
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

    const id = String(sat.noradId);
    currentIds.add(id);
    let point = activeSatelliteFeatures.get(id);

    if (point) {
      point.set("name", sat.name);
      point.set("altitudeKm", sat.altitudeKm);
      point.set("velocityKmh", sat.velocityKmh);
      point.set("raw", sat);
      (point.getGeometry() as Point).setCoordinates(fromLonLat([sat.longitude, sat.latitude]));
    } else {
      point = new Feature({
        geometry: new Point(fromLonLat([sat.longitude, sat.latitude])),
        telemetryType: "satellite",
        id,
        name: sat.name,
        altitudeKm: sat.altitudeKm,
        velocityKmh: sat.velocityKmh,
        raw: sat,
      });
      activeSatelliteFeatures.set(id, point);
      satellitesSource.addFeature(point);
    }

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

  for (const [id, feature] of activeSatelliteFeatures.entries()) {
    if (!currentIds.has(id)) {
      satellitesSource.removeFeature(feature);
      activeSatelliteFeatures.delete(id);
    }
  }

  const oldSatTracks = tracksSource.getFeatures().filter((f) => f.get("telemetryType") === "satellite_track");
  for (const f of oldSatTracks) {
    tracksSource.removeFeature(f);
  }
  tracksSource.addFeatures(trackFeatures);
}

/**
 * Updates active thermal hotspot features (NASA FIRMS) on the telemetry layer
 * with in-place persistent feature caching.
 */
export function updateFireFeatures(fires: FireTarget[]) {
  if (!firesSource) return;

  const currentIds = new Set<string>();

  for (const fire of fires) {
    if (
      fire.lon == null ||
      fire.lat == null ||
      isNaN(fire.lon) ||
      isNaN(fire.lat)
    ) {
      continue;
    }

    currentIds.add(fire.id);
    let feature = activeFireFeatures.get(fire.id);

    if (feature) {
      feature.set("frp", fire.frpMw || 0);
      feature.set("brightness", fire.brightnessK || 0);
      feature.set("confidence", fire.confidence || "n");
      feature.set("acqDate", fire.acqDate || "");
      feature.set("acqTime", fire.acqTime || "");
      feature.set("satellite", fire.satellite || "VIIRS");
      feature.set("dayNight", fire.dayNight || "N");
      feature.set("raw", fire);
      (feature.getGeometry() as Point).setCoordinates(fromLonLat([fire.lon, fire.lat]));
    } else {
      feature = new Feature({
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
      activeFireFeatures.set(fire.id, feature);
      firesSource.addFeature(feature);
    }
  }

  for (const [id, feature] of activeFireFeatures.entries()) {
    if (!currentIds.has(id)) {
      firesSource.removeFeature(feature);
      activeFireFeatures.delete(id);
    }
  }
}

/**
 * Updates active maritime vessel vector features on the telemetry layer.
 */
/**
 * Updates active maritime vessel vector features on the telemetry layer
 * with kinematic interpolation and in-place reuse.
 */
export function updateVesselFeatures(vessels: VesselTarget[]) {
  if (!vesselsSource) return;

  const nowSec = Date.now() / 1000;
  const currentIds = new Set<string>();

  for (const vessel of vessels) {
    if (
      vessel.lon == null ||
      vessel.lat == null ||
      isNaN(vessel.lon) ||
      isNaN(vessel.lat)
    ) {
      continue;
    }

    const id = String(vessel.mmsi);
    currentIds.add(id);

    // Track staleness straight from the fix-receipt time, so a 60 s old AIS
    // contact reads as 60 s old regardless of when the client last polled.
    const fixEpoch =
      vessel.lastContactEpoch && vessel.lastContactEpoch > 0
        ? vessel.lastContactEpoch
        : nowSec;
    const fixAgeSec = Math.max(0, Math.round(nowSec - fixEpoch));
    // Longer than one dead-reckoning horizon => this is a replayed instant:
    // draw the recorded position frozen, never dead-reckon live vessels.
    const isReplay = fixAgeSec > 30;

    // Moored / Drifting Ship Deadband:
    // If speed is < 0.5 knots or status indicates anchored/moored, freeze heading and set velocity to 0.
    // Prevents erratic GPS noise jitter and unwanted kinematic crawl across piers.
    const rawKnots = vessel.speedKnots || 0;
    const statusStr = (vessel.status || "").toLowerCase();
    const isMoored = rawKnots < 0.5 || statusStr.includes("moored") || statusStr.includes("anchor");
    const speedMps = isMoored ? 0 : rawKnots * 0.514444; // 1 knot = 0.514444 m/s

    let feature = activeVesselFeatures.get(id);
    const course = isMoored
      ? ((feature?.get("course") as number) ?? vessel.courseDeg ?? 0)
      : (vessel.courseDeg || 0);

    if (feature) {
      feature.set("name", vessel.name || `MMSI ${vessel.mmsi}`);
      feature.set("callsign", vessel.callsign || "");
      feature.set("shipType", vessel.shipType || "Cargo");
      feature.set("speed", isMoored ? 0 : rawKnots);
      feature.set("course", course);
      feature.set("heading", vessel.headingDeg ?? course);
      feature.set("destination", vessel.destination || "");
      feature.set("status", vessel.status || "Under way");
      feature.set("isMoored", isMoored ? 1 : 0);
      feature.set("ageSec", fixAgeSec);
      feature.set("raw", vessel);

      const kin = activeKinematics.get(id);
      if (isReplay) {
        (feature.getGeometry() as Point).setCoordinates(fromLonLat([vessel.lon, vessel.lat]));
        activeKinematics.delete(id);
      } else if (kin) {
        kin.lon = vessel.lon;
        kin.lat = vessel.lat;
        kin.speedMps = speedMps;
        kin.targetHeadingDeg = course;
        kin.lastUpdated = nowSec;
        kin.renderedLon = kin.renderedLon + (vessel.lon - kin.renderedLon) * 0.35;
        kin.renderedLat = kin.renderedLat + (vessel.lat - kin.renderedLat) * 0.35;
      } else if (speedMps > 0.1) {
        // Returning to live after a scrub: resurrect dead reckoning from the
        // feature's projected geometry (toLonLat reads it back to lon/lat).
        const [kinLon, kinLat] = toLonLat(
          (feature.getGeometry() as Point).getCoordinates(),
        );
        activeKinematics.set(id, {
          feature,
          lon: vessel.lon,
          lat: vessel.lat,
          renderedLon: kinLon,
          renderedLat: kinLat,
          speedMps,
          headingDeg: course,
          targetHeadingDeg: course,
          lastUpdated: nowSec,
          kind: "vessel",
        });
      }
    } else {
      feature = new Feature({
        geometry: new Point(fromLonLat([vessel.lon, vessel.lat])),
        telemetryType: "vessel",
        id,
        name: vessel.name || `MMSI ${vessel.mmsi}`,
        callsign: vessel.callsign || "",
        shipType: vessel.shipType || "Cargo",
        speed: isMoored ? 0 : rawKnots,
        course,
        heading: vessel.headingDeg ?? course,
        destination: vessel.destination || "",
        status: vessel.status || "Under way",
        isMoored: isMoored ? 1 : 0,
        ageSec: fixAgeSec,
        raw: vessel,
      });

      activeVesselFeatures.set(id, feature);
      vesselsSource.addFeature(feature);

      if (!isReplay && speedMps > 0.1) {
        activeKinematics.set(id, {
          feature,
          lon: vessel.lon,
          lat: vessel.lat,
          renderedLon: vessel.lon,
          renderedLat: vessel.lat,
          speedMps,
          headingDeg: course,
          targetHeadingDeg: course,
          lastUpdated: nowSec,
          kind: "vessel",
        });
      }
    }
  }

  // Remove vanished vessels
  for (const [id, feature] of activeVesselFeatures.entries()) {
    if (!currentIds.has(id)) {
      vesselsSource.removeFeature(feature);
      activeVesselFeatures.delete(id);
      activeKinematics.delete(id);
    }
  }

  syncVesselRouteFeatures(vessels);

  ensureDeadReckoningLoop();
}

/**
 * Rebuilds the estimated voyage-route layer strictly from the current vessel
 * snapshot. Each destination that resolves against the port gazetteer gets a
 * dashed great-circle arc from the fix to the port plus an open-ring
 * destination marker; unresolved destination strings draw nothing.
 */
function syncVesselRouteFeatures(vessels: VesselTarget[]) {
  if (!vesselRoutesSource) return;

  const routeIds = new Set<string>();

  for (const vessel of vessels) {
    if (
      vessel.lon == null ||
      vessel.lat == null ||
      isNaN(vessel.lon) ||
      isNaN(vessel.lat)
    ) {
      continue;
    }

    const id = String(vessel.mmsi);
    const route = computeVoyageRoute(vessel.lon, vessel.lat, vessel.destination, vessel.speedKnots);
    if (!route) continue;
    routeIds.add(id);

    const emphasized = id === emphasizedRouteHoverId || id === emphasizedRouteSelectedId;
    const stats = formatRouteStats(route.distanceNm, route.etaDays, vessel.speedKnots);
    const lineCoords = route.segments.map((segment) =>
      segment.map(([lon, lat]) => fromLonLat([lon, lat])),
    );
    const portCoord = fromLonLat([route.portLon, route.portLat]);

    let pair = activeVesselRouteFeatures.get(id);
    if (pair) {
      (pair.line.getGeometry() as MultiLineString).setCoordinates(lineCoords);
      (pair.port.getGeometry() as Point).setCoordinates(portCoord);
      pair.port.set("routeLabel", route.label);
      pair.port.set("routeStats", stats);
      pair.line.set("isEmphasized", emphasized ? 1 : 0);
      pair.port.set("isEmphasized", emphasized ? 1 : 0);
      pair.line.set("raw", vessel);
      pair.port.set("raw", vessel);
      pair.line.set("vesselId", id);
      pair.port.set("vesselId", id);
    } else {
      const line = new Feature({
        geometry: new MultiLineString(lineCoords),
        telemetryType: "vessel-route",
        routeKind: "line",
        id: `route-${id}`,
        vesselId: id,
        raw: vessel,
      });
      const port = new Feature({
        geometry: new Point(portCoord),
        telemetryType: "vessel-route",
        routeKind: "port",
        id: `routeport-${id}`,
        vesselId: id,
        routeLabel: route.label,
        routeStats: stats,
        raw: vessel,
      });
      line.set("isEmphasized", emphasized ? 1 : 0);
      port.set("isEmphasized", emphasized ? 1 : 0);
      pair = { line, port };
      activeVesselRouteFeatures.set(id, pair);
      vesselRoutesSource.addFeature(line);
      vesselRoutesSource.addFeature(port);
    }
  }

  for (const [id, pair] of activeVesselRouteFeatures.entries()) {
    if (!routeIds.has(id)) {
      vesselRoutesSource.removeFeature(pair.line);
      vesselRoutesSource.removeFeature(pair.port);
      activeVesselRouteFeatures.delete(id);
    }
  }
}

/**
 * Mirrors hover / selection emphasis from the vessel point features onto the
 * matching estimate-route line and destination marker. Passing an id that has
 * no route is harmless.
 */
export function setVesselRouteEmphasis(hoverId: string | null, selectedId: string | null) {
  const nextHover = hoverId ?? null;
  const nextSelected = selectedId ?? null;
  if (nextHover === emphasizedRouteHoverId && nextSelected === emphasizedRouteSelectedId) return;

  emphasizedRouteHoverId = nextHover;
  emphasizedRouteSelectedId = nextSelected;

  for (const [id, pair] of activeVesselRouteFeatures.entries()) {
    const emphasized = id === nextHover || id === nextSelected ? 1 : 0;
    if (pair.line.get("isEmphasized") !== emphasized) pair.line.set("isEmphasized", emphasized);
    if (pair.port.get("isEmphasized") !== emphasized) pair.port.set("isEmphasized", emphasized);
  }
}

/**
 * Returns the active OpenLayers feature for a given vessel MMSI id, if present.
 */
export function getVesselFeature(id: string): Feature | undefined {
  return activeVesselFeatures.get(id);
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
    if (vesselRoutesLayer) vesselRoutesLayer.setVisible(visible);
  }
}

/**
 * Clears all telemetry features.
 */
export function clearTelemetryLayers() {
  activeFlightFeatures.clear();
  activeVesselFeatures.clear();
  activeEarthquakeFeatures.clear();
  activeSatelliteFeatures.clear();
  activeFireFeatures.clear();
  activeKinematics.clear();
  flightsSource?.clear();
  earthquakesSource?.clear();
  satellitesSource?.clear();
  firesSource?.clear();
  vesselsSource?.clear();
  tracksSource?.clear();
}
