import { useState } from "react";
import {
  Crosshair,
  Eraser,
  Loader2,
  MapPin,
  Radar,
} from "lucide-react";
import {
  clearBufferOverlay,
  flyToCoordinate,
  renderBufferOverlay,
  setBufferPicker,
} from "../../map/mapController";
import { cx } from "../../lib/cx";
import { formatDistance } from "../../lib/format";
import {
  spatialBufferQuery,
  type SpatialQueryResult,
} from "../../lib/gis/tiledBackend";
import { useProjectStore } from "../../state/projectStore";
import { useUiStore } from "../../state/uiStore";
import { PanelShell } from "../PanelShell";
import {
  FIELD_INPUT,
  InfoNote,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SectionLabel,
} from "./shared";

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

  // Buffer & Proximity Query state
  const [bufferCenter, setBufferCenter] = useState<[number, number] | null>(null);
  const [bufferRadius, setBufferRadius] = useState<number>(5000);
  const [isPickingCenter, setIsPickingCenter] = useState(false);
  const [bufferLoading, setBufferLoading] = useState(false);
  const [bufferResult, setBufferResult] = useState<SpatialQueryResult | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string>("all");

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
          <span>64-vertex Polygon</span>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SectionLabel>Geodesic Proximity Query</SectionLabel>

        {/* Center Point Picker */}
        <div className="flex flex-col gap-1.5 rounded-[2px] border border-line bg-tint p-2.5">
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
                  "rounded-[2px] border py-1 text-[10px] font-mono transition-colors",
                  bufferRadius === r
                    ? "border-line-strong bg-tint text-ink font-semibold"
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
            <SectionLabel trailing={<span className="text-ink font-mono font-semibold">({bufferResult.total_hits} hits)</span>}>
              Ranked Spatial Intersections
            </SectionLabel>
            {bufferResult.hits.length === 0 ? (
              <div className="rounded-[2px] border border-line bg-tint py-4 text-center text-[10.5px] text-ink-muted">
                No features intercepted within this buffer.
              </div>
            ) : (
              <div className="max-h-[220px] overflow-y-auto rounded-[2px] border border-line bg-tint p-1 flex flex-col gap-1">
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
                      className="group flex flex-col gap-1 rounded-[2px] bg-solid p-2 text-[10.5px] hover:border-line-strong border border-transparent transition-colors cursor-pointer"
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
                        <span className="font-mono text-ink font-medium">
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
    </PanelShell>
  );
}
