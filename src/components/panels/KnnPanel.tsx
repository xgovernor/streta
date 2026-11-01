import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpDown,
  BarChart3,
  Compass,
  Crosshair,
  Download,
  Eraser,
  FileSpreadsheet,
  Flame,
  Loader2,
  MapPin,
  Navigation,
  Plane,
  Radio,
  Save,
  Ship,
  Zap,
} from "lucide-react";
import {
  clearKnnOverlay,
  flyToCoordinate,
  renderKnnOverlay,
  setBufferPicker,
  type KnnOverlayNeighbor,
} from "../../map/mapController";
import { cx } from "../../lib/cx";
import {
  bearingToCompassDirection,
  extractFeatureCentroid,
  geodesicDistanceAndBearing,
  spatialKnnQuery,
  type KnnQueryResult,
  type SpatialPointInput,
} from "../../lib/gis/tiledBackend";
import { uniqueDatasetName } from "../../lib/gis/datasets";
import { uniqueLayerName } from "../../lib/gis/layers";
import { GEOGRAPHIC_CRS } from "../../lib/gis/crs";
import { interpolateGreatCircleArc } from "../../lib/gis/voyageRoute";
import type {
  EarthquakeTarget,
  FeatureRecord,
  FireTarget,
  FlightTarget,
  SatelliteTarget,
  VesselTarget,
} from "../../lib/gis/types";
import { useProjectStore } from "../../state/projectStore";
import { useTelemetryStore } from "../../state/telemetryStore";
import { useUiStore } from "../../state/uiStore";
import { PanelShell } from "../PanelShell";
import {
  FIELD_INPUT,
  InfoNote,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from "./shared";

type TargetKind = "flight" | "vessel" | "fire" | "earthquake" | "satellite" | "layer";
type DistanceUnit = "km" | "m" | "NM" | "mi";
type OriginMode = "map" | "feature" | "manual";
type ActiveTab = "probe" | "matrix";

interface CandidateMetadata {
  kind: TargetKind;
  displayName: string;
  properties: Record<string, any>;
  originalTarget?: any;
}

export interface EnrichedNeighbor extends KnnOverlayNeighbor {
  rank: number;
  kind: TargetKind;
  euclidean_distance_3d_m: number;
  properties?: Record<string, any>;
  originalTarget?: any;
  formattedDistance: string;
}

interface MatrixPair {
  sourceId: string;
  sourceName: string;
  sourceCoord: [number, number];
  targetId: string;
  targetName: string;
  targetCoord: [number, number];
  distanceM: number;
  bearingDeg: number;
  compass: string;
  formattedDistance: string;
}

interface MatrixResult {
  sourceLayerName: string;
  targetLayerName: string;
  sourceCount: number;
  targetCount: number;
  pairs: MatrixPair[];
  stats: {
    minDistanceM: number;
    maxDistanceM: number;
    meanDistanceM: number;
    medianDistanceM: number;
    stdDevM: number;
  };
  executionMs: number;
}

function formatDistanceValue(meters: number, unit: DistanceUnit): string {
  if (unit === "NM") {
    const nm = meters / 1852;
    return `${nm >= 10 ? nm.toFixed(1) : nm.toFixed(2)} NM`;
  }
  if (unit === "mi") {
    const mi = meters / 1609.344;
    return `${mi >= 10 ? mi.toFixed(1) : mi.toFixed(2)} mi`;
  }
  if (unit === "m" || meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

function parseDistanceToMeters(val: number, unit: DistanceUnit): number {
  if (unit === "NM") return val * 1852;
  if (unit === "mi") return val * 1609.344;
  if (unit === "km") return val * 1000;
  return val;
}

export function KnnPanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const notify = useUiStore((state) => state.notify);
  const layers = useProjectStore((state) => state.layers);
  const addDataset = useProjectStore((state) => state.addDataset);
  const setSelectedTarget = useTelemetryStore((state) => state.setSelectedTarget);

  // Tabs
  const [activeTab, setActiveTab] = useState<ActiveTab>("probe");

  // Query Origin Mode
  const [originMode, setOriginMode] = useState<OriginMode>("map");
  const [knnCenter, setKnnCenter] = useState<[number, number] | null>(null);
  const [isPickingKnnCenter, setIsPickingKnnCenter] = useState(false);

  // Manual Origin Coordinates
  const [manualLon, setManualLon] = useState<string>("");
  const [manualLat, setManualLat] = useState<string>("");

  // Feature Origin Selection
  const [selectedOriginFeatureKey, setSelectedOriginFeatureKey] = useState<string>("");

  // k-NN Parameters
  const [knnK, setKnnK] = useState<number>(5);
  const [customKInput, setCustomKInput] = useState<string>("5");
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>("km");
  const [hasRadiusCutoff, setHasRadiusCutoff] = useState(false);
  const [radiusCutoffValue, setRadiusCutoffValue] = useState<number>(50);

  // Target Filter
  const [selectedKnnLayerId, setSelectedKnnLayerId] = useState<string>("all");

  // Live Watchdog
  const [isWatchdogActive, setIsWatchdogActive] = useState(false);
  const watchdogTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Single Probe Execution State
  const [knnLoading, setKnnLoading] = useState(false);
  const [rawKnnResult, setRawKnnResult] = useState<KnnQueryResult | null>(null);
  const [enrichedNeighbors, setEnrichedNeighbors] = useState<EnrichedNeighbor[]>([]);

  // Layer-to-Layer Matrix State
  const [matrixSourceLayerId, setMatrixSourceLayerId] = useState<string>("");
  const [matrixTargetLayerId, setMatrixTargetLayerId] = useState<string>("");
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixResult, setMatrixResult] = useState<MatrixResult | null>(null);

  // Collect candidate features and telemetry
  const collectCandidates = useCallback(
    (targetLayer: string) => {
      const candidates: SpatialPointInput[] = [];
      const metadataMap = new Map<string, CandidateMetadata>();

      const addCandidate = (
        id: string,
        lon: number,
        lat: number,
        elevationM: number | undefined,
        meta: CandidateMetadata,
      ) => {
        candidates.push({ id, lon, lat, elevation_m: elevationM });
        metadataMap.set(id, meta);
      };

      // 1. Dataset Layers
      layers.forEach((l) => {
        if (targetLayer !== "all" && l.id !== targetLayer) return;
        l.features.forEach((f) => {
          const centroid = extractFeatureCentroid(f.geometry);
          if (centroid) {
            const name =
              (f.properties?.name as string) ||
              (f.properties?.title as string) ||
              (f.properties?.label as string) ||
              `${l.name} #${f.id}`;
            const id = `layer_${l.id}_${f.id}`;
            addCandidate(id, centroid[0], centroid[1], undefined, {
              kind: "layer",
              displayName: name,
              properties: f.properties || {},
            });
          }
        });
      });

      // 2. Live Flights
      if (targetLayer === "all" || targetLayer === "flights") {
        const telState = useTelemetryStore.getState();
        const flights = telState.displayedFlights ?? telState.flights;
        flights.forEach((f) => {
          const callsign = f.callsign?.trim() || f.icao24;
          const id = `flight_${f.icao24}`;
          addCandidate(id, f.longitude, f.latitude, f.altitudeMeters ?? undefined, {
            kind: "flight",
            displayName: `Flight ${callsign}`,
            properties: {
              icao24: f.icao24,
              callsign,
              altitudeMeters: f.altitudeMeters,
              velocityMps: f.velocityMps,
              headingDeg: f.headingDeg,
              originCountry: f.originCountry,
            },
            originalTarget: f,
          });
        });
      }

      // 3. Live Marine Vessels
      if (targetLayer === "all" || targetLayer === "vessels") {
        const vessels = useTelemetryStore.getState().vessels;
        vessels.forEach((v) => {
          const vName = v.name?.trim() || `MMSI ${v.mmsi}`;
          const id = `vessel_${v.mmsi || v.name}`;
          addCandidate(id, v.lon, v.lat, undefined, {
            kind: "vessel",
            displayName: vName,
            properties: {
              mmsi: v.mmsi,
              name: v.name,
              shipType: v.shipType,
              speedKnots: v.speedKnots,
              courseDeg: v.courseDeg,
              destination: v.destination,
            },
            originalTarget: v,
          });
        });
      }

      // 4. Live NASA FIRMS Fires
      if (targetLayer === "all" || targetLayer === "fires") {
        const fires = useTelemetryStore.getState().fires;
        fires.forEach((fire) => {
          const id = `fire_${fire.id}`;
          addCandidate(id, fire.lon, fire.lat, undefined, {
            kind: "fire",
            displayName: `Fire Hotspot (${fire.frpMw ? `${fire.frpMw.toFixed(0)} MW` : "Thermal"})`,
            properties: {
              brightnessK: fire.brightnessK,
              frpMw: fire.frpMw,
              confidence: fire.confidence,
              acqDate: fire.acqDate,
            },
            originalTarget: fire,
          });
        });
      }

      // 5. Live Earthquakes
      if (targetLayer === "all" || targetLayer === "earthquakes") {
        const quakes = useTelemetryStore.getState().earthquakes;
        quakes.forEach((q) => {
          const id = `quake_${q.id}`;
          addCandidate(id, q.longitude, q.latitude, undefined, {
            kind: "earthquake",
            displayName: `M${q.magnitude.toFixed(1)} ${q.place}`,
            properties: {
              magnitude: q.magnitude,
              depthKm: q.depthKm,
              place: q.place,
              time: q.time,
            },
            originalTarget: q,
          });
        });
      }

      // 6. Live Satellites
      if (targetLayer === "all" || targetLayer === "satellites") {
        const sats = useTelemetryStore.getState().satellites;
        sats.forEach((s) => {
          const id = `sat_${s.noradId || s.name}`;
          addCandidate(id, s.longitude, s.latitude, s.altitudeKm ? s.altitudeKm * 1000 : undefined, {
            kind: "satellite",
            displayName: s.name,
            properties: {
              noradId: s.noradId,
              altitudeKm: s.altitudeKm,
              velocityKmh: s.velocityKmh,
            },
            originalTarget: s,
          });
        });
      }

      return { candidates, metadataMap };
    },
    [layers],
  );

  // Execute k-NN query
  const executeKnnQuery = useCallback(
    async (
      center: [number, number],
      kVal: number,
      targetLayer: string,
      unit: DistanceUnit,
      silent: boolean = false,
    ) => {
      if (!silent) setKnnLoading(true);
      try {
        const { candidates, metadataMap } = collectCandidates(targetLayer);

        if (candidates.length === 0) {
          if (!silent) notify("No point features or telemetry targets available to query");
          return;
        }

        const maxMeters = hasRadiusCutoff
          ? parseDistanceToMeters(radiusCutoffValue, unit)
          : undefined;

        const res = await spatialKnnQuery(
          candidates,
          center[0],
          center[1],
          undefined,
          kVal,
          maxMeters,
        );

        if (res) {
          setRawKnnResult(res);

          const enriched: EnrichedNeighbor[] = res.neighbors.map((n, idx) => {
            const meta = metadataMap.get(n.id);
            const kind: TargetKind = meta?.kind || "layer";
            const name = meta?.displayName || n.id;
            return {
              ...n,
              id: name,
              rank: idx + 1,
              kind,
              properties: meta?.properties,
              originalTarget: meta?.originalTarget,
              formattedDistance: formatDistanceValue(n.surface_distance_m, unit),
            };
          });

          setEnrichedNeighbors(enriched);
          renderKnnOverlay(center, enriched, { distanceUnit: unit });

          if (!silent) {
            notify(
              `k-NN: found ${enriched.length} nearest in ${res.execution_micros.toFixed(1)} µs`,
            );
          }
        } else {
          if (!silent) notify("k-NN query returned no results");
        }
      } catch (err) {
        if (!silent) notify(`k-NN query error: ${err}`);
      } finally {
        if (!silent) setKnnLoading(false);
      }
    },
    [collectCandidates, hasRadiusCutoff, radiusCutoffValue, notify],
  );

  // Live Watchdog Hook
  useEffect(() => {
    if (isWatchdogActive && knnCenter) {
      watchdogTimerRef.current = setInterval(() => {
        executeKnnQuery(knnCenter, knnK, selectedKnnLayerId, distanceUnit, true);
      }, 3000);
    } else {
      if (watchdogTimerRef.current) {
        clearInterval(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
    }

    return () => {
      if (watchdogTimerRef.current) {
        clearInterval(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
    };
  }, [isWatchdogActive, knnCenter, knnK, selectedKnnLayerId, distanceUnit, executeKnnQuery]);

  // Map Click Picker
  const toggleKnnPicker = () => {
    if (isPickingKnnCenter) {
      setBufferPicker(null);
      setIsPickingKnnCenter(false);
    } else {
      setIsPickingKnnCenter(true);
      notify("Click anywhere on the map to probe k-NN nearest neighbors");
      setBufferPicker((coord) => {
        setKnnCenter(coord);
        setManualLon(coord[0].toFixed(5));
        setManualLat(coord[1].toFixed(5));
        setIsPickingKnnCenter(false);
        setBufferPicker(null);
        executeKnnQuery(coord, knnK, selectedKnnLayerId, distanceUnit);
      });
    }
  };

  // Manual Origin Set
  const applyManualCoordinates = () => {
    const lon = parseFloat(manualLon);
    const lat = parseFloat(manualLat);
    if (isNaN(lon) || isNaN(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      notify("Enter valid coordinates: Longitude (-180 to 180), Latitude (-90 to 90)");
      return;
    }
    const coord: [number, number] = [lon, lat];
    setKnnCenter(coord);
    executeKnnQuery(coord, knnK, selectedKnnLayerId, distanceUnit);
  };

  // Feature Origin Options
  const featureOriginOptions = useMemo(() => {
    const list: Array<{ key: string; label: string; coord: [number, number] }> = [];
    layers.forEach((l) => {
      l.features.forEach((f) => {
        const centroid = extractFeatureCentroid(f.geometry);
        if (centroid) {
          const name =
            (f.properties?.name as string) ||
            (f.properties?.title as string) ||
            `${l.name} #${f.id}`;
          list.push({
            key: `${l.id}::${f.id}`,
            label: `${name} (${l.name})`,
            coord: centroid,
          });
        }
      });
    });
    return list;
  }, [layers]);

  const applyFeatureOrigin = (key: string) => {
    setSelectedOriginFeatureKey(key);
    const match = featureOriginOptions.find((o) => o.key === key);
    if (match) {
      setKnnCenter(match.coord);
      setManualLon(match.coord[0].toFixed(5));
      setManualLat(match.coord[1].toFixed(5));
      executeKnnQuery(match.coord, knnK, selectedKnnLayerId, distanceUnit);
    }
  };

  const clearKnn = () => {
    clearKnnOverlay();
    setRawKnnResult(null);
    setEnrichedNeighbors([]);
    setKnnCenter(null);
    setIsWatchdogActive(false);
    if (isPickingKnnCenter) {
      setBufferPicker(null);
      setIsPickingKnnCenter(false);
    }
    notify("k-NN query cleared");
  };

  // Save Nearest Hits as New Layer
  const handleSaveHitsAsLayer = () => {
    if (!knnCenter || enrichedNeighbors.length === 0) {
      notify("No nearest neighbor results to save");
      return;
    }

    const existingDatasetNames = useProjectStore.getState().datasets.map((d) => d.name);
    const existingLayerNames = useProjectStore.getState().layers.map((l) => l.name);

    const title = `Nearest ${enrichedNeighbors.length} Hits`;
    const datasetName = uniqueDatasetName(existingDatasetNames, title);
    const layerName = uniqueLayerName(existingLayerNames, title);

    const features: FeatureRecord[] = enrichedNeighbors.map((n) => ({
      id: `knn_hit_${n.rank}_${Date.now()}`,
      geometry: {
        type: "Point",
        coordinates: [n.lon, n.lat],
      },
      properties: {
        rank: n.rank,
        name: n.id,
        target_kind: n.kind,
        surface_distance_m: n.surface_distance_m,
        formatted_distance: n.formattedDistance,
        bearing_deg: n.bearing_deg ?? null,
        compass_direction: n.compass_direction ?? null,
        euclidean_distance_3d_m: n.euclidean_distance_3d_m ?? null,
        origin_lon: knnCenter[0],
        origin_lat: knnCenter[1],
        created_at: new Date().toISOString(),
      },
    }));

    addDataset({
      name: datasetName,
      kind: "file",
      source: "derived:knn",
      layers: [
        {
          id: `layer_${Date.now().toString(36)}`,
          name: layerName,
          features,
          crs: GEOGRAPHIC_CRS,
          format: "geojson",
          style: {
            color: "#d946ef",
            strokeWidth: 2,
            pointRadius: 6,
            fillOpacity: 0.8,
            labelField: "name",
          },
        },
      ],
    });

    notify(`Saved ${features.length} nearest neighbors to layer "${layerName}"`);
  };

  // Save Spokes / Connection Rays as New Layer
  const handleSaveSpokesAsLayer = () => {
    if (!knnCenter || enrichedNeighbors.length === 0) {
      notify("No nearest neighbor rays to save");
      return;
    }

    const existingDatasetNames = useProjectStore.getState().datasets.map((d) => d.name);
    const existingLayerNames = useProjectStore.getState().layers.map((l) => l.name);

    const title = `Geodesic KNN Rays (${enrichedNeighbors.length}x)`;
    const datasetName = uniqueDatasetName(existingDatasetNames, title);
    const layerName = uniqueLayerName(existingLayerNames, title);

    const features: FeatureRecord[] = [];

    enrichedNeighbors.forEach((n) => {
      const segments = interpolateGreatCircleArc(knnCenter[0], knnCenter[1], n.lon, n.lat, 2);
      segments.forEach((seg: number[][], sIdx: number) => {
        features.push({
          id: `ray_${n.rank}_seg_${sIdx}_${Date.now()}`,
          geometry: {
            type: "LineString",
            coordinates: seg,
          },
          properties: {
            rank: n.rank,
            target_name: n.id,
            target_kind: n.kind,
            surface_distance_m: n.surface_distance_m,
            formatted_distance: n.formattedDistance,
            bearing_deg: n.bearing_deg ?? null,
            compass_direction: n.compass_direction ?? null,
            origin_lon: knnCenter[0],
            origin_lat: knnCenter[1],
            target_lon: n.lon,
            target_lat: n.lat,
          },
        });
      });
    });

    addDataset({
      name: datasetName,
      kind: "file",
      source: "derived:knn",
      layers: [
        {
          id: `layer_${Date.now().toString(36)}`,
          name: layerName,
          features,
          crs: GEOGRAPHIC_CRS,
          format: "geojson",
          style: {
            color: "#c026d3",
            strokeWidth: 2,
            pointRadius: 3,
            fillOpacity: 0.7,
            labelField: "formatted_distance",
          },
        },
      ],
    });

    notify(`Saved ${features.length} connection rays to layer "${layerName}"`);
  };

  // Export Results to CSV
  const handleExportCsv = () => {
    if (enrichedNeighbors.length === 0) {
      notify("No results to export");
      return;
    }

    const headers = [
      "Rank",
      "ID",
      "Kind",
      "Longitude",
      "Latitude",
      "Distance_Meters",
      "Formatted_Distance",
      "Bearing_Degrees",
      "Compass_Direction",
      "Euclidean_3D_Chord_Meters",
      "Origin_Longitude",
      "Origin_Latitude",
    ];

    const rows = enrichedNeighbors.map((n) =>
      [
        n.rank,
        `"${n.id.replace(/"/g, '""')}"`,
        n.kind,
        n.lon.toFixed(6),
        n.lat.toFixed(6),
        n.surface_distance_m,
        `"${n.formattedDistance}"`,
        n.bearing_deg ?? "",
        n.compass_direction ?? "",
        n.euclidean_distance_3d_m,
        knnCenter ? knnCenter[0].toFixed(6) : "",
        knnCenter ? knnCenter[1].toFixed(6) : "",
      ].join(","),
    );

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spatial_knn_results_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify(`Exported ${enrichedNeighbors.length} nearest neighbors to CSV`);
  };

  // Export Results to GeoJSON
  const handleExportGeoJson = () => {
    if (!knnCenter || enrichedNeighbors.length === 0) {
      notify("No results to export");
      return;
    }

    const pointFeatures = enrichedNeighbors.map((n) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [n.lon, n.lat],
      },
      properties: {
        rank: n.rank,
        name: n.id,
        kind: n.kind,
        distance_m: n.surface_distance_m,
        distance_str: n.formattedDistance,
        bearing_deg: n.bearing_deg,
        compass: n.compass_direction,
      },
    }));

    const spokeFeatures: any[] = [];
    enrichedNeighbors.forEach((n) => {
      const segs = interpolateGreatCircleArc(knnCenter[0], knnCenter[1], n.lon, n.lat, 2);
      segs.forEach((seg: number[][]) => {
        spokeFeatures.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: seg,
          },
          properties: {
            rank: n.rank,
            target: n.id,
            distance_m: n.surface_distance_m,
          },
        });
      });
    });

    const geojson = {
      type: "FeatureCollection",
      features: [...pointFeatures, ...spokeFeatures],
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], {
      type: "application/geo+json;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spatial_knn_${Date.now()}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    notify(`Exported GeoJSON FeatureCollection`);
  };

  // Target Focus and Telemetry Tracking
  const handleNeighborClick = (n: EnrichedNeighbor) => {
    flyToCoordinate(n.lon, n.lat, 14);

    if (n.originalTarget) {
      if (n.kind === "flight") {
        setSelectedTarget({ type: "flight", data: n.originalTarget as FlightTarget });
      } else if (n.kind === "vessel") {
        setSelectedTarget({ type: "vessel", data: n.originalTarget as VesselTarget });
      } else if (n.kind === "fire") {
        setSelectedTarget({ type: "fire", data: n.originalTarget as FireTarget });
      } else if (n.kind === "earthquake") {
        setSelectedTarget({ type: "earthquake", data: n.originalTarget as EarthquakeTarget });
      } else if (n.kind === "satellite") {
        setSelectedTarget({ type: "satellite", data: n.originalTarget as SatelliteTarget });
      }
    }

    notify(`Focused on #${n.rank}: ${n.id} (${n.formattedDistance} @ ${n.compass_direction})`);
  };

  // Phase 5: Layer-to-Layer Distance Matrix Computation
  const executeLayerDistanceMatrix = () => {
    if (!matrixSourceLayerId || !matrixTargetLayerId) {
      notify("Select both Source and Target layers for Distance Matrix");
      return;
    }
    if (matrixSourceLayerId === matrixTargetLayerId) {
      notify("Source and Target layers must be different");
      return;
    }

    setMatrixLoading(true);
    const startTime = performance.now();

    try {
      const srcLayer = layers.find((l) => l.id === matrixSourceLayerId);
      if (!srcLayer || srcLayer.features.length === 0) {
        notify("Source layer has no features");
        setMatrixLoading(false);
        return;
      }

      const { candidates: targetCandidates, metadataMap: targetMeta } =
        collectCandidates(matrixTargetLayerId);

      if (targetCandidates.length === 0) {
        notify("Target layer has no point features or telemetry candidates");
        setMatrixLoading(false);
        return;
      }

      const pairs: MatrixPair[] = [];
      const distances: number[] = [];

      srcLayer.features.forEach((f) => {
        const centroid = extractFeatureCentroid(f.geometry);
        if (!centroid) return;

        const srcName =
          (f.properties?.name as string) ||
          (f.properties?.title as string) ||
          `${srcLayer.name} #${f.id}`;

        // Find nearest neighbor in targetCandidates
        let minD = Infinity;
        let bestTarget: SpatialPointInput | null = null;
        let bestBearing = 0;

        for (const tc of targetCandidates) {
          const m = geodesicDistanceAndBearing(centroid[0], centroid[1], tc.lon, tc.lat);
          if (m.distanceM < minD) {
            minD = m.distanceM;
            bestTarget = tc;
            bestBearing = m.bearingDeg;
          }
        }

        if (bestTarget && isFinite(minD)) {
          distances.push(minD);
          const tMeta = targetMeta.get(bestTarget.id);
          const tName = tMeta?.displayName || bestTarget.id;
          const compass = bearingToCompassDirection(bestBearing);

          pairs.push({
            sourceId: String(f.id),
            sourceName: srcName,
            sourceCoord: centroid,
            targetId: bestTarget.id,
            targetName: tName,
            targetCoord: [bestTarget.lon, bestTarget.lat],
            distanceM: minD,
            bearingDeg: Math.round(bestBearing * 10) / 10,
            compass,
            formattedDistance: formatDistanceValue(minD, distanceUnit),
          });
        }
      });

      if (pairs.length === 0) {
        notify("No nearest neighbor associations could be calculated");
        setMatrixLoading(false);
        return;
      }

      // Compute statistics
      distances.sort((a, b) => a - b);
      const minDistanceM = distances[0];
      const maxDistanceM = distances[distances.length - 1];
      const meanDistanceM = distances.reduce((a, b) => a + b, 0) / distances.length;
      const mid = Math.floor(distances.length / 2);
      const medianDistanceM =
        distances.length % 2 === 0 ? (distances[mid - 1] + distances[mid]) / 2 : distances[mid];
      const variance =
        distances.reduce((sum, d) => sum + Math.pow(d - meanDistanceM, 2), 0) / distances.length;
      const stdDevM = Math.sqrt(variance);

      const elapsedMs = performance.now() - startTime;

      setMatrixResult({
        sourceLayerName: srcLayer.name,
        targetLayerName:
          layers.find((l) => l.id === matrixTargetLayerId)?.name || matrixTargetLayerId,
        sourceCount: srcLayer.features.length,
        targetCount: targetCandidates.length,
        pairs,
        stats: {
          minDistanceM,
          maxDistanceM,
          meanDistanceM,
          medianDistanceM,
          stdDevM,
        },
        executionMs: Math.round(elapsedMs * 10) / 10,
      });

      notify(
        `Distance Matrix: matched ${pairs.length} source features in ${elapsedMs.toFixed(1)} ms`,
      );
    } catch (err) {
      notify(`Distance matrix calculation failed: ${err}`);
    } finally {
      setMatrixLoading(false);
    }
  };

  const handleExportMatrixCsv = () => {
    if (!matrixResult || matrixResult.pairs.length === 0) {
      notify("No matrix result to export");
      return;
    }

    const headers = [
      "Source_Layer",
      "Source_ID",
      "Source_Name",
      "Source_Lon",
      "Source_Lat",
      "Nearest_Target_Layer",
      "Nearest_Target_ID",
      "Nearest_Target_Name",
      "Nearest_Target_Lon",
      "Nearest_Target_Lat",
      "Distance_Meters",
      "Formatted_Distance",
      "Bearing_Degrees",
      "Compass_Direction",
    ];

    const rows = matrixResult.pairs.map((p) =>
      [
        `"${matrixResult.sourceLayerName.replace(/"/g, '""')}"`,
        p.sourceId,
        `"${p.sourceName.replace(/"/g, '""')}"`,
        p.sourceCoord[0].toFixed(6),
        p.sourceCoord[1].toFixed(6),
        `"${matrixResult.targetLayerName.replace(/"/g, '""')}"`,
        p.targetId,
        `"${p.targetName.replace(/"/g, '""')}"`,
        p.targetCoord[0].toFixed(6),
        p.targetCoord[1].toFixed(6),
        p.distanceM.toFixed(1),
        `"${p.formattedDistance}"`,
        p.bearingDeg,
        p.compass,
      ].join(","),
    );

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `distance_matrix_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify(`Exported distance matrix to CSV`);
  };

  // Render Kind Icon Helper
  const renderKindIcon = (kind: TargetKind) => {
    switch (kind) {
      case "flight":
        return <Plane size={11} className="text-sky-400" />;
      case "vessel":
        return <Ship size={11} className="text-emerald-400" />;
      case "fire":
        return <Flame size={11} className="text-amber-400" />;
      case "earthquake":
        return <Activity size={11} className="text-red-400" />;
      case "satellite":
        return <Radio size={11} className="text-purple-400" />;
      default:
        return <MapPin size={11} className="text-fuchsia-400" />;
    }
  };

  return (
    <PanelShell
      eyebrow="Proximity Analytics"
      title="k-Nearest Neighbors & Matrix"
      side="right"
      onClose={() => {
        if (isPickingKnnCenter) {
          setBufferPicker(null);
          setIsPickingKnnCenter(false);
        }
        closePanel("right");
      }}
      footer={
        <>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-accent" />
            3D ECEF Cartesian SIMD
          </span>
          <span>WGS 84 Geodesics</span>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Tabs: Single Probe vs Distance Matrix */}
        <div className="flex rounded-[2px] border border-line bg-tint p-0.5">
          <button
            type="button"
            className={cx(
              "flex-1 py-1 text-center text-[10.5px] font-semibold transition-colors rounded-[2px]",
              activeTab === "probe"
                ? "bg-solid text-ink shadow-sm"
                : "text-ink-muted hover:text-ink",
            )}
            onClick={() => setActiveTab("probe")}
          >
            Point Probe (1-to-N)
          </button>
          <button
            type="button"
            className={cx(
              "flex-1 py-1 text-center text-[10.5px] font-semibold transition-colors rounded-[2px]",
              activeTab === "matrix"
                ? "bg-solid text-ink shadow-sm"
                : "text-ink-muted hover:text-ink",
            )}
            onClick={() => setActiveTab("matrix")}
          >
            Layer Matrix (N-to-M)
          </button>
        </div>

        {activeTab === "probe" ? (
          <>
            {/* Origin Selection Section */}
            <div className="flex flex-col gap-2 rounded-[2px] border border-line bg-tint p-2.5">
              <div className="flex items-center justify-between text-[11px] font-medium text-ink">
                <span className="flex items-center gap-1.5">
                  <Crosshair size={13} className="text-accent" />
                  Query Origin Point
                </span>
                {/* Origin Mode Switcher */}
                <div className="flex items-center gap-0.5 rounded-[2px] border border-line bg-solid p-0.5 text-[9.5px]">
                  <button
                    type="button"
                    className={cx(
                      "px-1.5 py-0.5 font-semibold rounded-[2px]",
                      originMode === "map" ? "bg-accent text-on-accent" : "text-ink-muted hover:text-ink",
                    )}
                    onClick={() => setOriginMode("map")}
                  >
                    Map
                  </button>
                  <button
                    type="button"
                    className={cx(
                      "px-1.5 py-0.5 font-semibold rounded-[2px]",
                      originMode === "feature"
                        ? "bg-accent text-on-accent"
                        : "text-ink-muted hover:text-ink",
                    )}
                    onClick={() => setOriginMode("feature")}
                  >
                    Feature
                  </button>
                  <button
                    type="button"
                    className={cx(
                      "px-1.5 py-0.5 font-semibold rounded-[2px]",
                      originMode === "manual" ? "bg-accent text-on-accent" : "text-ink-muted hover:text-ink",
                    )}
                    onClick={() => setOriginMode("manual")}
                  >
                    Coords
                  </button>
                </div>
              </div>

              {/* Mode: Map Click */}
              {originMode === "map" && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={cx(
                      "flex-1 flex items-center justify-center gap-1.5 rounded-[2px] py-1 text-[11px] font-semibold transition-colors",
                      isPickingKnnCenter
                        ? "bg-accent text-on-accent animate-pulse"
                        : "bg-solid text-ink hover:text-ink-soft border border-line",
                    )}
                    onClick={toggleKnnPicker}
                  >
                    <MapPin size={12} />
                    {isPickingKnnCenter
                      ? "Click anywhere on map..."
                      : knnCenter
                      ? "Repick Origin Point"
                      : "Click Map to Probe"}
                  </button>
                </div>
              )}

              {/* Mode: Feature Origin */}
              {originMode === "feature" && (
                <div className="flex flex-col gap-1">
                  <select
                    value={selectedOriginFeatureKey}
                    onChange={(e) => applyFeatureOrigin(e.target.value)}
                    className={FIELD_INPUT}
                  >
                    <option value="">Select origin feature...</option>
                    {featureOriginOptions.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Mode: Manual Coordinates */}
              {originMode === "manual" && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Longitude"
                    value={manualLon}
                    onChange={(e) => setManualLon(e.target.value)}
                    className={cx(FIELD_INPUT, "flex-1 font-mono text-[10px]")}
                  />
                  <input
                    type="text"
                    placeholder="Latitude"
                    value={manualLat}
                    onChange={(e) => setManualLat(e.target.value)}
                    className={cx(FIELD_INPUT, "flex-1 font-mono text-[10px]")}
                  />
                  <button
                    type="button"
                    className={cx(SECONDARY_BUTTON, "px-2")}
                    onClick={applyManualCoordinates}
                  >
                    Set
                  </button>
                </div>
              )}

              {/* Active Origin Display */}
              {knnCenter && (
                <div className="flex items-center justify-between rounded-[2px] bg-solid px-2 py-1 font-mono text-[10px] text-ink-muted">
                  <span className="flex items-center gap-1 text-ink font-medium">
                    <Navigation size={10} className="text-accent" />
                    {knnCenter[1] >= 0
                      ? `${knnCenter[1].toFixed(5)}°N`
                      : `${Math.abs(knnCenter[1]).toFixed(5)}°S`}
                    ,{" "}
                    {knnCenter[0] >= 0
                      ? `${knnCenter[0].toFixed(5)}°E`
                      : `${Math.abs(knnCenter[0]).toFixed(5)}°W`}
                  </span>
                  <span className="text-[9px] text-accent font-semibold">Active Origin</span>
                </div>
              )}
            </div>

            {/* Target Source Dropdown */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-ink-muted flex items-center justify-between">
                <span>Target Candidate Feeds</span>
                <span className="text-[9px] text-ink-soft">Points & Multi-Geometry Centroids</span>
              </label>
              <select
                value={selectedKnnLayerId}
                onChange={(e) => {
                  setSelectedKnnLayerId(e.target.value);
                  if (knnCenter) {
                    executeKnnQuery(knnCenter, knnK, e.target.value, distanceUnit);
                  }
                }}
                className={FIELD_INPUT}
              >
                <optgroup label="Global Telemetry Feeds">
                  <option value="all">All Points & Real-Time Feeds</option>
                  <option value="flights">✈️ Live Flights (ADS-B / OpenSky)</option>
                  <option value="vessels">🚢 Live Vessels (AIS Marine Traffic)</option>
                  <option value="fires">🔥 Live Fires (NASA FIRMS Thermal)</option>
                  <option value="earthquakes">⚠️ Live Earthquakes (USGS Seismic)</option>
                  <option value="satellites">🌐 Live Satellites (SGP4 Propagation)</option>
                </optgroup>
                {layers.length > 0 && (
                  <optgroup label="Project Layers">
                    {layers.map((l) => (
                      <option key={l.id} value={l.id}>
                        📍 {l.name} ({l.features.length} features)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* Parameters: K Count, Units, Radius Cutoff */}
            <div className="flex flex-col gap-2 rounded-[2px] border border-line bg-tint p-2.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-medium text-ink-muted">Neighbors Count (K)</label>
                <div className="flex items-center gap-1">
                  {[1, 3, 5, 10, 20].map((kVal) => (
                    <button
                      key={kVal}
                      type="button"
                      className={cx(
                        "h-5 min-w-[22px] rounded-[2px] text-[10px] font-semibold transition-colors",
                        knnK === kVal
                          ? "bg-accent text-on-accent"
                          : "bg-solid text-ink-muted hover:text-ink border border-line",
                      )}
                      onClick={() => {
                        setKnnK(kVal);
                        setCustomKInput(String(kVal));
                        if (knnCenter) executeKnnQuery(knnCenter, kVal, selectedKnnLayerId, distanceUnit);
                      }}
                    >
                      {kVal}
                    </button>
                  ))}
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={customKInput}
                    onChange={(e) => {
                      setCustomKInput(e.target.value);
                      const parsed = parseInt(e.target.value, 10);
                      if (!isNaN(parsed) && parsed >= 1) {
                        setKnnK(parsed);
                        if (knnCenter) executeKnnQuery(knnCenter, parsed, selectedKnnLayerId, distanceUnit);
                      }
                    }}
                    className="w-11 h-5 text-center text-[10px] font-mono bg-solid border border-line rounded-[2px] text-ink"
                    title="Custom K value"
                  />
                </div>
              </div>

              {/* Distance Unit Selector */}
              <div className="flex items-center justify-between pt-1">
                <label className="text-[10px] font-medium text-ink-muted">Distance Unit</label>
                <div className="flex items-center gap-1">
                  {(["km", "m", "NM", "mi"] as DistanceUnit[]).map((u) => (
                    <button
                      key={u}
                      type="button"
                      className={cx(
                        "h-5 px-2 rounded-[2px] text-[9.5px] font-semibold transition-colors",
                        distanceUnit === u
                          ? "bg-accent text-on-accent"
                          : "bg-solid text-ink-muted hover:text-ink border border-line",
                      )}
                      onClick={() => {
                        setDistanceUnit(u);
                        if (knnCenter) executeKnnQuery(knnCenter, knnK, selectedKnnLayerId, u);
                      }}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>

              {/* Radius Cutoff Filter */}
              <div className="flex flex-col gap-1.5 pt-1 border-t border-line/60">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-[10px] font-medium text-ink">
                    <input
                      type="checkbox"
                      checked={hasRadiusCutoff}
                      onChange={(e) => {
                        setHasRadiusCutoff(e.target.checked);
                        if (knnCenter) {
                          executeKnnQuery(knnCenter, knnK, selectedKnnLayerId, distanceUnit);
                        }
                      }}
                      className="rounded-[2px] accent-accent"
                    />
                    Max Search Radius Cutoff
                  </label>
                  {hasRadiusCutoff && (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0.1"
                        step="1"
                        value={radiusCutoffValue}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setRadiusCutoffValue(isNaN(val) ? 0 : val);
                        }}
                        className="w-14 h-5 text-right px-1 text-[10px] font-mono bg-solid border border-line rounded-[2px] text-ink"
                      />
                      <span className="text-[9.5px] font-mono text-ink-muted">{distanceUnit}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Live Telemetry Watchdog Toggle */}
              <div className="flex items-center justify-between pt-1 border-t border-line/60">
                <span className="flex items-center gap-1.5 text-[10px] font-medium text-ink">
                  <Radio
                    size={11}
                    className={cx(
                      isWatchdogActive ? "text-emerald-400 animate-pulse" : "text-ink-muted",
                    )}
                  />
                  Live Telemetry Watchdog
                </span>
                <button
                  type="button"
                  className={cx(
                    "flex items-center gap-1 px-2 py-0.5 rounded-[2px] text-[9.5px] font-semibold transition-colors",
                    isWatchdogActive
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-solid text-ink-muted hover:text-ink border border-line",
                  )}
                  onClick={() => setIsWatchdogActive(!isWatchdogActive)}
                >
                  <span
                    className={cx(
                      "size-1.5 rounded-full",
                      isWatchdogActive ? "bg-emerald-400 animate-ping" : "bg-ink-muted",
                    )}
                  />
                  {isWatchdogActive ? "Active (3s)" : "Watchdog Off"}
                </button>
              </div>

              {/* Query & Clear Buttons */}
              <div className="flex items-center gap-1.5 pt-1">
                <button
                  type="button"
                  disabled={!knnCenter || knnLoading}
                  className={cx(PRIMARY_BUTTON, "flex-1")}
                  onClick={() =>
                    knnCenter && executeKnnQuery(knnCenter, knnK, selectedKnnLayerId, distanceUnit)
                  }
                >
                  {knnLoading ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      SIMD Computing...
                    </>
                  ) : (
                    <>
                      <Zap size={12} />
                      Find {knnK} Nearest
                    </>
                  )}
                </button>
                {(enrichedNeighbors.length > 0 || knnCenter) && (
                  <button
                    type="button"
                    className={SECONDARY_BUTTON}
                    onClick={clearKnn}
                    title="Clear k-NN results"
                  >
                    <Eraser size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Results Section */}
            {enrichedNeighbors.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-[11px] font-medium text-ink">
                  <span className="flex items-center gap-1.5">
                    <span>Nearest {enrichedNeighbors.length} Hits</span>
                    {hasRadiusCutoff && (
                      <span className="text-[9px] text-ink-muted">
                        (within {radiusCutoffValue} {distanceUnit})
                      </span>
                    )}
                  </span>
                  {rawKnnResult && (
                    <span className="flex items-center gap-1 text-[9.5px] font-mono text-accent">
                      <Zap size={10} />
                      {rawKnnResult.execution_micros.toFixed(1)} µs
                    </span>
                  )}
                </div>

                {/* Enriched Hits Scroll List */}
                <div className="max-h-[260px] overflow-y-auto rounded-[2px] border border-line bg-tint p-1 flex flex-col gap-1">
                  {enrichedNeighbors.map((n) => (
                    <div
                      key={n.rank}
                      className="group flex flex-col gap-1 rounded-[2px] bg-solid p-2 text-[10.5px] hover:border-accent/60 border border-line/60 transition-colors cursor-pointer"
                      onClick={() => handleNeighborClick(n)}
                      title={`Click to focus and track ${n.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 truncate max-w-[170px]">
                          <span className="font-mono text-[9px] font-bold px-1 py-0.2 rounded-[2px] bg-fuchsia-950/60 text-fuchsia-300 border border-fuchsia-800/40">
                            #{n.rank}
                          </span>
                          <span className="flex items-center gap-1 font-semibold text-ink truncate">
                            {renderKindIcon(n.kind)}
                            <span className="truncate">{n.id}</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-1 font-mono font-bold text-accent text-[11px]">
                          {n.formattedDistance}
                        </div>
                      </div>

                      {/* Direction and Details */}
                      <div className="flex items-center justify-between text-[9px] text-ink-muted">
                        <span className="flex items-center gap-1 font-mono text-ink-soft">
                          <Compass size={10} className="text-accent" />
                          {n.bearing_deg !== undefined
                            ? `${Math.round(n.bearing_deg).toString().padStart(3, "0")}° ${n.compass_direction}`
                            : ""}
                        </span>
                        <span className="font-mono text-[8.5px] text-ink-muted">
                          3D Chord: {formatDistanceValue(n.euclidean_distance_3d_m, distanceUnit)}
                        </span>
                      </div>

                      {/* Specific Feed Details Subtitle */}
                      {n.properties && (
                        <div className="text-[8.5px] text-ink-muted truncate font-mono">
                          {n.kind === "flight" && n.properties.altitudeMeters && (
                            <span>
                              Alt: {Math.round(n.properties.altitudeMeters * 3.28084)} ft · Speed:{" "}
                              {Math.round(n.properties.velocityMps * 1.94384)} kn
                            </span>
                          )}
                          {n.kind === "vessel" && (
                            <span>
                              {n.properties.shipType || "Vessel"} ·{" "}
                              {n.properties.speedKnots ? `${n.properties.speedKnots.toFixed(1)} kn` : "At Anchor"}
                            </span>
                          )}
                          {n.kind === "fire" && n.properties.frpMw && (
                            <span>
                              FRP: {n.properties.frpMw.toFixed(0)} MW · Conf: {n.properties.confidence}
                            </span>
                          )}
                          {n.kind === "earthquake" && (
                            <span>
                              Depth: {n.properties.depthKm} km · Mag: {n.properties.magnitude}
                            </span>
                          )}
                          {n.kind === "satellite" && n.properties.altitudeKm && (
                            <span>Orbit Alt: {Math.round(n.properties.altitudeKm)} km</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Save and Export Action Grid */}
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <button
                    type="button"
                    className={cx(SECONDARY_BUTTON, "flex items-center justify-center gap-1 text-[10px]")}
                    onClick={handleSaveHitsAsLayer}
                  >
                    <Save size={11} className="text-accent" />
                    Save Hits Layer
                  </button>
                  <button
                    type="button"
                    className={cx(SECONDARY_BUTTON, "flex items-center justify-center gap-1 text-[10px]")}
                    onClick={handleSaveSpokesAsLayer}
                  >
                    <Navigation size={11} className="text-accent" />
                    Save Rays Layer
                  </button>
                  <button
                    type="button"
                    className={cx(SECONDARY_BUTTON, "flex items-center justify-center gap-1 text-[10px]")}
                    onClick={handleExportCsv}
                  >
                    <FileSpreadsheet size={11} className="text-emerald-400" />
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className={cx(SECONDARY_BUTTON, "flex items-center justify-center gap-1 text-[10px]")}
                    onClick={handleExportGeoJson}
                  >
                    <Download size={11} className="text-sky-400" />
                    Export GeoJSON
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Tab 2: Layer-to-Layer Distance Matrix (Phase 5) */
          <div className="flex flex-col gap-2.5">
            <div className="rounded-[2px] border border-line bg-tint p-2.5 flex flex-col gap-2">
              <span className="text-[11px] font-medium text-ink flex items-center gap-1.5">
                <ArrowUpDown size={13} className="text-accent" />
                Pairwise Distance Matrix Setup
              </span>

              {/* Source Layer */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-ink-muted">Source Layer (Origins)</label>
                <select
                  value={matrixSourceLayerId}
                  onChange={(e) => setMatrixSourceLayerId(e.target.value)}
                  className={FIELD_INPUT}
                >
                  <option value="">Select source layer...</option>
                  {layers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.features.length} features)
                    </option>
                  ))}
                </select>
              </div>

              {/* Target Layer */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-ink-muted">
                  Target Layer (Destinations)
                </label>
                <select
                  value={matrixTargetLayerId}
                  onChange={(e) => setMatrixTargetLayerId(e.target.value)}
                  className={FIELD_INPUT}
                >
                  <option value="">Select target layer or feed...</option>
                  <optgroup label="Live Telemetry Feeds">
                    <option value="flights">✈️ Live Flights</option>
                    <option value="vessels">🚢 Live Marine Vessels</option>
                    <option value="fires">🔥 Live Fires</option>
                    <option value="earthquakes">⚠️ Live Earthquakes</option>
                    <option value="satellites">🌐 Live Satellites</option>
                  </optgroup>
                  {layers.length > 0 && (
                    <optgroup label="Project Layers">
                      {layers.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} ({l.features.length} features)
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Distance Unit */}
              <div className="flex items-center justify-between pt-1">
                <label className="text-[10px] font-medium text-ink-muted">Distance Unit</label>
                <div className="flex items-center gap-1">
                  {(["km", "m", "NM", "mi"] as DistanceUnit[]).map((u) => (
                    <button
                      key={u}
                      type="button"
                      className={cx(
                        "h-5 px-2 rounded-[2px] text-[9.5px] font-semibold transition-colors",
                        distanceUnit === u
                          ? "bg-accent text-on-accent"
                          : "bg-solid text-ink-muted hover:text-ink border border-line",
                      )}
                      onClick={() => setDistanceUnit(u)}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>

              {/* Compute Button */}
              <button
                type="button"
                disabled={!matrixSourceLayerId || !matrixTargetLayerId || matrixLoading}
                className={cx(PRIMARY_BUTTON, "mt-1")}
                onClick={executeLayerDistanceMatrix}
              >
                {matrixLoading ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Computing Matrix...
                  </>
                ) : (
                  <>
                    <BarChart3 size={12} />
                    Compute Distance Matrix
                  </>
                )}
              </button>
            </div>

            {/* Matrix Result Analytics */}
            {matrixResult && (
              <div className="flex flex-col gap-2 rounded-[2px] border border-line bg-tint p-2.5">
                <div className="flex items-center justify-between text-[11px] font-medium text-ink">
                  <span>Proximity Summary Statistics</span>
                  <span className="font-mono text-[9.5px] text-accent">
                    {matrixResult.executionMs} ms
                  </span>
                </div>

                {/* 2x2 Stats Grid */}
                <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                  <div className="rounded-[2px] bg-solid p-1.5 border border-line">
                    <span className="text-[8.5px] text-ink-muted block">Min Distance</span>
                    <span className="font-bold text-emerald-400">
                      {formatDistanceValue(matrixResult.stats.minDistanceM, distanceUnit)}
                    </span>
                  </div>
                  <div className="rounded-[2px] bg-solid p-1.5 border border-line">
                    <span className="text-[8.5px] text-ink-muted block">Max Distance</span>
                    <span className="font-bold text-amber-400">
                      {formatDistanceValue(matrixResult.stats.maxDistanceM, distanceUnit)}
                    </span>
                  </div>
                  <div className="rounded-[2px] bg-solid p-1.5 border border-line">
                    <span className="text-[8.5px] text-ink-muted block">Mean (Average)</span>
                    <span className="font-bold text-sky-400">
                      {formatDistanceValue(matrixResult.stats.meanDistanceM, distanceUnit)}
                    </span>
                  </div>
                  <div className="rounded-[2px] bg-solid p-1.5 border border-line">
                    <span className="text-[8.5px] text-ink-muted block">Median Distance</span>
                    <span className="font-bold text-purple-400">
                      {formatDistanceValue(matrixResult.stats.medianDistanceM, distanceUnit)}
                    </span>
                  </div>
                </div>

                {/* Top Pairs List */}
                <div className="flex items-center justify-between text-[10.5px] font-medium text-ink pt-1">
                  <span>Pairs Computed ({matrixResult.pairs.length})</span>
                </div>

                <div className="max-h-[160px] overflow-y-auto rounded-[2px] border border-line bg-solid p-1 flex flex-col gap-1">
                  {matrixResult.pairs.slice(0, 50).map((p, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-[9.5px] p-1 rounded-[2px] hover:bg-tint border border-transparent hover:border-line"
                    >
                      <span className="truncate max-w-[130px] font-medium text-ink" title={p.sourceName}>
                        {p.sourceName}
                      </span>
                      <span className="font-mono text-ink-soft text-[9px]">
                        → {p.targetName.slice(0, 15)}
                      </span>
                      <span className="font-mono font-semibold text-accent">
                        {p.formattedDistance}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Export Matrix Button */}
                <button
                  type="button"
                  className={cx(SECONDARY_BUTTON, "flex items-center justify-center gap-1 text-[10px]")}
                  onClick={handleExportMatrixCsv}
                >
                  <FileSpreadsheet size={11} className="text-emerald-400" />
                  Export Distance Matrix CSV
                </button>
              </div>
            )}
          </div>
        )}

        <InfoNote>
          Transforms geodetic WGS 84 coordinates to 3D Earth-Centered Earth-Fixed (ECEF) Cartesian
          space, executing $O(\log N)$ SIMD-accelerated k-d tree spatial queries with zero polar or
          antimeridian boundary distortion.
        </InfoNote>
      </div>
    </PanelShell>
  );
}
