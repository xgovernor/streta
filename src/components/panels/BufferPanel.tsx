import { useState, useEffect, useMemo } from "react";
import {
  Activity,
  ArrowUpDown,
  BarChart3,
  BookmarkPlus,
  CircleDot,
  Compass,
  Crosshair,
  Download,
  Eraser,
  FileSpreadsheet,
  Layers,
  Loader2,
  MapPin,
  Plane,
  Radar,
  Radio,
  Route,
  Search,
  Ship,
} from "lucide-react";
import {
  clearBufferOverlay,
  flyToCoordinate,
  measureCoordinates,
  renderBufferOverlay,
  setBufferPicker,
  setBufferRadiusDragListener,
  type AdditionalBufferRing,
} from "../../map/mapController";
import { cx } from "../../lib/cx";
import { formatDistance, formatArea } from "../../lib/format";
import {
  createGeodesicLineBuffer,
  createGeodesicPointBuffer,
  createGeodesicSectorBuffer,
  distanceToLineString,
  isBearingInSector,
  spatialBufferQuery,
  type CorridorOptions,
  type SectorBufferParams,
  type SpatialQueryHit,
  type SpatialQueryResult,
} from "../../lib/gis/tiledBackend";
import { uniqueDatasetName } from "../../lib/gis/datasets";
import { uniqueLayerName } from "../../lib/gis/layers";
import { GEOGRAPHIC_CRS } from "../../lib/gis/crs";
import type { FeatureRecord } from "../../lib/gis/types";
import { useProjectStore } from "../../state/projectStore";
import { useTelemetryStore } from "../../state/telemetryStore";
import { useUiStore } from "../../state/uiStore";
import { PanelShell } from "../PanelShell";
import {
  FIELD_INPUT,
  InfoNote,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SectionLabel,
} from "./shared";

type DistanceUnit = "m" | "km" | "NM" | "mi";
type BufferSourceType = "point" | "measurement" | "selection";
type RingMode = "single" | "multi";

const UNIT_MULTIPLIERS: Record<DistanceUnit, number> = {
  m: 1,
  km: 1000,
  NM: 1852,
  mi: 1609.344,
};

const UNIT_PRESETS: Record<DistanceUnit, number[]> = {
  m: [250, 500, 1000, 5000],
  km: [1, 5, 10, 25],
  NM: [1, 3, 5, 12],
  mi: [1, 3, 5, 15],
};

function bearingToDirection(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  const directions = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  const index = Math.round(normalized / 22.5) % 16;
  return directions[index];
}

