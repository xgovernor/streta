import { useState } from "react";
import {
  Compass,
  Copy,
  Crosshair,
  Eraser,
  Hexagon,
  Loader2,
  MapPin,
  Mountain,
  Radar,
  Ruler,
  TrendingUp,
} from "lucide-react";
import {
  clearBufferOverlay,
  clearMeasureSketch,
  flyToCoordinate,
  measureCoordinates,
  renderBufferOverlay,
  setBufferPicker,
} from "../../map/mapController";
import { cx } from "../../lib/cx";
import { formatArea, formatDistance } from "../../lib/format";
import {
  computeElevationProfile,
  spatialBufferQuery,
  type ElevationProfileResult,
  type SpatialQueryResult,
} from "../../lib/gis/tiledBackend";
import { useProjectStore } from "../../state/projectStore";
import { useUiStore } from "../../state/uiStore";
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

type AnalysisTab = "distance" | "area" | "elevation" | "buffer";

const MODES = [
  { id: "distance" as const, label: "Distance", icon: Ruler },
  { id: "area" as const, label: "Area", icon: Hexagon },
  { id: "elevation" as const, label: "Elevation", icon: Mountain },
  { id: "buffer" as const, label: "Buffer", icon: Radar },
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
      <div className="grid grid-cols-4 gap-0.5 rounded-lg border border-line bg-tint p-0.5">
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
    </PanelShell>
  );
}
