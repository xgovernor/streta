import { useState } from "react";
import {
  Check,
  CheckCircle2,
  Compass,
  Copy,
  Crosshair,
  Eraser,
  Hexagon,
  Layers,
  Loader2,
  MapPin,
  Mountain,
  Radar,
  Ruler,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  clearBufferOverlay,
  clearMeasureSketch,
  flyToCoordinate,
  measureCoordinates,
  renderBooleanOverlay,
  renderBufferOverlay,
  renderKnnOverlay,
  setBufferPicker,
} from "../../map/mapController";
import { cx } from "../../lib/cx";
import { formatArea, formatDistance } from "../../lib/format";
import {
  computeElevationProfile,
  polygonBooleanOperation,
  spatialBufferQuery,
  spatialKnnQuery,
  type BooleanOpSummary,
  type ElevationProfileResult,
  type KnnQueryResult,
  type SpatialPointInput,
  type SpatialQueryResult,
} from "../../lib/gis/tiledBackend";
import { useProjectStore } from "../../state/projectStore";
import { useTelemetryStore } from "../../state/telemetryStore";
import { useUiStore, type AnalysisTab } from "../../state/uiStore";
import { createDataset, uniqueDatasetName } from "../../lib/gis/datasets";
import { createLayer, uniqueLayerName } from "../../lib/gis/layers";
import { GEOGRAPHIC_CRS } from "../../lib/gis/crs";
import type { FeatureRecord } from "../../lib/gis/types";
import { PanelShell } from "../PanelShell";
import {
  FIELD_INPUT,
  InfoNote,
  KeyValue,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SectionLabel,
} from "./shared";
import { ElevationChart } from "../analysis/ElevationChart";

const MODES = [
  { id: "distance" as const, label: "Dist", icon: Ruler },
  { id: "area" as const, label: "Area", icon: Hexagon },
  { id: "elevation" as const, label: "Elev", icon: Mountain },
  { id: "buffer" as const, label: "Buffer", icon: Radar },
  { id: "knn" as const, label: "k-NN", icon: Crosshair },
  { id: "boolean" as const, label: "CAG", icon: Layers },
];




function bearingToDirection(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  const directions = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  const index = Math.round(normalized / 22.5) % 16;
  return directions[index];
}