export function BufferPanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const notify = useUiStore((state) => state.notify);
  const layers = useProjectStore((state) => state.layers);
  const selection = useProjectStore((state) => state.selection);

  // Buffer Geometry Source: "point" | "measurement" (corridor) | "selection"
  const [sourceType, setSourceType] = useState<BufferSourceType>("point");

  // Ring Mode: "single" vs "multi" (tactical concentric range rings)
  const [ringMode, setRingMode] = useState<RingMode>("single");
  const [ringCount, setRingCount] = useState<number>(3);

  // Live Telemetry Interception Toggle
  const [includeTelemetry, setIncludeTelemetry] = useState<boolean>(true);

  // Center & Radius state
  const [bufferCenter, setBufferCenter] = useState<[number, number] | null>(null);
  const [radiusMeters, setRadiusMeters] = useState<number>(5000);
  const [unit, setUnit] = useState<DistanceUnit>("km");
  const [isPickingCenter, setIsPickingCenter] = useState(false);
  const [bufferLoading, setBufferLoading] = useState(false);
  const [bufferResult, setBufferResult] = useState<SpatialQueryResult | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string>("all");

  // Multi-ring definitions generated during query
  const [generatedRings, setGeneratedRings] = useState<AdditionalBufferRing[]>([]);

  // Phase 3: Shape Mode (Omni-Directional Circle vs Radar Wedge Sector)
  const [shapeMode, setShapeMode] = useState<"circle" | "sector">("circle");
  const [startAzimuth, setStartAzimuth] = useState<number>(45);
  const [endAzimuth, setEndAzimuth] = useState<number>(135);
  const [innerRadiusInput, setInnerRadiusInput] = useState<number>(0);

  // Phase 3: Corridor Options (Both sides / Left / Right, Round vs Flat cap)
  const [corridorSide, setCorridorSide] = useState<"both" | "left" | "right">("both");
  const [corridorCap, setCorridorCap] = useState<"round" | "flat">("round");

  // Phase 3: Interactive Rim Drag-Handle on OpenLayers Canvas
  const [enableDragHandle, setEnableDragHandle] = useState<boolean>(true);

  // Phase 4: Intersect Analytics & Hit Filtering
  const [hitSearchQuery, setHitSearchQuery] = useState<string>("");
  const [selectedHitLayer, setSelectedHitLayer] = useState<string>("all");
  const [hitSortOrder, setHitSortOrder] = useState<"distance-asc" | "distance-desc" | "azimuth" | "name">("distance-asc");

  // Current radius in active unit
  const displayRadius = radiusMeters / UNIT_MULTIPLIERS[unit];

  // Derived measurement route info
  const drawnMeasurementCoords = measureCoordinates();
  const hasMeasurementRoute = drawnMeasurementCoords.length >= 2;

  // Derived selected feature geometry
  const selectedFeature = selection
    ? layers.find((l) => l.id === selection.layerId)?.features.find((f) => f.id === selection.featureId)
    : null;

  const handleUnitChange = (newUnit: DistanceUnit) => {
    setUnit(newUnit);
  };

  const handleRadiusInputChange = (value: number) => {
    if (value > 0) {
      const nextMeters = value * UNIT_MULTIPLIERS[unit];
      setRadiusMeters(nextMeters);
      runQueryWithParams(
        sourceType,
        ringMode,
        ringCount,
        nextMeters,
        bufferCenter,
        selectedLayerId,
        shapeMode,
        startAzimuth,
        endAzimuth,
        innerRadiusInput,
        corridorSide,
        corridorCap,
      );
    }
  };

  const handlePresetClick = (presetValue: number) => {
    const nextMeters = presetValue * UNIT_MULTIPLIERS[unit];
    setRadiusMeters(nextMeters);
    runQueryWithParams(
      sourceType,
      ringMode,
      ringCount,
      nextMeters,
      bufferCenter,
      selectedLayerId,
      shapeMode,
      startAzimuth,
      endAzimuth,
      innerRadiusInput,
      corridorSide,
      corridorCap,
    );
  };

  const toggleCenterPicker = () => {
    if (isPickingCenter) {
      setBufferPicker(null);
      setIsPickingCenter(false);
    } else {
      setIsPickingCenter(true);
      notify("Click anywhere on the map to set buffer center");
      setBufferPicker((coord) => {
        setBufferCenter(coord);
        setIsPickingCenter(false);
        setBufferPicker(null);
        runQueryWithParams(
          sourceType,
          ringMode,
          ringCount,
          radiusMeters,
          coord,
          selectedLayerId,
          shapeMode,
          startAzimuth,
          endAzimuth,
          innerRadiusInput,
          corridorSide,
          corridorCap,
        );
      });
    }
  };

  const setSectorAngles = (start: number, end: number) => {
    setStartAzimuth(start);
    setEndAzimuth(end);
    runQueryWithParams(
      sourceType,
      ringMode,
      ringCount,
      radiusMeters,
      bufferCenter,
      selectedLayerId,
      "sector",
      start,
      end,
      innerRadiusInput,
      corridorSide,
      corridorCap,
    );
  };

  useEffect(() => {
    if (!enableDragHandle || !bufferCenter) {
      setBufferRadiusDragListener(null);
      return;
    }

    setBufferRadiusDragListener((newRadiusMeters: number, isFinal: boolean) => {
      setRadiusMeters(newRadiusMeters);

      if (isFinal) {
        runQueryWithParams(
          sourceType,
          ringMode,
          ringCount,
          newRadiusMeters,
          bufferCenter,
          selectedLayerId,
          shapeMode,
          startAzimuth,
          endAzimuth,
          innerRadiusInput,
          corridorSide,
          corridorCap,
        );
      }
    });

    return () => {
      setBufferRadiusDragListener(null);
    };
  }, [
    enableDragHandle,
    bufferCenter,
    sourceType,
    ringMode,
    ringCount,
    selectedLayerId,
    shapeMode,
    startAzimuth,
    endAzimuth,
    innerRadiusInput,
    corridorSide,
    corridorCap,
    unit,
  ]);

  const runQueryWithParams = async (
    currentSource: BufferSourceType,
    currentRingMode: RingMode,
    currentRings: number,
    baseDistMeters: number,
    center: [number, number] | null,
    targetLayer: string,
    currentShapeMode: "circle" | "sector" = shapeMode,
    currentStartAz: number = startAzimuth,
    currentEndAz: number = endAzimuth,
    currentInnerRadius: number = innerRadiusInput,
    currentCorridorSide: "both" | "left" | "right" = corridorSide,
    currentCorridorCap: "round" | "flat" = corridorCap,
    currentEnableDragHandle: boolean = enableDragHandle,
  ) => {
    // 1. Resolve geometry spine
    let spine: [number, number][] | undefined = undefined;
    let queryCenter = center;

    if (currentSource === "measurement") {
      const coords = measureCoordinates();
      if (coords.length < 2) {
        notify("Draw at least 2 points on the map first with the measurement tool");
        return;
      }
      spine = coords;
      queryCenter = coords[0];
    } else if (currentSource === "selection") {
      if (!selectedFeature) {
        notify("Select a feature on the map or dataset table first");
        return;
      }
      const geom = selectedFeature.geometry;
      if (geom.type === "LineString") {
        spine = geom.coordinates as [number, number][];
        queryCenter = spine[0];
      } else if (geom.type === "Polygon") {
        const rings = geom.coordinates as [number, number][][];
        spine = rings[0];
        queryCenter = spine[0];
      } else if (geom.type === "Point") {
        queryCenter = geom.coordinates as [number, number];
        setBufferCenter(queryCenter);
      }
    }

    if (!queryCenter && !spine) {
      return;
    }

    const effectiveCenter = queryCenter || [0, 0];
    setBufferLoading(true);

    try {
      // 2. Compute radii thresholds for multi-rings
      const isMulti = currentRingMode === "multi";
      const totalRings = isMulti ? Math.max(2, Math.min(5, currentRings)) : 1;
      const ringRadii: number[] = [];
      for (let i = 1; i <= totalRings; i++) {
        ringRadii.push(i * baseDistMeters);
      }
      const maxSearchDistance = ringRadii[ringRadii.length - 1];

      const isSector = currentSource === "point" && currentShapeMode === "sector";
      const innerRadiusMeters = isSector ? currentInnerRadius * UNIT_MULTIPLIERS[unit] : 0;
      const sectorParams: SectorBufferParams | undefined = isSector
        ? {
            startAzimuthDeg: currentStartAz,
            endAzimuthDeg: currentEndAz,
            innerRadiusMeters,
          }
        : undefined;

      const corridorOptions: CorridorOptions | undefined = spine
        ? {
            sideType: currentCorridorSide,
            capStyle: currentCorridorCap,
          }
        : undefined;

      const layerIds = targetLayer === "all" ? undefined : [targetLayer];
      const baseResult = await spatialBufferQuery(
        effectiveCenter[0],
        effectiveCenter[1],
        maxSearchDistance,
        layerIds,
        150,
        layers,
        spine,
        isMulti ? ringRadii : undefined,
        sectorParams,
        corridorOptions,
      );

      if (!baseResult) {
        notify("Buffer query returned no results");
        return;
      }

      // 3. Scan live telemetry targets if enabled
      let allHits = [...baseResult.hits];
      if (includeTelemetry) {
        const telStore = useTelemetryStore.getState();
        const telemetryHits: SpatialQueryHit[] = [];

        // Active Flights
        const activeFlights = telStore.displayedFlights ?? telStore.flights;
        for (const flight of activeFlights) {
          if (!flight.longitude || !flight.latitude) continue;
          let distM = Infinity;
          let bearing = 0;

          if (spine && spine.length >= 2) {
            const res = distanceToLineString([flight.longitude, flight.latitude], spine, currentCorridorSide);
            distM = res.minDistanceM;
            bearing = res.bearingDeg;
          } else {
            const m = (baseResult as any).center_lon != null
              ? (function() {
                  const toRad = (d: number) => (d * Math.PI) / 180;
                  const R = 6371008.8;
                  const dLat = toRad(flight.latitude - effectiveCenter[1]);
                  const dLon = toRad(flight.longitude - effectiveCenter[0]);
                  const a =
                    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(toRad(effectiveCenter[1])) * Math.cos(toRad(flight.latitude)) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                  const d = R * c;
                  const y = Math.sin(dLon) * Math.cos(toRad(flight.latitude));
                  const x =
                    Math.cos(toRad(effectiveCenter[1])) * Math.sin(toRad(flight.latitude)) -
                    Math.sin(toRad(effectiveCenter[1])) * Math.cos(toRad(flight.latitude)) * Math.cos(dLon);
                  const b = ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360;
                  return { d, b };
                })()
              : { d: Infinity, b: 0 };
            distM = m.d;
            bearing = m.b;
          }

          const inRange = isSector
            ? distM >= innerRadiusMeters && distM <= maxSearchDistance && isBearingInSector(bearing, currentStartAz, currentEndAz)
            : distM <= maxSearchDistance;

          if (inRange) {
            let ringBand: number | undefined;
            if (isMulti) {
              for (let b = 0; b < ringRadii.length; b++) {
                if (distM <= ringRadii[b]) {
                  ringBand = b + 1;
                  break;
                }
              }
            }

            telemetryHits.push({
              layer_id: "telemetry:flights",
              feature_id: flight.callsign || flight.icao24,
              distance_m: Math.round(distM * 10) / 10,
              bearing_deg: Math.round(bearing * 10) / 10,
              geometry_type: "Point",
              properties: {
                callsign: flight.callsign || flight.icao24,
                icao24: flight.icao24,
                country: flight.originCountry,
                altitude_m: flight.altitudeMeters,
                velocity_mps: flight.velocityMps,
                heading_deg: flight.headingDeg,
                longitude: flight.longitude,
                latitude: flight.latitude,
              },
              target_lon: flight.longitude,
              target_lat: flight.latitude,
              ring_band: ringBand,
              is_telemetry: true,
              telemetry_type: "flight",
            });
          }
        }

        // Active Vessels
        const activeVessels = telStore.displayedVessels ?? telStore.vessels;
        for (const vessel of activeVessels) {
          if (!vessel.lon || !vessel.lat) continue;
          let distM = Infinity;
          let bearing = 0;

          if (spine && spine.length >= 2) {
            const res = distanceToLineString([vessel.lon, vessel.lat], spine, currentCorridorSide);
            distM = res.minDistanceM;
            bearing = res.bearingDeg;
          } else {
            const toRad = (d: number) => (d * Math.PI) / 180;
            const R = 6371008.8;
            const dLat = toRad(vessel.lat - effectiveCenter[1]);
            const dLon = toRad(vessel.lon - effectiveCenter[0]);
            const a =
              Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(effectiveCenter[1])) * Math.cos(toRad(vessel.lat)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            distM = R * c;
            const y = Math.sin(dLon) * Math.cos(toRad(vessel.lat));
            const x =
              Math.cos(toRad(effectiveCenter[1])) * Math.sin(toRad(vessel.lat)) -
              Math.sin(toRad(effectiveCenter[1])) * Math.cos(toRad(vessel.lat)) * Math.cos(dLon);
            bearing = ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360;
          }

          const inRange = isSector
            ? distM >= innerRadiusMeters && distM <= maxSearchDistance && isBearingInSector(bearing, currentStartAz, currentEndAz)
            : distM <= maxSearchDistance;

          if (inRange) {
            let ringBand: number | undefined;
            if (isMulti) {
              for (let b = 0; b < ringRadii.length; b++) {
                if (distM <= ringRadii[b]) {
                  ringBand = b + 1;
                  break;
                }
              }
            }

            telemetryHits.push({
              layer_id: "telemetry:vessels",
              feature_id: vessel.name || String(vessel.mmsi),
              distance_m: Math.round(distM * 10) / 10,
              bearing_deg: Math.round(bearing * 10) / 10,
              geometry_type: "Point",
              properties: {
                name: vessel.name,
                mmsi: vessel.mmsi,
                callsign: vessel.callsign,
                ship_type: vessel.shipType,
                speed_knots: vessel.speedKnots,
                destination: vessel.destination,
                longitude: vessel.lon,
                latitude: vessel.lat,
              },
              target_lon: vessel.lon,
              target_lat: vessel.lat,
              ring_band: ringBand,
              is_telemetry: true,
              telemetry_type: "vessel",
            });
          }
        }

        // Active Earthquakes
        const activeQuakes = telStore.displayedEarthquakes ?? telStore.earthquakes;
        for (const quake of activeQuakes) {
          if (!quake.longitude || !quake.latitude) continue;
          let distM = Infinity;
          let bearing = 0;

          if (spine && spine.length >= 2) {
            const res = distanceToLineString([quake.longitude, quake.latitude], spine, currentCorridorSide);
            distM = res.minDistanceM;
            bearing = res.bearingDeg;
          } else {
            const toRad = (d: number) => (d * Math.PI) / 180;
            const R = 6371008.8;
            const dLat = toRad(quake.latitude - effectiveCenter[1]);
            const dLon = toRad(quake.longitude - effectiveCenter[0]);
            const a =
              Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(effectiveCenter[1])) * Math.cos(toRad(quake.latitude)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            distM = R * c;
            const y = Math.sin(dLon) * Math.cos(toRad(quake.latitude));
            const x =
              Math.cos(toRad(effectiveCenter[1])) * Math.sin(toRad(quake.latitude)) -
              Math.sin(toRad(effectiveCenter[1])) * Math.cos(toRad(quake.latitude)) * Math.cos(dLon);
            bearing = ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360;
          }

          const inRange = isSector
            ? distM >= innerRadiusMeters && distM <= maxSearchDistance && isBearingInSector(bearing, currentStartAz, currentEndAz)
            : distM <= maxSearchDistance;

          if (inRange) {
            let ringBand: number | undefined;
            if (isMulti) {
              for (let b = 0; b < ringRadii.length; b++) {
                if (distM <= ringRadii[b]) {
                  ringBand = b + 1;
                  break;
                }
              }
            }

            telemetryHits.push({
              layer_id: "telemetry:earthquakes",
              feature_id: `M${quake.magnitude.toFixed(1)} ${quake.place}`,
              distance_m: Math.round(distM * 10) / 10,
              bearing_deg: Math.round(bearing * 10) / 10,
              geometry_type: "Point",
              properties: {
                magnitude: quake.magnitude,
                place: quake.place,
                depth_km: quake.depthKm,
                longitude: quake.longitude,
                latitude: quake.latitude,
              },
              target_lon: quake.longitude,
              target_lat: quake.latitude,
              ring_band: ringBand,
              is_telemetry: true,
              telemetry_type: "earthquake",
            });
          }
        }

        allHits = [...allHits, ...telemetryHits];
        allHits.sort((a, b) => a.distance_m - b.distance_m);
      }

      // 4. Generate multi-ring polygon overlays
      const rings: AdditionalBufferRing[] = [];
      if (isMulti) {
        for (let i = 0; i < ringRadii.length; i++) {
          const r = ringRadii[i];
          const ringGeo = spine && spine.length >= 2
            ? createGeodesicLineBuffer(spine, r, corridorOptions)
            : isSector
            ? createGeodesicSectorBuffer(
                effectiveCenter[0],
                effectiveCenter[1],
                r,
                currentStartAz,
                currentEndAz,
                i === 0 ? innerRadiusMeters : ringRadii[i - 1],
                64,
              )
            : createGeodesicPointBuffer(effectiveCenter[0], effectiveCenter[1], r, 64);

          const rLabel = r >= 1000 ? `${(r / 1000).toFixed(1)} km` : `${Math.round(r)} m`;
          rings.push({
            geojson: ringGeo,
            radiusMeters: r,
            label: `R${i + 1} = ${rLabel}`,
            ringIndex: i + 1,
          });
        }
      }

      setGeneratedRings(rings);

      const consolidatedResult: SpatialQueryResult = {
        ...baseResult,
        center_lon: effectiveCenter[0],
        center_lat: effectiveCenter[1],
        radius_meters: maxSearchDistance,
        total_hits: allHits.length,
        hits: allHits,
      };

      setBufferResult(consolidatedResult);

      // Render overlay on OpenLayers
      let handleAzimuth = 90;
      if (isSector) {
        const sweep =
          Math.abs(currentEndAz - currentStartAz) < 1e-4
            ? 360
            : currentEndAz > currentStartAz
            ? currentEndAz - currentStartAz
            : currentEndAz - currentStartAz + 360;
        handleAzimuth = (currentStartAz + sweep / 2) % 360;
      }

      if (isMulti && rings.length > 0) {
        renderBufferOverlay(
          rings[rings.length - 1].geojson,
          spine ? undefined : effectiveCenter,
          maxSearchDistance,
          rings,
          spine,
          currentEnableDragHandle && !spine,
          handleAzimuth,
        );
      } else {
        renderBufferOverlay(
          baseResult.buffer_geojson,
          spine ? undefined : effectiveCenter,
          baseDistMeters,
          undefined,
          spine,
          currentEnableDragHandle && !spine,
          handleAzimuth,
        );
      }

      const distLabel =
        maxSearchDistance >= 1000
          ? `${(maxSearchDistance / 1000).toFixed(1)} km`
          : `${Math.round(maxSearchDistance)} m`;

      notify(
        `Found ${allHits.length} features within ${distLabel}${
          isMulti ? ` across ${totalRings} concentric bands` : ""
        }`,
      );
    } catch (err) {
      notify(`Buffer query error: ${err}`);
    } finally {
      setBufferLoading(false);
    }
  };

  // Phase 4: Analytical metrics and breakdown
  const layerDistribution = useMemo(() => {
    if (!bufferResult || bufferResult.hits.length === 0) return [];
    const counts: Record<string, { label: string; count: number; color: string; key: string }> = {};

    bufferResult.hits.forEach((h) => {
      let key = h.layer_id;
      let label = h.layer_id;
      let color = "#06b6d4";

      if (h.is_telemetry) {
        key = `telemetry:${h.telemetry_type}`;
        if (h.telemetry_type === "flight") {
          label = "ADS-B Flights";
          color = "#fbbf24";
        } else if (h.telemetry_type === "vessel") {
          label = "AIS Vessels";
          color = "#22d3ee";
        } else if (h.telemetry_type === "earthquake") {
          label = "USGS Quakes";
          color = "#f43f5e";
        }
      } else {
        const layer = layers.find((l) => l.id === h.layer_id);
        if (layer) {
          label = layer.name;
          color = layer.style?.color || "#06b6d4";
        }
      }

      if (!counts[key]) {
        counts[key] = { label, count: 0, color, key };
      }
      counts[key].count += 1;
    });

    return Object.values(counts).sort((a, b) => b.count - a.count);
  }, [bufferResult, layers]);

  const nearestHit = useMemo(() => {
    if (!bufferResult || bufferResult.hits.length === 0) return null;
    return [...bufferResult.hits].sort((a, b) => a.distance_m - b.distance_m)[0];
  }, [bufferResult]);

  const furthestHit = useMemo(() => {
    if (!bufferResult || bufferResult.hits.length === 0) return null;
    return [...bufferResult.hits].sort((a, b) => b.distance_m - a.distance_m)[0];
  }, [bufferResult]);

  const filteredAndSortedHits = useMemo(() => {
    if (!bufferResult) return [];
    let list = [...bufferResult.hits];

    if (selectedHitLayer !== "all") {
      list = list.filter((h) => {
        if (selectedHitLayer.startsWith("telemetry:")) {
          const telType = selectedHitLayer.replace("telemetry:", "");
          return h.is_telemetry && h.telemetry_type === telType;
        }
        return h.layer_id === selectedHitLayer;
      });
    }

    if (hitSearchQuery.trim()) {
      const q = hitSearchQuery.toLowerCase().trim();
      list = list.filter((h) => {
        const name = (
          (h.properties?.name as string) ||
          (h.properties?.callsign as string) ||
          (h.properties?.title as string) ||
          (h.properties?.place as string) ||
          (h.properties?.id as string) ||
          h.feature_id ||
          ""
        ).toLowerCase();
        return name.includes(q) || h.layer_id.toLowerCase().includes(q);
      });
    }

    list.sort((a, b) => {
      if (hitSortOrder === "distance-desc") return b.distance_m - a.distance_m;
      if (hitSortOrder === "azimuth") return a.bearing_deg - b.bearing_deg;
      if (hitSortOrder === "name") {
        const nameA = (a.properties?.name || a.properties?.callsign || a.feature_id || "") as string;
        const nameB = (b.properties?.name || b.properties?.callsign || b.feature_id || "") as string;
        return nameA.localeCompare(nameB);
      }
      return a.distance_m - b.distance_m;
    });

    return list;
  }, [bufferResult, selectedHitLayer, hitSearchQuery, hitSortOrder]);

  const handleSaveAsLayer = () => {
    if (!bufferResult || !bufferResult.buffer_geojson) {
      notify("No buffer result to save");
      return;
    }

    const projectStore = useProjectStore.getState();
    const existingDatasetNames = projectStore.datasets.map((d) => d.name);
    const distLabel =
      radiusMeters >= 1000
        ? `${(radiusMeters / 1000).toFixed(1)} km`
        : `${Math.round(radiusMeters)} m`;

    const title =
      sourceType === "measurement"
        ? `Corridor Buffer ${distLabel}`
        : ringMode === "multi"
        ? `Multi-Ring ${ringCount}x (${distLabel})`
        : `Buffer ${distLabel}`;

    const datasetName = uniqueDatasetName(existingDatasetNames, title);

    const features: FeatureRecord[] = [];

    if (ringMode === "multi" && generatedRings.length > 0) {
      generatedRings.forEach((ring, idx) => {
        features.push({
          id: `ring_${idx + 1}_${Date.now()}`,
          geometry: ring.geojson.geometry,
          properties: {
            name: `Concentric Band ${idx + 1} (${(ring.radiusMeters / 1000).toFixed(1)} km)`,
            ring_number: idx + 1,
            radius_meters: ring.radiusMeters,
            total_hits: bufferResult.hits.filter((h) => h.ring_band === idx + 1).length,
            created_at: new Date().toISOString(),
          },
        });
      });
    } else {
      features.push({
        id: `buffer_${Date.now()}`,
        geometry: bufferResult.buffer_geojson.geometry,
        properties: {
          name: title,
          center_lon: bufferResult.center_lon,
          center_lat: bufferResult.center_lat,
          radius_meters: bufferResult.radius_meters,
          total_hits: bufferResult.total_hits,
          area_sq_meters: bufferResult.area_sq_meters ?? null,
          area_sq_km: bufferResult.area_sq_km ?? null,
          area_acres: bufferResult.area_acres ?? null,
          density_per_sq_km: bufferResult.area_sq_km
            ? Number((bufferResult.total_hits / bufferResult.area_sq_km).toFixed(2))
            : 0,
          is_corridor: sourceType === "measurement",
          created_at: new Date().toISOString(),
        },
      });
    }

    const existingLayerNames = projectStore.layers.map((l) => l.name);
    const layerName = uniqueLayerName(existingLayerNames, title);

    projectStore.addDataset({
      name: datasetName,
      kind: "file",
      source: "derived:buffer",
      layers: [
        {
          id: `buffer_${Date.now().toString(36)}`,
          name: layerName,
          features,
          crs: GEOGRAPHIC_CRS,
          format: "geojson",
          source: "derived:buffer",
          style: {
            color: "#06b6d4",
            fillOpacity: 0.14,
            strokeWidth: 2,
            pointRadius: 4,
            labelField: null,
          },
        },
      ],
    });
    notify(`Saved buffer zone as layer: "${layerName}"`);
  };

  const handleSaveHitsAsLayer = () => {
    if (!bufferResult || bufferResult.hits.length === 0) {
      notify("No intercepted hits to save");
      return;
    }

    const projectStore = useProjectStore.getState();
    const existingDatasetNames = projectStore.datasets.map((d) => d.name);
    const title = `Buffer Targets (${bufferResult.hits.length} hits)`;
    const datasetName = uniqueDatasetName(existingDatasetNames, title);

    const features: FeatureRecord[] = bufferResult.hits.map((h, i) => {
      const lon = Number(h.target_lon ?? h.properties?.longitude ?? h.properties?.lon ?? bufferResult.center_lon);
      const lat = Number(h.target_lat ?? h.properties?.latitude ?? h.properties?.lat ?? bufferResult.center_lat);
      return {
        id: `hit_pt_${i + 1}_${Date.now()}`,
        geometry: {
          type: "Point",
          coordinates: [lon, lat],
        },
        properties: {
          ...h.properties,
          buffer_rank: i + 1,
          buffer_distance_m: h.distance_m,
          buffer_distance_label: formatDistance(h.distance_m),
          buffer_bearing_deg: h.bearing_deg,
          buffer_direction: bearingToDirection(h.bearing_deg),
          ring_band: h.ring_band ?? null,
          source_layer: h.layer_id,
          is_telemetry: h.is_telemetry || false,
        },
      };
    });

    const existingLayerNames = projectStore.layers.map((l) => l.name);
    const layerName = uniqueLayerName(existingLayerNames, title);

    projectStore.addDataset({
      name: datasetName,
      kind: "file",
      source: "derived:buffer-hits",
      layers: [
        {
          id: `hits_${Date.now().toString(36)}`,
          name: layerName,
          features,
          crs: GEOGRAPHIC_CRS,
          format: "geojson",
          source: "derived:buffer-hits",
          style: {
            color: "#f59e0b",
            fillOpacity: 0.9,
            strokeWidth: 2,
            pointRadius: 5,
            labelField: null,
          },
        },
      ],
    });
    notify(`Saved ${features.length} intercepted targets as layer: "${layerName}"`);
  };

  const handleExportCsv = async () => {
    if (!bufferResult || bufferResult.hits.length === 0) {
      notify("No intercepted hits to export");
      return;
    }

    const headers = [
      "rank",
      "feature_id",
      "layer_id",
      "band",
      "distance_meters",
      "distance_formatted",
      "bearing_degrees",
      "direction",
      "geometry_type",
      "longitude",
      "latitude",
      "is_telemetry",
    ];

    const rows = bufferResult.hits.map((h, i) => {
      const lon = h.target_lon ?? (h.properties?.lon as number) ?? (h.properties?.longitude as number) ?? "";
      const lat = h.target_lat ?? (h.properties?.lat as number) ?? (h.properties?.latitude as number) ?? "";
      return [
        i + 1,
        `"${h.feature_id || ""}"`,
        `"${h.layer_id}"`,
        h.ring_band ? `Band ${h.ring_band}` : "N/A",
        h.distance_m,
        `"${formatDistance(h.distance_m)}"`,
        h.bearing_deg,
        `"${bearingToDirection(h.bearing_deg)}"`,
        `"${h.geometry_type}"`,
        lon,
        lat,
        h.is_telemetry ? "TRUE" : "FALSE",
      ].join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proximity_buffer_hits_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify(`Exported ${bufferResult.hits.length} hits to CSV`);
  };

  const handleExportGeoJson = () => {
    if (!bufferResult || !bufferResult.buffer_geojson) {
      notify("No buffer result to export");
      return;
    }

    const ringsFeatures =
      generatedRings.length > 0
        ? generatedRings.map((r) => r.geojson)
        : [bufferResult.buffer_geojson];

    const hitFeatures = bufferResult.hits.map((h, idx) => ({
      type: "Feature",
      id: h.feature_id || `hit_${idx + 1}`,
      geometry: {
        type: h.geometry_type,
        coordinates: [
          h.target_lon ?? bufferResult.center_lon,
          h.target_lat ?? bufferResult.center_lat,
        ],
      },
      properties: {
        ...h.properties,
        proximity_distance_m: h.distance_m,
        proximity_bearing_deg: h.bearing_deg,
        proximity_direction: bearingToDirection(h.bearing_deg),
        proximity_layer: h.layer_id,
        ring_band: h.ring_band,
        is_telemetry: h.is_telemetry || false,
      },
    }));

    const geojson = {
      type: "FeatureCollection",
      features: [...ringsFeatures, ...hitFeatures],
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], {
      type: "application/geo+json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proximity_buffer_export_${Date.now()}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    notify("Exported buffer & hits to GeoJSON");
  };

  const clearBuffer = () => {
    clearBufferOverlay();
    setBufferResult(null);
    setBufferCenter(null);
    setGeneratedRings([]);
    if (isPickingCenter) {
      setBufferPicker(null);
      setIsPickingCenter(false);
    }
    notify("Buffer query cleared");
  };

  // Surface area calculation: A = pi * r^2
  const areaSqKm = (Math.PI * Math.pow(radiusMeters / 1000, 2)).toFixed(1);

  return (
    <PanelShell
      eyebrow="Spatial Analysis"
      title="Proximity Buffer"
      side="right"
      onClose={() => {
        if (isPickingCenter) {
          setBufferPicker(null);
          setIsPickingCenter(false);
        }
        closePanel("right");
      }}
      footer={
        <>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-accent" />
            WGS 84 Geodesic
          </span>
          <span>
            {sourceType === "measurement"
              ? "Corridor Envelope"
              : ringMode === "multi"
              ? `${ringCount}-Ring Range Rings`
              : "64-vertex Polygon"}
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Source Mode Selector: Point vs Corridor (Measurement) vs Selection */}
        <div className="flex flex-col gap-1">
          <SectionLabel>Buffer Geometry Source</SectionLabel>
          <div className="grid grid-cols-3 gap-1">
            <button
              type="button"
              className={cx(
                "flex items-center justify-center gap-1 py-1 rounded-[2px] text-[10px] font-medium border transition-colors",
                sourceType === "point"
                  ? "border-line-strong bg-accent text-on-accent font-semibold"
                  : "border-line bg-solid text-ink-muted hover:text-ink",
              )}
              onClick={() => {
                setSourceType("point");
                if (bufferCenter) {
                  runQueryWithParams("point", ringMode, ringCount, radiusMeters, bufferCenter, selectedLayerId);
                }
              }}
            >
              <MapPin size={11} />
              Point
            </button>
            <button
              type="button"
              className={cx(
                "flex items-center justify-center gap-1 py-1 rounded-[2px] text-[10px] font-medium border transition-colors",
                sourceType === "measurement"
                  ? "border-line-strong bg-accent text-on-accent font-semibold"
                  : "border-line bg-solid text-ink-muted hover:text-ink",
              )}
              onClick={() => {
                setSourceType("measurement");
                if (hasMeasurementRoute) {
                  runQueryWithParams("measurement", ringMode, ringCount, radiusMeters, null, selectedLayerId);
                } else {
                  notify("Draw a path with the measurement tool on the map first");
                }
              }}
            >
              <Route size={11} />
              Corridor
            </button>
            <button
              type="button"
              className={cx(
                "flex items-center justify-center gap-1 py-1 rounded-[2px] text-[10px] font-medium border transition-colors",
                sourceType === "selection"
                  ? "border-line-strong bg-accent text-on-accent font-semibold"
                  : "border-line bg-solid text-ink-muted hover:text-ink",
              )}
              onClick={() => {
                setSourceType("selection");
                if (selectedFeature) {
                  runQueryWithParams("selection", ringMode, ringCount, radiusMeters, null, selectedLayerId);
                } else {
                  notify("Select a feature on the canvas first");
                }
              }}
            >
              <Layers size={11} />
              Feature
            </button>
          </div>
        </div>

        {/* Source Geometry Config Card */}
        {sourceType === "point" && (
          <div className="flex flex-col gap-2 rounded-[2px] border border-line bg-tint p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] text-ink-muted">Center Point</span>
              <button
                type="button"
                className={cx(
                  "inline-flex h-[22px] items-center gap-1 rounded-[2px] px-2 text-[10px] font-medium transition-colors",
                  isPickingCenter
                    ? "bg-accent text-on-accent font-semibold animate-pulse"
                    : "bg-solid text-ink hover:text-ink-soft border border-line",
                )}
                onClick={toggleCenterPicker}
              >
                <Crosshair size={11} />
                {isPickingCenter ? "Click Map..." : "Pick on Map"}
              </button>
            </div>
            <div className="font-mono text-[11px] text-ink">
              {bufferCenter ? (
                <span className="flex items-center gap-1 text-ink">
                  <MapPin size={12} />
                  {bufferCenter[1].toFixed(5)}°N, {bufferCenter[0].toFixed(5)}°E
                </span>
              ) : (
                <span className="text-ink-muted">No center chosen yet</span>
              )}
            </div>

            {/* Shape Geometry Selector: Circle vs Sector */}
            <div className="mt-1 pt-2 border-t border-line flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-ink-muted font-medium">Aperture Geometry:</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={cx(
                      "px-2 py-0.5 text-[9.5px] rounded-[2px] border font-medium transition-colors",
                      shapeMode === "circle"
                        ? "bg-accent text-on-accent font-semibold border-accent"
                        : "bg-solid text-ink-muted hover:text-ink border-line",
                    )}
                    onClick={() => {
                      setShapeMode("circle");
                      if (bufferCenter) {
                        runQueryWithParams(
                          "point",
                          ringMode,
                          ringCount,
                          radiusMeters,
                          bufferCenter,
                          selectedLayerId,
                          "circle",
                        );
                      }
                    }}
                  >
                    Omni (360°)
                  </button>
                  <button
                    type="button"
                    className={cx(
                      "px-2 py-0.5 text-[9.5px] rounded-[2px] border font-medium transition-colors flex items-center gap-1",
                      shapeMode === "sector"
                        ? "bg-accent text-on-accent font-semibold border-accent"
                        : "bg-solid text-ink-muted hover:text-ink border-line",
                    )}
                    onClick={() => {
                      setShapeMode("sector");
                      if (bufferCenter) {
                        runQueryWithParams(
                          "point",
                          ringMode,
                          ringCount,
                          radiusMeters,
                          bufferCenter,
                          selectedLayerId,
                          "sector",
                          startAzimuth,
                          endAzimuth,
                          innerRadiusInput,
                        );
                      }
                    }}
                  >
                    <Radar size={10} />
                    Radar Wedge
                  </button>
                </div>
              </div>

              {shapeMode === "sector" && (
                <div className="flex flex-col gap-2 pt-1">
                  {/* Aperture readout */}
                  <div className="flex items-center justify-between text-[10px] text-ink-muted">
                    <span className="flex items-center gap-1">
                      <Compass size={11} className="text-accent" />
                      Span: {startAzimuth}° → {endAzimuth}°
                    </span>
                    <span className="font-mono text-accent font-medium">
                      FOV: {((endAzimuth - startAzimuth + 360) % 360 || 360)}°
                    </span>
                  </div>

                  {/* Sliders for start/end azimuth */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9.5px] text-ink-muted">Start Azimuth</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="range"
                          min="0"
                          max="360"
                          value={startAzimuth}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setStartAzimuth(val);
                            runQueryWithParams(
                              sourceType,
                              ringMode,
                              ringCount,
                              radiusMeters,
                              bufferCenter,
                              selectedLayerId,
                              "sector",
                              val,
                              endAzimuth,
                              innerRadiusInput,
                            );
                          }}
                          className="w-full accent-accent cursor-pointer"
                        />
                        <span className="text-[10px] font-mono w-7 text-right">{startAzimuth}°</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9.5px] text-ink-muted">End Azimuth</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="range"
                          min="0"
                          max="360"
                          value={endAzimuth}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setEndAzimuth(val);
                            runQueryWithParams(
                              sourceType,
                              ringMode,
                              ringCount,
                              radiusMeters,
                              bufferCenter,
                              selectedLayerId,
                              "sector",
                              startAzimuth,
                              val,
                              innerRadiusInput,
                            );
                          }}
                          className="w-full accent-accent cursor-pointer"
                        />
                        <span className="text-[10px] font-mono w-7 text-right">{endAzimuth}°</span>
                      </div>
                    </div>
                  </div>

                  {/* Quick Sector Presets */}
                  <div className="flex flex-wrap gap-1">
                    {[
                      { label: "N (315°–045°)", s: 315, e: 45 },
                      { label: "E (045°–135°)", s: 45, e: 135 },
                      { label: "S (135°–225°)", s: 135, e: 225 },
                      { label: "W (225°–315°)", s: 225, e: 315 },
                      { label: "60° Fan", s: 60, e: 120 },
                      { label: "90° Fan", s: 45, e: 135 },
                    ].map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        className={cx(
                          "px-1.5 py-0.5 text-[9px] rounded-[2px] border font-mono transition-colors",
                          startAzimuth === p.s && endAzimuth === p.e
                            ? "bg-accent text-on-accent font-semibold border-accent"
                            : "bg-solid text-ink-muted hover:text-ink border-line",
                        )}
                        onClick={() => setSectorAngles(p.s, p.e)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {/* Dead zone / inner radius input */}
                  <div className="flex items-center justify-between pt-1 border-t border-line/60">
                    <span className="text-[10px] text-ink-muted">Inner Blind Zone:</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        step={unit === "m" ? "50" : "0.5"}
                        value={innerRadiusInput}
                        onChange={(e) => {
                          const val = Math.max(0, Number(e.target.value));
                          setInnerRadiusInput(val);
                          runQueryWithParams(
                            sourceType,
                            ringMode,
                            ringCount,
                            radiusMeters,
                            bufferCenter,
                            selectedLayerId,
                            "sector",
                            startAzimuth,
                            endAzimuth,
                            val,
                          );
                        }}
                        className="w-16 px-1.5 py-0.5 text-[10px] font-mono bg-solid border border-line rounded-[2px] text-right"
                      />
                      <span className="text-[10px] font-mono text-ink-muted">{unit}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {sourceType === "measurement" && (
          <div className="flex flex-col gap-1.5 rounded-[2px] border border-line bg-tint p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] text-ink-muted">Active Measurement Path</span>
              <span className="font-mono text-[10px] text-accent">
                {drawnMeasurementCoords.length} vertices
              </span>
            </div>
            <div className="text-[10.5px] text-ink font-mono">
              {hasMeasurementRoute ? (
                <span className="text-accent font-medium flex items-center gap-1">
                  <Route size={12} />
                  Ready to buffer line corridor
                </span>
              ) : (
                <span className="text-ink-muted">
                  Draw a line or route on map using Measure tool (press &apos;m&apos;)
                </span>
              )}
            </div>
          </div>
        )}

        {sourceType === "selection" && (
          <div className="flex flex-col gap-1.5 rounded-[2px] border border-line bg-tint p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] text-ink-muted">Selected Feature</span>
              <span className="font-mono text-[10px] text-ink-muted">
                {selectedFeature ? selectedFeature.geometry.type : "None"}
              </span>
            </div>
            <div className="text-[10.5px] text-ink truncate">
              {selectedFeature ? (
                <span className="font-medium">
                  {(selectedFeature.properties?.name as string) ||
                    (selectedFeature.properties?.title as string) ||
                    selectedFeature.id}
                </span>
              ) : (
                <span className="text-ink-muted">Click any feature on map or table</span>
              )}
            </div>
          </div>
        )}

        {/* Phase 3: Corridor Options Card when buffering a line or path */}
        {(sourceType === "measurement" || sourceType === "selection") && (
          <div className="flex flex-col gap-2 rounded-[2px] border border-line bg-tint p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-ink-muted font-medium">Corridor Offset Side:</span>
              <div className="flex items-center gap-1">
                {(["both", "left", "right"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    className={cx(
                      "px-2 py-0.5 text-[9.5px] rounded-[2px] border font-medium capitalize transition-colors",
                      corridorSide === side
                        ? "bg-accent text-on-accent font-semibold border-accent"
                        : "bg-solid text-ink-muted hover:text-ink border-line",
                    )}
                    onClick={() => {
                      setCorridorSide(side);
                      runQueryWithParams(
                        sourceType,
                        ringMode,
                        ringCount,
                        radiusMeters,
                        bufferCenter,
                        selectedLayerId,
                        shapeMode,
                        startAzimuth,
                        endAzimuth,
                        innerRadiusInput,
                        side,
                        corridorCap,
                      );
                    }}
                  >
                    {side === "both" ? "Both" : side === "left" ? "Port (Left)" : "Starboard (Right)"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-line/60">
              <span className="text-[10px] text-ink-muted font-medium">Terminal Cap Style:</span>
              <div className="flex items-center gap-1">
                {(["round", "flat"] as const).map((cap) => (
                  <button
                    key={cap}
                    type="button"
                    className={cx(
                      "px-2 py-0.5 text-[9.5px] rounded-[2px] border font-medium capitalize transition-colors",
                      corridorCap === cap
                        ? "bg-accent text-on-accent font-semibold border-accent"
                        : "bg-solid text-ink-muted hover:text-ink border-line",
                    )}
                    onClick={() => {
                      setCorridorCap(cap);
                      runQueryWithParams(
                        sourceType,
                        ringMode,
                        ringCount,
                        radiusMeters,
                        bufferCenter,
                        selectedLayerId,
                        shapeMode,
                        startAzimuth,
                        endAzimuth,
                        innerRadiusInput,
                        corridorSide,
                        cap,
                      );
                    }}
                  >
                    {cap === "round" ? "Round (180°)" : "Flat (Square)"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Ring Mode: Single vs Multi-Ring Tactical Range Rings */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <SectionLabel>Ring Architecture</SectionLabel>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={cx(
                  "px-2 py-0.5 text-[9.5px] rounded-[2px] border font-medium transition-colors",
                  ringMode === "single"
                    ? "bg-accent text-on-accent font-semibold border-accent"
                    : "bg-solid text-ink-muted hover:text-ink border-line",
                )}
                onClick={() => setRingMode("single")}
              >
                Single Ring
              </button>
              <button
                type="button"
                className={cx(
                  "px-2 py-0.5 text-[9.5px] rounded-[2px] border font-medium transition-colors flex items-center gap-1",
                  ringMode === "multi"
                    ? "bg-accent text-on-accent font-semibold border-accent"
                    : "bg-solid text-ink-muted hover:text-ink border-line",
                )}
                onClick={() => setRingMode("multi")}
              >
                <CircleDot size={10} />
                Range Rings
              </button>
            </div>
          </div>

          {ringMode === "multi" && (
            <div className="mt-1 flex items-center justify-between rounded-[2px] border border-line bg-tint p-2">
              <span className="text-[10px] text-ink-muted">Concentric Bands:</span>
              <div className="flex items-center gap-1">
                {[2, 3, 4, 5].map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    className={cx(
                      "size-5 text-[10px] font-mono rounded-[2px] border transition-colors",
                      ringCount === cnt
                        ? "bg-accent text-on-accent font-semibold border-accent"
                        : "bg-solid text-ink-muted hover:text-ink border-line",
                    )}
                    onClick={() => {
                      setRingCount(cnt);
                      runQueryWithParams(sourceType, "multi", cnt, radiusMeters, bufferCenter, selectedLayerId);
                    }}
                  >
                    {cnt}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Radius & Unit Selector */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <SectionLabel>
              {ringMode === "multi" ? "Step Distance (Per Ring)" : "Buffer Radius"}
            </SectionLabel>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className={cx(
                  "px-1.5 py-0.5 text-[9px] rounded-[2px] border font-mono transition-colors flex items-center gap-1",
                  enableDragHandle
                    ? "bg-accent/15 text-accent border-accent/40 font-medium"
                    : "bg-solid text-ink-muted hover:text-ink border-line",
                )}
                title="Toggle interactive map canvas drag-handle to resize radius directly on the map"
                onClick={() => {
                  const nextVal = !enableDragHandle;
                  setEnableDragHandle(nextVal);
                  runQueryWithParams(
                    sourceType,
                    ringMode,
                    ringCount,
                    radiusMeters,
                    bufferCenter,
                    selectedLayerId,
                    shapeMode,
                    startAzimuth,
                    endAzimuth,
                    innerRadiusInput,
                    corridorSide,
                    corridorCap,
                    nextVal,
                  );
                }}
              >
                <span>↔</span>
                <span>Drag: {enableDragHandle ? "ON" : "OFF"}</span>
              </button>
              {/* Unit Toggle Buttons */}
              <div className="flex items-center gap-0.5 rounded-[2px] border border-line bg-solid p-0.5">
                {(["m", "km", "NM", "mi"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    className={cx(
                      "px-1.5 py-0.5 text-[9.5px] font-mono transition-colors rounded-[1px]",
                      unit === u
                        ? "bg-accent text-on-accent font-semibold"
                        : "text-ink-muted hover:text-ink",
                    )}
                    onClick={() => handleUnitChange(u)}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="grid grid-cols-4 gap-1">
            {UNIT_PRESETS[unit].map((preset) => {
              const presetMeters = preset * UNIT_MULTIPLIERS[unit];
              const isSelected = Math.abs(radiusMeters - presetMeters) < 0.1;
              return (
                <button
                  key={preset}
                  type="button"
                  className={cx(
                    "rounded-[2px] border py-1 text-[10px] font-mono transition-colors",
                    isSelected
                      ? "border-line-strong bg-tint text-ink font-semibold"
                      : "border-line bg-solid text-ink-muted hover:text-ink",
                  )}
                  onClick={() => handlePresetClick(preset)}
                >
                  {preset} {unit}
                </button>
              );
            })}
          </div>

          {/* Numeric Radius Input */}
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min="1"
              max="500000"
              step={unit === "m" ? "100" : "0.5"}
              value={Number(displayRadius.toFixed(unit === "m" ? 0 : 2))}
              onChange={(e) => {
                const val = Number(e.target.value);
                handleRadiusInputChange(val);
              }}
              className={FIELD_INPUT}
              placeholder={`Radius in ${unit}`}
            />
            <span className="shrink-0 text-[10.5px] font-mono text-ink-muted">
              {unit}
            </span>
          </div>

          {/* Envelope Summary Readout */}
          <div className="flex items-center justify-between text-[9.5px] font-mono text-ink-muted px-1">
            <span>
              {ringMode === "multi"
                ? `Max Reach: ${( (radiusMeters * ringCount) / 1000 ).toFixed(1)} km`
                : `Area: ${areaSqKm} km²`}
            </span>
            <span>
              {unit !== "NM" && `${(radiusMeters / 1852).toFixed(1)} NM · `}
              {unit !== "km" && `${(radiusMeters / 1000).toFixed(1)} km`}
            </span>
          </div>
        </div>

        {/* Live Telemetry Interception Toggle */}
        <div className="flex items-center justify-between rounded-[2px] border border-line bg-tint p-2">
          <div className="flex items-center gap-1.5">
            <Radio size={12} className={includeTelemetry ? "text-accent animate-pulse" : "text-ink-muted"} />
            <span className="text-[10px] font-medium text-ink">
              Intercept Live Feeds (ADS-B, AIS, Quakes)
            </span>
          </div>
          <button
            type="button"
            className={cx(
              "px-2 py-0.5 text-[9px] font-mono rounded-[2px] border transition-colors",
              includeTelemetry
                ? "bg-accent/15 text-accent border-accent/40 font-semibold"
                : "bg-solid text-ink-muted border-line",
            )}
            onClick={() => setIncludeTelemetry(!includeTelemetry)}
          >
            {includeTelemetry ? "ENABLED" : "OFF"}
          </button>
        </div>

        {/* Target Layer Filter */}
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Target Dataset</SectionLabel>
          <select
            value={selectedLayerId}
            onChange={(e) => {
              setSelectedLayerId(e.target.value);
              runQueryWithParams(sourceType, ringMode, ringCount, radiusMeters, bufferCenter, e.target.value);
            }}
            className={cx(FIELD_INPUT, "cursor-pointer")}
          >
            <option value="all">All Active Layers ({layers.length})</option>
            {layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.features.length} features)
              </option>
            ))}
          </select>
        </div>

        {/* Main Action Buttons */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            className={cx(PRIMARY_BUTTON, "gap-1.5")}
            disabled={
              bufferLoading ||
              (sourceType === "point" && !bufferCenter) ||
              (sourceType === "measurement" && !hasMeasurementRoute) ||
              (sourceType === "selection" && !selectedFeature)
            }
            onClick={() => {
              runQueryWithParams(sourceType, ringMode, ringCount, radiusMeters, bufferCenter, selectedLayerId);
            }}
          >
            {bufferLoading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Radar size={12} />
            )}
            Run Query
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            onClick={clearBuffer}
          >
            <Eraser size={12} />
            Clear Buffer
          </button>
        </div>

        {/* Phase 4: Spatial Coverage & Density KPI Card */}
        {bufferResult && (
          <div className="flex flex-col gap-1.5 rounded-[2px] border border-line bg-tint p-2.5">
            <div className="flex items-center justify-between border-b border-line/60 pb-1.5">
              <span className="text-[10.5px] font-semibold text-ink flex items-center gap-1.5">
                <BarChart3 size={12} className="text-accent" />
                Spatial Catchment Analytics
              </span>
              <span className="text-[9px] font-mono text-ink-muted">
                WGS 84 Ellipsoid
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              {/* Coverage Area */}
              <div className="flex flex-col rounded-[2px] border border-line/80 bg-solid p-1.5">
                <span className="text-[9px] text-ink-muted uppercase tracking-wider font-medium">
                  Coverage Area
                </span>
                <span className="text-[12px] font-mono font-semibold text-ink mt-0.5">
                  {formatArea(bufferResult.area_sq_meters || 0)}
                </span>
                <span className="text-[8.5px] text-ink-muted font-mono">
                  {bufferResult.area_acres != null ? `${bufferResult.area_acres.toLocaleString()} acres` : "—"}
                </span>
              </div>

              {/* Spatial Density */}
              <div className="flex flex-col rounded-[2px] border border-line/80 bg-solid p-1.5">
                <span className="text-[9px] text-ink-muted uppercase tracking-wider font-medium">
                  Target Density
                </span>
                <span className="text-[12px] font-mono font-semibold text-accent mt-0.5">
                  {bufferResult.area_sq_km && bufferResult.area_sq_km > 0
                    ? `${(bufferResult.total_hits / bufferResult.area_sq_km).toFixed(2)} / km²`
                    : "—"}
                </span>
                <span className="text-[8.5px] text-ink-muted font-mono">
                  {bufferResult.total_hits} targets intercepted
                </span>
              </div>
            </div>

            {/* Nearest & Furthest Targets Highlight */}
            {(nearestHit || furthestHit) && (
              <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-line/50">
                {nearestHit && (
                  <div
                    className="flex flex-col rounded-[2px] bg-solid/80 p-1.5 hover:border-line border border-transparent transition-colors cursor-pointer group"
                    title="Click to fly to nearest target"
                    onClick={() => {
                      const lon = Number(
                        nearestHit.target_lon ??
                          nearestHit.properties?.longitude ??
                          nearestHit.properties?.lon ??
                          bufferResult.center_lon,
                      );
                      const lat = Number(
                        nearestHit.target_lat ??
                          nearestHit.properties?.latitude ??
                          nearestHit.properties?.lat ??
                          bufferResult.center_lat,
                      );
                      flyToCoordinate(lon, lat, 16);
                    }}
                  >
                    <span className="text-[8.5px] text-emerald-400 font-semibold uppercase tracking-wider flex items-center gap-1">
                      <span>●</span> Nearest Entity
                    </span>
                    <span className="text-[10px] font-semibold text-ink truncate mt-0.5">
                      {(nearestHit.properties?.name as string) ||
                        (nearestHit.properties?.callsign as string) ||
                        nearestHit.feature_id ||
                        "Target"}
                    </span>
                    <span className="text-[8.5px] font-mono text-ink-muted">
                      {formatDistance(nearestHit.distance_m)} • {nearestHit.bearing_deg.toFixed(0)}°{" "}
                      {bearingToDirection(nearestHit.bearing_deg)}
                    </span>
                  </div>
                )}

                {furthestHit && (
                  <div
                    className="flex flex-col rounded-[2px] bg-solid/80 p-1.5 hover:border-line border border-transparent transition-colors cursor-pointer group"
                    title="Click to fly to furthest target"
                    onClick={() => {
                      const lon = Number(
                        furthestHit.target_lon ??
                          furthestHit.properties?.longitude ??
                          furthestHit.properties?.lon ??
                          bufferResult.center_lon,
                      );
                      const lat = Number(
                        furthestHit.target_lat ??
                          furthestHit.properties?.latitude ??
                          furthestHit.properties?.lat ??
                          bufferResult.center_lat,
                      );
                      flyToCoordinate(lon, lat, 16);
                    }}
                  >
                    <span className="text-[8.5px] text-amber-400 font-semibold uppercase tracking-wider flex items-center gap-1">
                      <span>●</span> Furthest Entity
                    </span>
                    <span className="text-[10px] font-semibold text-ink truncate mt-0.5">
                      {(furthestHit.properties?.name as string) ||
                        (furthestHit.properties?.callsign as string) ||
                        furthestHit.feature_id ||
                        "Target"}
                    </span>
                    <span className="text-[8.5px] font-mono text-ink-muted">
                      {formatDistance(furthestHit.distance_m)} • {furthestHit.bearing_deg.toFixed(0)}°{" "}
                      {bearingToDirection(furthestHit.bearing_deg)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Phase 4: Feed & Layer Distribution Breakdown */}
        {bufferResult && layerDistribution.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[9.5px] text-ink-muted font-medium uppercase tracking-wider">
                Intercepted Feed Breakdown
              </span>
              <span className="text-[9px] font-mono text-ink-muted">
                {layerDistribution.length} distinct source{layerDistribution.length > 1 ? "s" : ""}
              </span>
            </div>

            {/* Multi-segment proportional bar */}
            <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-line">
              {layerDistribution.map((dist) => {
                const pct = (dist.count / bufferResult.total_hits) * 100;
                return (
                  <div
                    key={dist.key}
                    style={{ width: `${pct}%`, backgroundColor: dist.color }}
                    title={`${dist.label}: ${dist.count} (${pct.toFixed(0)}%)`}
                  />
                );
              })}
            </div>

            {/* Quick Filter Tag Pills */}
            <div className="flex items-center gap-1 flex-wrap pt-0.5">
              <button
                type="button"
                className={cx(
                  "px-1.5 py-0.5 rounded-[2px] text-[9px] font-mono border transition-colors",
                  selectedHitLayer === "all"
                    ? "bg-accent text-on-accent border-accent font-semibold"
                    : "bg-solid text-ink-muted hover:text-ink border-line",
                )}
                onClick={() => setSelectedHitLayer("all")}
              >
                All ({bufferResult.total_hits})
              </button>
              {layerDistribution.map((dist) => {
                const isSelected = selectedHitLayer === dist.key;
                return (
                  <button
                    key={dist.key}
                    type="button"
                    className={cx(
                      "px-1.5 py-0.5 rounded-[2px] text-[9px] border transition-colors flex items-center gap-1",
                      isSelected
                        ? "bg-accent text-on-accent border-accent font-semibold"
                        : "bg-solid text-ink-muted hover:text-ink border-line",
                    )}
                    onClick={() => setSelectedHitLayer(isSelected ? "all" : dist.key)}
                  >
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: dist.color }} />
                    <span className="truncate max-w-[100px]">{dist.label}</span>
                    <span className="font-mono text-[8.5px]">({dist.count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Save as Layer & Export Actions */}
        {bufferResult && (
          <div className="flex flex-col gap-1.5 border-t border-line pt-2">
            <div className="grid grid-cols-4 gap-1">
              <button
                type="button"
                className={cx(
                  SECONDARY_BUTTON,
                  "text-[9px] px-1 py-1 justify-center gap-1",
                )}
                onClick={handleSaveAsLayer}
                title="Save buffer polygon as a new layer in your project"
              >
                <BookmarkPlus size={10} />
                Buffer Layer
              </button>
              <button
                type="button"
                className={cx(
                  SECONDARY_BUTTON,
                  "text-[9px] px-1 py-1 justify-center gap-1",
                )}
                disabled={bufferResult.hits.length === 0}
                onClick={handleSaveHitsAsLayer}
                title="Save intercepted target points as a new layer with distances and bearings"
              >
                <Crosshair size={10} />
                Targets Layer
              </button>
              <button
                type="button"
                className={cx(
                  SECONDARY_BUTTON,
                  "text-[9px] px-1 py-1 justify-center gap-1",
                )}
                disabled={bufferResult.hits.length === 0}
                onClick={handleExportCsv}
                title="Download CSV table of all intercepted features"
              >
                <FileSpreadsheet size={10} />
                CSV
              </button>
              <button
                type="button"
                className={cx(
                  SECONDARY_BUTTON,
                  "text-[9px] px-1 py-1 justify-center gap-1",
                )}
                onClick={handleExportGeoJson}
                title="Download complete GeoJSON FeatureCollection (Buffer + Targets)"
              >
                <Download size={10} />
                GeoJSON
              </button>
            </div>
          </div>
        )}

        {/* Hit Results */}
        {bufferResult && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <SectionLabel
                trailing={
                  <span className="text-ink font-mono font-semibold">
                    ({filteredAndSortedHits.length} of {bufferResult.total_hits})
                  </span>
                }
              >
                Ranked Spatial Intersections
              </SectionLabel>

              {/* Sort Selector */}
              <div className="flex items-center gap-1">
                <ArrowUpDown size={10} className="text-ink-muted" />
                <select
                  value={hitSortOrder}
                  onChange={(e) => setHitSortOrder(e.target.value as any)}
                  className="bg-solid border border-line text-ink rounded-[2px] px-1 py-0.5 text-[9px] font-mono focus:outline-none focus:border-accent"
                >
                  <option value="distance-asc">Distance (Near → Far)</option>
                  <option value="distance-desc">Distance (Far → Near)</option>
                  <option value="azimuth">Azimuth Bearing</option>
                  <option value="name">Name / Callsign</option>
                </select>
              </div>
            </div>

            {/* Filter Search Input */}
            {bufferResult.hits.length > 3 && (
              <div className="relative flex items-center">
                <Search size={10} className="absolute left-2 text-ink-muted" />
                <input
                  type="text"
                  placeholder="Filter by name, callsign, or layer..."
                  value={hitSearchQuery}
                  onChange={(e) => setHitSearchQuery(e.target.value)}
                  className="w-full rounded-[2px] border border-line bg-solid py-1 pl-6 pr-2 text-[10px] text-ink placeholder:text-ink-muted/60 focus:border-accent focus:outline-none"
                />
                {hitSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setHitSearchQuery("")}
                    className="absolute right-2 text-[9px] text-ink-muted hover:text-ink font-mono"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            {filteredAndSortedHits.length === 0 ? (
              <div className="rounded-[2px] border border-line bg-tint py-4 text-center text-[10.5px] text-ink-muted">
                {bufferResult.hits.length === 0
                  ? "No features intercepted within this buffer envelope."
                  : "No targets match your search filter."}
              </div>
            ) : (
              <div className="max-h-[260px] overflow-y-auto rounded-[2px] border border-line bg-tint p-1 flex flex-col gap-1">
                {filteredAndSortedHits.map((hit, idx) => {
                  const layer = layers.find((l) => l.id === hit.layer_id);
                  const isTel = hit.is_telemetry;
                  const name =
                    (hit.properties?.name as string) ||
                    (hit.properties?.callsign as string) ||
                    (hit.properties?.title as string) ||
                    (hit.properties?.place as string) ||
                    (hit.properties?.id as string) ||
                    hit.feature_id ||
                    `Feature #${idx + 1}`;

                  return (
                    <div
                      key={idx}
                      className="group flex flex-col gap-1 rounded-[2px] bg-solid p-2 text-[10.5px] hover:border-line-strong border border-transparent transition-colors cursor-pointer"
                      onClick={() => {
                        const lon = Number(
                          hit.target_lon ??
                            hit.properties?.longitude ??
                            hit.properties?.lon ??
                            bufferResult.center_lon,
                        );
                        const lat = Number(
                          hit.target_lat ??
                            hit.properties?.latitude ??
                            hit.properties?.lat ??
                            bufferResult.center_lat,
                        );
                        flyToCoordinate(lon, lat, 16);
                        notify(`Navigated to ${name}`);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className="font-semibold text-ink truncate max-w-[170px] flex items-center gap-1"
                          title={name}
                        >
                          {isTel && hit.telemetry_type === "flight" && <Plane size={11} className="text-amber-400 shrink-0" />}
                          {isTel && hit.telemetry_type === "vessel" && <Ship size={11} className="text-cyan-400 shrink-0" />}
                          {isTel && hit.telemetry_type === "earthquake" && <Activity size={11} className="text-rose-400 shrink-0" />}
                          <span className="truncate">{name}</span>
                        </span>
                        <div className="flex items-center gap-1.5">
                          {hit.ring_band != null && (
                            <span className="px-1 py-0.2 rounded-[2px] bg-tint border border-line text-[8.5px] font-mono text-accent">
                              Band {hit.ring_band}
                            </span>
                          )}
                          <span className="font-mono text-ink font-medium">
                            {formatDistance(hit.distance_m)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[9px] text-ink-muted">
                        <span className="flex items-center gap-1">
                          <span
                            className="size-1.5 rounded-full"
                            style={{
                              backgroundColor: isTel
                                ? hit.telemetry_type === "flight"
                                  ? "#fbbf24"
                                  : hit.telemetry_type === "vessel"
                                  ? "#22d3ee"
                                  : "#f43f5e"
                                : layer?.style?.color || "#06b6d4",
                            }}
                          />
                          {isTel ? `Live ${hit.telemetry_type}` : layer?.name || hit.layer_id}
                          <span className="text-ink-muted/70 text-[8px] uppercase tracking-wide">
                            [{hit.geometry_type}]
                          </span>
                        </span>
                        <span className="font-mono">
                          {hit.bearing_deg.toFixed(0)}°{" "}
                          {bearingToDirection(hit.bearing_deg)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <InfoNote>
          {sourceType === "measurement"
            ? "Constructs a geodetic line corridor envelope around the active measurement path, querying all layers and feeds within the corridor radius."
            : ringMode === "multi"
            ? `Generates ${ringCount} concentric tactical range rings on WGS 84, classifying intercepted targets into graduated distance bands.`
            : "Constructs a 64-vertex true geodesic buffer polygon on WGS 84, scanning the spatial index and calculating ellipsoidal distances to all intercepted features."}
        </InfoNote>
      </div>
    </PanelShell>
  );
}
