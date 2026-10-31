import { useState } from "react";
import {
  Crosshair,
  Eraser,
  Loader2,
  MapPin,
  Zap,
} from "lucide-react";
import {
  clearBufferOverlay,
  flyToCoordinate,
  renderKnnOverlay,
  setBufferPicker,
} from "../../map/mapController";
import { cx } from "../../lib/cx";
import {
  spatialKnnQuery,
  type KnnQueryResult,
  type SpatialPointInput,
} from "../../lib/gis/tiledBackend";
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

export function KnnPanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const notify = useUiStore((state) => state.notify);
  const layers = useProjectStore((state) => state.layers);

  // k-NN Spatial Query state
  const [knnCenter, setKnnCenter] = useState<[number, number] | null>(null);
  const [knnK, setKnnK] = useState<number>(5);
  const [isPickingKnnCenter, setIsPickingKnnCenter] = useState(false);
  const [knnLoading, setKnnLoading] = useState(false);
  const [knnResult, setKnnResult] = useState<KnnQueryResult | null>(null);
  const [selectedKnnLayerId, setSelectedKnnLayerId] = useState<string>("all");

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

  return (
    <PanelShell
      eyebrow="Spatial Query"
      title="k-Nearest Neighbors"
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
            3D ECEF Cartesian
          </span>
          <span>SIMD k-d Tree</span>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SectionLabel>SIMD Nearest-Neighbor Engine</SectionLabel>

        <div className="flex flex-col gap-2 rounded-[2px] border border-line bg-tint p-2.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-ink">
            <span className="flex items-center gap-1.5">
              <Crosshair size={13} className="text-ink-soft" />
              Query Probe Origin
            </span>
            <button
              type="button"
              className={cx(
                "flex items-center gap-1 rounded-[2px] px-2 py-0.5 text-[10px] font-semibold transition-colors",
                isPickingKnnCenter
                  ? "bg-accent text-on-accent animate-pulse"
                  : "bg-solid text-ink hover:text-ink-soft border border-line",
              )}
              onClick={toggleKnnPicker}
            >
              <MapPin size={10} />
              {isPickingKnnCenter ? "Click Map..." : knnCenter ? "Repick Point" : "Pick on Map"}
            </button>
          </div>

          {knnCenter ? (
            <div className="flex items-center justify-between rounded-[2px] bg-solid px-2 py-1 font-mono text-[10px] text-ink-muted">
              <span>{knnCenter[1].toFixed(5)}°N, {knnCenter[0].toFixed(5)}°E</span>
              <span className="text-[9px] text-ink font-semibold">Origin Active</span>
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
                .filter((l) => l.geometryKind === "Point" || l.geometryKind === "MultiPoint" || l.geometryKind === "Mixed")
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
                    "h-5 min-w-[22px] rounded-[2px] text-[10px] font-semibold transition-colors",
                    knnK === kVal
                      ? "bg-accent text-on-accent"
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
              className={cx(PRIMARY_BUTTON, "flex-1")}
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
              <span className="flex items-center gap-1 text-[9.5px] font-mono text-ink">
                <Zap size={10} />
                {knnResult.execution_micros.toFixed(1)} µs
              </span>
            </div>

            <div className="max-h-[240px] overflow-y-auto rounded-[2px] border border-line bg-tint p-1 flex flex-col gap-1">
              {knnResult.neighbors.map((n, idx) => (
                <div
                  key={idx}
                  className="group flex flex-col gap-1 rounded-[2px] bg-solid p-2 text-[10.5px] hover:border-line-strong border border-transparent transition-colors cursor-pointer"
                  onClick={() => {
                    flyToCoordinate(n.lon, n.lat, 15);
                    notify(`Focused on #${idx + 1}: ${n.id}`);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink truncate max-w-[170px]" title={n.id}>
                      <span className="mr-1.5 font-mono text-[9.5px] text-ink font-bold">
                        #{idx + 1}
                      </span>
                      {n.id}
                    </span>
                    <span className="font-mono text-ink font-semibold">
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
    </PanelShell>
  );
}