export function MeasurePanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const notify = useUiStore((state) => state.notify);
  const measureMode = useProjectStore((state) => state.measureMode);
  const setMeasureMode = useProjectStore((state) => state.setMeasureMode);
  const summary = useProjectStore((state) => state.measureSummary);
  const layers = useProjectStore((state) => state.layers);

  const activeTab = useUiStore((state) => state.analysisTab);
  const setActiveTab = useUiStore((state) => state.setAnalysisTab);

  // Elevation Profile state
  const [elevationResult, setElevationResult] = useState<ElevationProfileResult | null>(null);
  const [elevationLoading, setElevationLoading] = useState(false);
  const [sampleCount, setSampleCount] = useState<number>(40);

  // Buffer & Proximity Query state
  const [bufferCenter, setBufferCenter] = useState<[number, number] | null>(null);
  const [bufferRadius, setBufferRadius] = useState<number>(5000);
  const [isPickingCenter, setIsPickingCenter] = useState(false);
  const [bufferLoading, setBufferLoading] = useState(false);
  const [bufferResult, setBufferResult] = useState<SpatialQueryResult | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string>("all");

  // k-NN Spatial Query state
  const [knnCenter, setKnnCenter] = useState<[number, number] | null>(null);
  const [knnK, setKnnK] = useState<number>(5);
  const [isPickingKnnCenter, setIsPickingKnnCenter] = useState(false);
  const [knnLoading, setKnnLoading] = useState(false);
  const [knnResult, setKnnResult] = useState<KnnQueryResult | null>(null);
  const [selectedKnnLayerId, setSelectedKnnLayerId] = useState<string>("all");

  // Boolean CAG state
  const [booleanOp, setBooleanOp] = useState<"intersection" | "union" | "difference" | "xor">("intersection");
  const [booleanLayerA, setBooleanLayerA] = useState<string>("");
  const [booleanLayerB, setBooleanLayerB] = useState<string>("");
  const [booleanLoading, setBooleanLoading] = useState(false);
  const [booleanResult, setBooleanResult] = useState<BooleanOpSummary | null>(null);

  const copyVertices = async () => {
    const coordinates = measureCoordinates();

    if (!coordinates.length) {
      notify("Nothing measured yet");
      return;
    }

    const text = coordinates
      .map(([lon, lat]) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`)
      .join("\n");

    try {
      await navigator.clipboard.writeText(text);
      notify(`${coordinates.length} vertices copied`);
    } catch {
      notify("Clipboard is not available in this window.");
    }
  };

  const handleSliceElevation = async () => {
    const coords = measureCoordinates();
    if (coords.length < 2) {
      notify("Draw at least 2 points on the map first");
      return;
    }

    setElevationLoading(true);
    setActiveTab("elevation");
    try {
      const res = await computeElevationProfile(coords, sampleCount);
      if (res) {
        setElevationResult(res);
        notify(`Copernicus DEM GLO-90 sampled ${res.samples.length} points`);
      } else {
        notify("Failed to sample elevation profile");
      }
    } catch (err) {
      notify(`Elevation error: ${err}`);
    } finally {
      setElevationLoading(false);
    }
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
        executeBufferQuery(coord, bufferRadius, selectedLayerId);
      });
    }
  };

  const executeBufferQuery = async (
    center: [number, number],
    radiusMeters: number,
    targetLayer: string,
  ) => {
    setBufferLoading(true);
    try {
      const layerIds = targetLayer === "all" ? undefined : [targetLayer];
      const res = await spatialBufferQuery(center[0], center[1], radiusMeters, layerIds);
      if (res) {
        setBufferResult(res);
        renderBufferOverlay(res.buffer_geojson, center, radiusMeters);
        notify(`Found ${res.total_hits} features within ${(radiusMeters / 1000).toFixed(1)} km`);
      } else {
        notify("Buffer query returned no results");
      }
    } catch (err) {
      notify(`Buffer query error: ${err}`);
    } finally {
      setBufferLoading(false);
    }
  };

  const clearBuffer = () => {
    clearBufferOverlay();
    setBufferResult(null);
    setBufferCenter(null);
    if (isPickingCenter) {
      setBufferPicker(null);
      setIsPickingCenter(false);
    }
    notify("Buffer query cleared");
  };

  // k-NN Handlers
  const toggleKnnPicker = () => {
    if (isPickingKnnCenter) {
      setBufferPicker(null);
      setIsPickingKnnCenter(false);
    } else {
      setIsPickingKnnCenter(true);
      notify("Click anywhere on the map to probe k-NN nearest neighbors");
      setBufferPicker((coord) => {
        setKnnCenter(coord);
        setIsPickingKnnCenter(false);
        setBufferPicker(null);
        executeKnnQuery(coord, knnK, selectedKnnLayerId);
      });
    }
  };

  const executeKnnQuery = async (
    center: [number, number],
    kVal: number,
    targetLayer: string,
  ) => {
    setKnnLoading(true);
    try {
      const candidates: SpatialPointInput[] = [];

      layers.forEach((l) => {
        if (targetLayer !== "all" && l.id !== targetLayer) return;
        l.features.forEach((f) => {
          if (f.geometry.type === "Point") {
            const coords = f.geometry.coordinates as [number, number];
            const name = (f.properties?.name as string) || (f.properties?.title as string) || f.id;
            candidates.push({ id: name, lon: coords[0], lat: coords[1] });
          }
        });
      });

      if (targetLayer === "all" || targetLayer === "flights") {
        const flights = useTelemetryStore.getState().flights;
        flights.forEach((f) => {
          candidates.push({ id: `Flight ${f.callsign || f.icao24}`, lon: f.longitude, lat: f.latitude });
        });
      }

      if (targetLayer === "all" || targetLayer === "earthquakes") {
        const quakes = useTelemetryStore.getState().earthquakes;
        quakes.forEach((q) => {
          candidates.push({ id: `M${q.magnitude.toFixed(1)} ${q.place}`, lon: q.longitude, lat: q.latitude });
        });
      }

      if (targetLayer === "all" || targetLayer === "satellites") {
        const sats = useTelemetryStore.getState().satellites;
        sats.forEach((s) => {
          candidates.push({ id: s.name, lon: s.longitude, lat: s.latitude });
        });
      }

      if (candidates.length === 0) {
        notify("No point features or telemetry targets available to query");
        return;
      }

      const res = await spatialKnnQuery(candidates, center[0], center[1], undefined, kVal);
      if (res && res.neighbors.length > 0) {
        setKnnResult(res);
        renderKnnOverlay(center, res.neighbors);
        notify(`k-NN: found ${res.neighbors.length} neighbors in ${res.execution_micros.toFixed(1)} µs`);
      } else {
        notify("k-NN query returned no neighbors");
      }
    } catch (err) {
      notify(`k-NN query error: ${err}`);
    } finally {
      setKnnLoading(false);
    }
  };

  const clearKnn = () => {
    clearBufferOverlay();
    setKnnResult(null);
    setKnnCenter(null);
    if (isPickingKnnCenter) {
      setBufferPicker(null);
      setIsPickingKnnCenter(false);
    }
    notify("k-NN query cleared");
  };

  // Boolean CAG Handlers
  const executeBooleanOp = async () => {
    if (!booleanLayerA || !booleanLayerB) {
      notify("Select two layers for Boolean operation");
      return;
    }
    if (booleanLayerA === booleanLayerB) {
      notify("Select two different layers");
      return;
    }

    const layerA = layers.find((l) => l.id === booleanLayerA);
    const layerB = layers.find((l) => l.id === booleanLayerB);
    if (!layerA || !layerB) {
      notify("Layer not found");
      return;
    }

    const polyA = layerA.features.filter((f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon");
    const polyB = layerB.features.filter((f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon");

    if (polyA.length === 0 || polyB.length === 0) {
      notify("Both layers must contain at least one Polygon or MultiPolygon");
      return;
    }

    setBooleanLoading(true);
    try {
      const geomA = polyA[0].geometry;
      const geomB = polyB[0].geometry;

      const res = await polygonBooleanOperation(booleanOp, geomA, geomB);
      if (res) {
        setBooleanResult(res);
        renderBooleanOverlay(res.geojson);
        notify(`Boolean ${booleanOp}: ${res.polygon_count} polygon(s) (${(res.total_area_sq_m / 1e6).toFixed(2)} km²)`);
      } else {
        notify("Boolean operation returned no result");
      }
    } catch (err) {
      notify(`Boolean operation error: ${err}`);
    } finally {
      setBooleanLoading(false);
    }
  };

  const saveBooleanResultAsLayer = () => {
    if (!booleanResult || !booleanResult.geojson) {
      notify("No Boolean result to save");
      return;
    }

    const projectStore = useProjectStore.getState();
    const existingDatasetNames = projectStore.datasets.map((d) => d.name);
    const datasetName = uniqueDatasetName(existingDatasetNames, `Boolean ${booleanOp.toUpperCase()}`);
    const dataset = createDataset({
      name: datasetName,
      kind: "file",
      order: projectStore.datasets.length,
    });

    const features: FeatureRecord[] = (booleanResult.geojson.features || []).map((f: any, idx: number) => ({
      id: f.id || `bool_${idx}`,
      geometry: f.geometry,
      properties: f.properties || {},
    }));

    const existingLayerNames = projectStore.layers.map((l) => l.name);
    const layerName = uniqueLayerName(existingLayerNames, `${booleanOp.toUpperCase()} result`);
    const newLayer = createLayer({
      datasetId: dataset.id,
      name: layerName,
      features,
      crs: GEOGRAPHIC_CRS,
      format: "geojson",
      source: "derived",
      order: 0,
      style: {
        color: "#10b981",
        strokeWidth: 2,
        fillOpacity: 0.25,
      },
    });

    projectStore.addDataset(dataset, [newLayer]);
    notify(`Saved new layer: "${layerName}" (${features.length} polygons)`);
  };

  const clearBoolean = () => {
    clearBufferOverlay();
    setBooleanResult(null);
    notify("Boolean operation overlay cleared");
  };

  const handleTabChange = (tab: AnalysisTab) => {
    setActiveTab(tab);
    if (tab === "distance") {
      setMeasureMode("distance");
    } else if (tab === "area") {
      setMeasureMode("area");
    } else {
      setMeasureMode("off");
    }
  };

  const details = summary?.geodesicDetails;

  return (
    <PanelShell
      eyebrow="Analysis"
      title="Analytical Workbench"
      side="right"
      onClose={() => {
        if (isPickingCenter) {
          setBufferPicker(null);
          setIsPickingCenter(false);
        }
        if (isPickingKnnCenter) {
          setBufferPicker(null);
          setIsPickingKnnCenter(false);
        }
        closePanel();
      }}
      footer={
        <>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-cyan-400" />
            WGS 84 Ellipsoidal
          </span>
          <span className="capitalize">{activeTab} ({measureMode === "off" ? "idle" : "drawing"})</span>
        </>
      }
    >
      {/* Tab Switcher */}
      <SectionLabel>Analytical Tool</SectionLabel>
      <div className="grid grid-cols-6 gap-0.5 rounded-lg border border-line bg-tint p-0.5">
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const active = activeTab === mode.id;


          return (
            <button
              key={mode.id}
              type="button"
              className={cx(
                "flex h-[26px] items-center justify-center gap-[4px] rounded-md text-[10px] font-semibold transition-colors",
                active
                  ? "bg-solid text-cyan-400 shadow-sm"
                  : "text-ink-muted hover:text-ink",
              )}
              aria-pressed={active}
              onClick={() => handleTabChange(mode.id)}
            >
              <Icon size={12} strokeWidth={2} aria-hidden="true" />
              {mode.label}
            </button>
          );
        })}
      </div>

      {/* ==================================================================== */}
      {/* 1. DISTANCE TAB */}
      {/* ==================================================================== */}
      {activeTab === "distance" && (
        <div className="flex flex-col gap-3">
          <SectionLabel>Ellipsoidal Metrics</SectionLabel>
          <div className="flex flex-col gap-[6px] rounded-lg border border-line bg-tint/40 p-2.5">
            <KeyValue
              label="Total Distance"
              value={
                details ? (
                  <span className="font-mono font-semibold text-cyan-400">
                    {details.total_distance_km.toFixed(3)} km
                  </span>
                ) : summary ? (
                  formatDistance(summary.distance)
                ) : (
                  "—"
                )
              }
            />
            {details && (
              <>
                <KeyValue
                  label="Statute Miles"
                  value={
                    <span className="font-mono text-ink">
                      {details.total_distance_miles.toFixed(2)} mi
                    </span>
                  }
                />
                <KeyValue
                  label="Nautical Miles"
                  value={
                    <span className="font-mono text-ink">
                      {details.total_distance_nmi.toFixed(2)} nmi
                    </span>
                  }
                />
              </>
            )}
            <KeyValue
              label="Vertices"
              value={summary ? `${summary.vertices}` : "—"}
            />
          </div>

          {/* Segment Azimuth Bearings */}
          {details && details.segments.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <SectionLabel trailing={<span className="text-[9px] lowercase font-normal">({details.segments.length} legs)</span>}>
                Segment Bearings (Karney Geodesic)
              </SectionLabel>
              <div className="max-h-[140px] overflow-y-auto rounded-lg border border-line bg-tint/30 p-1.5 flex flex-col gap-1">
                {details.segments.map((seg, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-md bg-solid/60 px-2 py-1 text-[10px]"
                  >
                    <span className="font-mono text-ink-muted">#{idx + 1}</span>
                    <span className="font-mono text-ink">
                      {formatDistance(seg.distance_m)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-0.5 rounded bg-cyan-950/60 px-1 py-0.5 font-mono text-[9.5px] font-medium text-cyan-300 border border-cyan-800/40">
                        <Compass size={10} className="text-cyan-400" />
                        {seg.forward_bearing_deg.toFixed(0)}° {bearingToDirection(seg.forward_bearing_deg)}
                      </span>
                      <span className="font-mono text-[9px] text-ink-muted" title="Reverse Back-Bearing">
                        ↩ {seg.reverse_bearing_deg.toFixed(0)}°
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              className={SECONDARY_BUTTON}
              onClick={() => void copyVertices()}
            >
              <Copy size={13} strokeWidth={1.9} aria-hidden="true" />
              Copy points
            </button>
            <button
              type="button"
              className={SECONDARY_BUTTON}
              onClick={() => {
                clearMeasureSketch();
                notify("Measurement cleared");
              }}
            >
              <Eraser size={13} strokeWidth={1.9} aria-hidden="true" />
              Clear
            </button>
          </div>

          {summary && summary.vertices >= 2 && (
            <button
              type="button"
              className={cx(PRIMARY_BUTTON, "w-full gap-2")}
              onClick={handleSliceElevation}
              disabled={elevationLoading}
            >
              {elevationLoading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Mountain size={13} strokeWidth={2} />
              )}
              Slice Elevation Profile
            </button>
          )}

          <InfoNote>
            Click the map to add vertices; double-click to finish. All lengths and bearings are solved via Charles Karney's exact geodesic algorithms on the WGS 84 ellipsoid.
          </InfoNote>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 2. AREA TAB */}
      {/* ==================================================================== */}
      {activeTab === "area" && (
        <div className="flex flex-col gap-3">
          <SectionLabel>Geodesic Polygon Metrics</SectionLabel>
          <div className="flex flex-col gap-[6px] rounded-lg border border-line bg-tint/40 p-2.5">
            <KeyValue
              label="Area (sq km)"
              value={
                details?.area_sq_km != null ? (
                  <span className="font-mono font-semibold text-cyan-400">
                    {details.area_sq_km.toFixed(3)} km²
                  </span>
                ) : summary ? (
                  formatArea(summary.area)
                ) : (
                  "—"
                )
              }
            />
            {details?.area_hectares != null && (
              <KeyValue
                label="Hectares"
                value={
                  <span className="font-mono text-ink">
                    {details.area_hectares.toFixed(2)} ha
                  </span>
                }
              />
            )}
            {details?.area_acres != null && (
              <KeyValue
                label="Acres"
                value={
                  <span className="font-mono text-ink">
                    {details.area_acres.toFixed(2)} ac
                  </span>
                }
              />
            )}
            <KeyValue
              label="Perimeter"
              value={
                details?.perimeter_m != null ? (
                  formatDistance(details.perimeter_m)
                ) : summary ? (
                  formatDistance(summary.distance)
                ) : (
                  "—"
                )
              }
            />
            {details?.centroid && (
              <KeyValue
                label="Centroid"
                value={
                  <span className="font-mono text-[9.5px] text-ink-soft">
                    {details.centroid[1].toFixed(4)}°N, {details.centroid[0].toFixed(4)}°E
                  </span>
                }
              />
            )}
            <KeyValue
              label="Vertices"
              value={summary ? `${summary.vertices}` : "—"}
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              className={SECONDARY_BUTTON}
              onClick={() => void copyVertices()}
            >
              <Copy size={13} strokeWidth={1.9} aria-hidden="true" />
              Copy polygon
            </button>
            <button
              type="button"
              className={SECONDARY_BUTTON}
              onClick={() => {
                clearMeasureSketch();
                notify("Measurement cleared");
              }}
            >
              <Eraser size={13} strokeWidth={1.9} aria-hidden="true" />
              Clear
            </button>
          </div>

          <InfoNote>
            Click to plot polygon vertices, double-click to close ring. Spherical ellipsoidal area accounts for Earth's curvature across arbitrary latitudes without planar distortion.
          </InfoNote>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 3. ELEVATION TAB */}
      {/* ==================================================================== */}
      {activeTab === "elevation" && (
        <div className="flex flex-col gap-3">
          <SectionLabel>Copernicus DEM GLO-90 Slicer</SectionLabel>

          <div className="flex items-center justify-between rounded-lg border border-line bg-tint/40 p-2 text-[10.5px]">
            <span className="text-ink-muted">Sampling Density</span>
            <div className="flex gap-1">
              {[20, 40, 80].map((count) => (
                <button
                  key={count}
                  type="button"
                  className={cx(
                    "rounded px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors",
                    sampleCount === count
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                      : "bg-solid text-ink-muted hover:text-ink",
                  )}
                  onClick={() => setSampleCount(count)}
                >
                  {count} pts
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className={cx(PRIMARY_BUTTON, "w-full gap-2")}
            onClick={handleSliceElevation}
            disabled={elevationLoading}
          >
            {elevationLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <TrendingUp size={13} strokeWidth={2} />
            )}
            Sample Path Elevation
          </button>

          {elevationResult && (
            <div className="flex flex-col gap-2">
              <ElevationChart data={elevationResult} />
              <div className="flex justify-end">
                <button
                  type="button"
                  className={cx(SECONDARY_BUTTON, "text-[10px] h-[24px]")}
                  onClick={async () => {
                    const csv = [
                      "distance_km,elevation_m,latitude,longitude",
                      ...elevationResult.samples.map(
                        (s) =>
                          `${(s.distance_m / 1000).toFixed(3)},${s.elevation_m.toFixed(1)},${s.lat.toFixed(5)},${s.lon.toFixed(5)}`,
                      ),
                    ].join("\n");
                    await navigator.clipboard.writeText(csv);
                    notify("Elevation CSV copied to clipboard");
                  }}
                >
                  <Copy size={11} /> Copy Profile CSV
                </button>
              </div>
            </div>
          )}

          {!elevationResult && (
            <InfoNote>
              Draw a path on the map using the Distance tool, then click "Sample Path Elevation" to slice global elevations from Copernicus DEM GLO-90.
            </InfoNote>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* 4. PROXIMITY BUFFER TAB */}
      {/* ==================================================================== */}
      {activeTab === "buffer" && (
        <div className="flex flex-col gap-3">
          <SectionLabel>Geodesic Proximity Query</SectionLabel>

          {/* Center Point Picker */}
          <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-tint/40 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] text-ink-muted">Center Point</span>
              <button
                type="button"
                className={cx(
                  "inline-flex h-[22px] items-center gap-1 rounded px-2 text-[10px] font-medium transition-colors",
                  isPickingCenter
                    ? "bg-cyan-500 text-black font-semibold animate-pulse"
                    : "bg-solid text-cyan-400 hover:text-cyan-300 border border-line",
                )}
                onClick={toggleCenterPicker}
              >
                <Crosshair size={11} />
                {isPickingCenter ? "Click Map..." : "Pick on Map"}
              </button>
            </div>
            <div className="font-mono text-[11px] text-ink">
              {bufferCenter ? (
                <span className="flex items-center gap-1 text-cyan-400">
                  <MapPin size={12} />
                  {bufferCenter[1].toFixed(4)}°N, {bufferCenter[0].toFixed(4)}°E
                </span>
              ) : (
                <span className="text-ink-muted">No center chosen yet</span>
              )}
            </div>
          </div>

          {/* Radius Selector */}
          <div className="flex flex-col gap-1.5">
            <SectionLabel>Buffer Radius</SectionLabel>
            <div className="grid grid-cols-4 gap-1">
              {[500, 1000, 5000, 25000].map((r) => (
                <button
                  key={r}
                  type="button"
                  className={cx(
                    "rounded border py-1 text-[10px] font-mono transition-colors",
                    bufferRadius === r
                      ? "border-cyan-500 bg-cyan-950/40 text-cyan-300 font-semibold"
                      : "border-line bg-solid text-ink-muted hover:text-ink",
                  )}
                  onClick={() => {
                    setBufferRadius(r);
                    if (bufferCenter) {
                      executeBufferQuery(bufferCenter, r, selectedLayerId);
                    }
                  }}
                >
                  {r >= 1000 ? `${r / 1000} km` : `${r} m`}
                </button>
              ))}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min="50"
                max="500000"
                step="100"
                value={bufferRadius}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (val > 0) setBufferRadius(val);
                }}
                className={FIELD_INPUT}
                placeholder="Radius in meters"
              />
              <span className="shrink-0 text-[10.5px] font-mono text-ink-muted">m</span>
            </div>
          </div>

          {/* Target Layer Filter */}
          <div className="flex flex-col gap-1.5">
            <SectionLabel>Target Dataset</SectionLabel>
            <select
              value={selectedLayerId}
              onChange={(e) => {
                setSelectedLayerId(e.target.value);
                if (bufferCenter) {
                  executeBufferQuery(bufferCenter, bufferRadius, e.target.value);
                }
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

          {/* Query Action Button */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              className={cx(PRIMARY_BUTTON, "gap-1.5")}
              disabled={!bufferCenter || bufferLoading}
              onClick={() => {
                if (bufferCenter) {
                  executeBufferQuery(bufferCenter, bufferRadius, selectedLayerId);
                }
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

          {/* Hit Results */}
          {bufferResult && (
            <div className="flex flex-col gap-1.5">
              <SectionLabel trailing={<span className="text-cyan-400 font-mono font-semibold">({bufferResult.total_hits} hits)</span>}>
                Ranked Spatial Intersections
              </SectionLabel>
              {bufferResult.hits.length === 0 ? (
                <div className="rounded-md border border-line bg-tint/20 py-4 text-center text-[10.5px] text-ink-muted">
                  No features intercepted within this buffer.
                </div>
              ) : (
                <div className="max-h-[220px] overflow-y-auto rounded-lg border border-line bg-tint/30 p-1 flex flex-col gap-1">
                  {bufferResult.hits.map((hit, idx) => {
                    const layer = layers.find((l) => l.id === hit.layer_id);
                    const name =
                      (hit.properties?.name as string) ||
                      (hit.properties?.title as string) ||
                      (hit.properties?.id as string) ||
                      hit.feature_id ||
                      `Feature #${idx + 1}`;

                    return (
                      <div
                        key={idx}
                        className="group flex flex-col gap-1 rounded-md bg-solid/80 p-2 text-[10.5px] hover:border-cyan-500/40 border border-transparent transition-colors cursor-pointer"
                        onClick={() => {
                          const props = hit.properties;
                          const lon = Number(props?.longitude ?? props?.lon ?? bufferResult.center_lon);
                          const lat = Number(props?.latitude ?? props?.lat ?? bufferResult.center_lat);
                          flyToCoordinate(lon, lat, 15);
                          notify(`Centered on ${name}`);
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-ink truncate max-w-[170px]" title={name}>
                            {name}
                          </span>
                          <span className="font-mono text-cyan-400 font-medium">
                            {formatDistance(hit.distance_m)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[9px] text-ink-muted">
                          <span className="flex items-center gap-1">
                            <span
                              className="size-1.5 rounded-full"
                              style={{ backgroundColor: layer?.style?.color || "#06b6d4" }}
                            />
                            {layer?.name || hit.layer_id}
                          </span>
                          <span className="font-mono">
                            {hit.bearing_deg.toFixed(0)}° {bearingToDirection(hit.bearing_deg)}
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
            Constructs a 64-vertex true geodesic buffer polygon on WGS 84, scans the spatial index, and calculates exact ellipsoidal distances and azimuth bearings to all intercepted features.
          </InfoNote>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 5. k-NN NEAREST NEIGHBORS TAB */}
      {/* ==================================================================== */}
      {activeTab === "knn" && (
        <div className="flex flex-col gap-3">
          <SectionLabel>SIMD Nearest-Neighbor Engine</SectionLabel>

          <div className="flex flex-col gap-2 rounded-lg border border-line bg-tint/40 p-2.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-ink">
              <span className="flex items-center gap-1.5">
                <Crosshair size={13} className="text-fuchsia-400" />
                Query Probe Origin
              </span>
              <button
                type="button"
                className={cx(
                  "flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold transition-colors",
                  isPickingKnnCenter
                    ? "bg-fuchsia-500 text-white animate-pulse"
                    : "bg-solid text-fuchsia-400 hover:text-fuchsia-300 border border-line",
                )}
                onClick={toggleKnnPicker}
              >
                <MapPin size={10} />
                {isPickingKnnCenter ? "Click Map..." : knnCenter ? "Repick Point" : "Pick on Map"}
              </button>
            </div>

            {knnCenter ? (
              <div className="flex items-center justify-between rounded bg-solid/60 px-2 py-1 font-mono text-[10px] text-ink-muted">
                <span>{knnCenter[1].toFixed(5)}°N, {knnCenter[0].toFixed(5)}°E</span>
                <span className="text-[9px] text-fuchsia-400 font-semibold">Origin Active</span>
              </div>
            ) : (
              <p className="text-[10px] text-ink-muted">
                Click anywhere on the globe to calculate sub-microsecond nearest neighbors in 3D ECEF space.
              </p>
            )}

            {/* Target Source Dropdown */}
            <div className="flex flex-col gap-1 pt-1">
              <label className="text-[10px] font-medium text-ink-muted">Target Layer / Source</label>
              <select
                value={selectedKnnLayerId}
                onChange={(e) => setSelectedKnnLayerId(e.target.value)}
                className={FIELD_INPUT}
              >
                <option value="all">All Points & Live Telemetry</option>
                <option value="flights">Live Flights (ADS-B)</option>
                <option value="earthquakes">Live Earthquakes (USGS)</option>
                <option value="satellites">Live Satellites (SGP4)</option>
                {layers
                  .filter((l) => l.geometryKind === "point" || l.geometryKind === "mixed")
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </div>

            {/* K Neighbors Count Selector */}
            <div className="flex items-center justify-between pt-1">
              <label className="text-[10px] font-medium text-ink-muted">Neighbors Count (K)</label>
              <div className="flex items-center gap-1">
                {[1, 3, 5, 10, 20].map((kVal) => (
                  <button
                    key={kVal}
                    type="button"
                    className={cx(
                      "h-5 min-w-[22px] rounded text-[10px] font-semibold transition-colors",
                      knnK === kVal
                        ? "bg-fuchsia-600 text-white"
                        : "bg-solid text-ink-muted hover:text-ink border border-line",
                    )}
                    onClick={() => {
                      setKnnK(kVal);
                      if (knnCenter) executeKnnQuery(knnCenter, kVal, selectedKnnLayerId);
                    }}
                  >
                    {kVal}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1.5 pt-1">
              <button
                type="button"
                disabled={!knnCenter || knnLoading}
                className={cx(PRIMARY_BUTTON, "flex-1 !bg-fuchsia-600 hover:!bg-fuchsia-500 text-white")}
                onClick={() => knnCenter && executeKnnQuery(knnCenter, knnK, selectedKnnLayerId)}
              >
                {knnLoading ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Querying SIMD...
                  </>
                ) : (
                  <>
                    <Zap size={12} />
                    Find {knnK} Nearest
                  </>
                )}
              </button>
              {knnResult && (
                <button type="button" className={SECONDARY_BUTTON} onClick={clearKnn} title="Clear results">
                  <Eraser size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Results List */}
          {knnResult && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] font-medium text-ink">
                <span>Nearest {knnResult.neighbors.length} Neighbors</span>
                <span className="flex items-center gap-1 text-[9.5px] font-mono text-fuchsia-400">
                  <Zap size={10} />
                  {knnResult.execution_micros.toFixed(1)} µs
                </span>
              </div>

              <div className="max-h-[240px] overflow-y-auto rounded-lg border border-line bg-tint/30 p-1 flex flex-col gap-1">
                {knnResult.neighbors.map((n, idx) => (
                  <div
                    key={idx}
                    className="group flex flex-col gap-1 rounded-md bg-solid/80 p-2 text-[10.5px] hover:border-fuchsia-500/50 border border-transparent transition-colors cursor-pointer"
                    onClick={() => {
                      flyToCoordinate(n.lon, n.lat, 15);
                      notify(`Focused on #${idx + 1}: ${n.id}`);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-ink truncate max-w-[170px]" title={n.id}>
                        <span className="mr-1.5 font-mono text-[9.5px] text-fuchsia-400 font-bold">
                          #{idx + 1}
                        </span>
                        {n.id}
                      </span>
                      <span className="font-mono text-fuchsia-400 font-semibold">
                        {n.surface_distance_m >= 1000
                          ? `${(n.surface_distance_m / 1000).toFixed(2)} km`
                          : `${Math.round(n.surface_distance_m)} m`}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[9px] text-ink-muted">
                      <span className="font-mono">
                        {n.lat.toFixed(4)}°N, {n.lon.toFixed(4)}°E
                      </span>
                      <span className="font-mono text-[8.5px]">
                        3D chord: {(n.euclidean_distance_3d_m >= 1000 ? `${(n.euclidean_distance_3d_m / 1000).toFixed(1)}km` : `${Math.round(n.euclidean_distance_3d_m)}m`)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <InfoNote>
            Transforms coordinates to 3D Earth-Centered Earth-Fixed (ECEF) Cartesian space, querying an immutable k-d tree via AVX2/NEON SIMD vector instructions with sub-microsecond latency. Avoids polar distortion and antimeridian wraparound discontinuities.
          </InfoNote>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 6. CONSTRUCTIVE AREA GEOMETRY (CAG) BOOLEAN OPS TAB */}
      {/* ==================================================================== */}
      {activeTab === "boolean" && (
        <div className="flex flex-col gap-3">
          <SectionLabel>Polygon Boolean Operations</SectionLabel>

          <div className="flex flex-col gap-2 rounded-lg border border-line bg-tint/40 p-2.5">
            {/* Operation Type Buttons */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-ink-muted">Operation Type</label>
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    { id: "intersection", label: "Intersect" },
                    { id: "union", label: "Union" },
                    { id: "difference", label: "Diff (A-B)" },
                    { id: "xor", label: "XOR" },
                  ] as const
                ).map((op) => (
                  <button
                    key={op.id}
                    type="button"
                    className={cx(
                      "h-6 rounded text-[10px] font-semibold transition-colors",
                      booleanOp === op.id
                        ? "bg-emerald-600 text-white"
                        : "bg-solid text-ink-muted hover:text-ink border border-line",
                    )}
                    onClick={() => setBooleanOp(op.id)}
                  >
                    {op.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Layer A Select */}
            <div className="flex flex-col gap-1 pt-1">
              <label className="text-[10px] font-medium text-ink-muted">Layer A (Base Polygon)</label>
              <select
                value={booleanLayerA}
                onChange={(e) => setBooleanLayerA(e.target.value)}
                className={FIELD_INPUT}
              >
                <option value="">Select Polygon Layer A...</option>
                {layers
                  .filter((l) => l.geometryKind === "polygon" || l.geometryKind === "mixed")
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </div>

            {/* Layer B Select */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-ink-muted">Layer B (Clipping Polygon)</label>
              <select
                value={booleanLayerB}
                onChange={(e) => setBooleanLayerB(e.target.value)}
                className={FIELD_INPUT}
              >
                <option value="">Select Polygon Layer B...</option>
                {layers
                  .filter((l) => l.geometryKind === "polygon" || l.geometryKind === "mixed")
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1.5 pt-1">
              <button
                type="button"
                disabled={!booleanLayerA || !booleanLayerB || booleanLoading}
                className={cx(PRIMARY_BUTTON, "flex-1 !bg-emerald-600 hover:!bg-emerald-500 text-white")}
                onClick={executeBooleanOp}
              >
                {booleanLoading ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Computing Topology...
                  </>
                ) : (
                  <>
                    <Layers size={12} />
                    Execute {booleanOp.toUpperCase()}
                  </>
                )}
              </button>
              {booleanResult && (
                <button type="button" className={SECONDARY_BUTTON} onClick={clearBoolean} title="Clear overlay">
                  <Eraser size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Results Summary Card */}
          {booleanResult && (
            <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2.5">
              <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-400">
                <span className="capitalize">{booleanResult.operation} Result</span>
                <span className="font-mono text-[10px] text-ink-muted">
                  {booleanResult.polygon_count} Polygon(s)
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <KeyValue
                  label="Area (km²)"
                  value={`${(booleanResult.total_area_sq_m / 1_000_000).toFixed(3)} km²`}
                />
                <KeyValue
                  label="Area (m²)"
                  value={`${booleanResult.total_area_sq_m.toLocaleString()} m²`}
                />
              </div>

              <button
                type="button"
                className={cx(PRIMARY_BUTTON, "mt-2 !bg-emerald-700 hover:!bg-emerald-600 text-white font-semibold")}
                onClick={saveBooleanResultAsLayer}
              >
                <Check size={12} />
                Save as New Workspace Layer
              </button>
            </div>
          )}

          <InfoNote>
            Executes native constructive area geometry Boolean operations via exact topological polygon clipping. Calculates unsigned ellipsoidal geodesic area and produces WGS 84 GeoJSON MultiPolygons.
          </InfoNote>
        </div>
      )}
    </PanelShell>
  );
}



