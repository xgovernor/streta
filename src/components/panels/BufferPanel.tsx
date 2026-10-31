import { useState } from "react";
import {
  BookmarkPlus,
  Crosshair,
  Download,
  Eraser,
  FileSpreadsheet,
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
import { uniqueDatasetName } from "../../lib/gis/datasets";
import { uniqueLayerName } from "../../lib/gis/layers";
import { GEOGRAPHIC_CRS } from "../../lib/gis/crs";
import type { FeatureRecord } from "../../lib/gis/types";
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

type DistanceUnit = "m" | "km" | "NM" | "mi";

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

  // Buffer & Proximity Query state
  const [bufferCenter, setBufferCenter] = useState<[number, number] | null>(null);
  const [radiusMeters, setRadiusMeters] = useState<number>(5000);
  const [unit, setUnit] = useState<DistanceUnit>("km");
  const [isPickingCenter, setIsPickingCenter] = useState(false);
  const [bufferLoading, setBufferLoading] = useState(false);
  const [bufferResult, setBufferResult] = useState<SpatialQueryResult | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string>("all");

  // Display value in the current unit
  const displayRadius = radiusMeters / UNIT_MULTIPLIERS[unit];

  const handleUnitChange = (newUnit: DistanceUnit) => {
    setUnit(newUnit);
  };

  const handleRadiusInputChange = (value: number) => {
    if (value > 0) {
      const nextMeters = value * UNIT_MULTIPLIERS[unit];
      setRadiusMeters(nextMeters);
      if (bufferCenter) {
        executeBufferQuery(bufferCenter, nextMeters, selectedLayerId);
      }
    }
  };

  const handlePresetClick = (presetValue: number) => {
    const nextMeters = presetValue * UNIT_MULTIPLIERS[unit];
    setRadiusMeters(nextMeters);
    if (bufferCenter) {
      executeBufferQuery(bufferCenter, nextMeters, selectedLayerId);
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
        executeBufferQuery(coord, radiusMeters, selectedLayerId);
      });
    }
  };

  const executeBufferQuery = async (
    center: [number, number],
    distMeters: number,
    targetLayer: string,
  ) => {
    setBufferLoading(true);
    try {
      const layerIds = targetLayer === "all" ? undefined : [targetLayer];
      const res = await spatialBufferQuery(
        center[0],
        center[1],
        distMeters,
        layerIds,
        100,
        layers,
      );
      if (res) {
        setBufferResult(res);
        renderBufferOverlay(res.buffer_geojson, center, distMeters);
        const distLabel =
          distMeters >= 1000
            ? `${(distMeters / 1000).toFixed(1)} km`
            : `${Math.round(distMeters)} m`;
        notify(`Found ${res.total_hits} features within ${distLabel}`);
      } else {
        notify("Buffer query returned no results");
      }
    } catch (err) {
      notify(`Buffer query error: ${err}`);
    } finally {
      setBufferLoading(false);
    }
  };

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
    const datasetName = uniqueDatasetName(existingDatasetNames, `Buffer ${distLabel}`);

    const features: FeatureRecord[] = [
      {
        id: `buffer_${Date.now()}`,
        geometry: bufferResult.buffer_geojson.geometry,
        properties: {
          name: `Buffer Zone (${distLabel})`,
          center_lon: bufferResult.center_lon,
          center_lat: bufferResult.center_lat,
          radius_meters: bufferResult.radius_meters,
          total_hits: bufferResult.total_hits,
          created_at: new Date().toISOString(),
        },
      },
    ];

    const existingLayerNames = projectStore.layers.map((l) => l.name);
    const layerName = uniqueLayerName(existingLayerNames, `Buffer ${distLabel}`);

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

  const handleExportCsv = async () => {
    if (!bufferResult || bufferResult.hits.length === 0) {
      notify("No intercepted hits to export");
      return;
    }

    const headers = [
      "rank",
      "feature_id",
      "layer_id",
      "distance_meters",
      "distance_formatted",
      "bearing_degrees",
      "direction",
      "geometry_type",
      "longitude",
      "latitude",
    ];

    const rows = bufferResult.hits.map((h, i) => {
      const lon = h.target_lon ?? (h.properties?.lon as number) ?? (h.properties?.longitude as number) ?? "";
      const lat = h.target_lat ?? (h.properties?.lat as number) ?? (h.properties?.latitude as number) ?? "";
      return [
        i + 1,
        `"${h.feature_id || ""}"`,
        `"${h.layer_id}"`,
        h.distance_m,
        `"${formatDistance(h.distance_m)}"`,
        h.bearing_deg,
        `"${bearingToDirection(h.bearing_deg)}"`,
        `"${h.geometry_type}"`,
        lon,
        lat,
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

    const geojson = {
      type: "FeatureCollection",
      features: [
        bufferResult.buffer_geojson,
        ...bufferResult.hits.map((h, idx) => ({
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
          },
        })),
      ],
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
    if (isPickingCenter) {
      setBufferPicker(null);
      setIsPickingCenter(false);
    }
    notify("Buffer query cleared");
  };

  // Surface area of buffer circle on spherical earth: A = pi * r^2
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
                {bufferCenter[1].toFixed(5)}°N, {bufferCenter[0].toFixed(5)}°E
              </span>
            ) : (
              <span className="text-ink-muted">No center chosen yet</span>
            )}
          </div>
        </div>

        {/* Radius & Unit Selector */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <SectionLabel>Buffer Radius</SectionLabel>
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
            <span>Area: {areaSqKm} km²</span>
            <span>
              {unit !== "NM" && `${(radiusMeters / 1852).toFixed(1)} NM · `}
              {unit !== "km" && `${(radiusMeters / 1000).toFixed(1)} km`}
            </span>
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
                executeBufferQuery(bufferCenter, radiusMeters, e.target.value);
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

        {/* Main Action Buttons */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            className={cx(PRIMARY_BUTTON, "gap-1.5")}
            disabled={!bufferCenter || bufferLoading}
            onClick={() => {
              if (bufferCenter) {
                executeBufferQuery(bufferCenter, radiusMeters, selectedLayerId);
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

        {/* Save as Layer & Export Actions */}
        {bufferResult && (
          <div className="flex flex-col gap-1.5 border-t border-line pt-2">
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                className={cx(
                  SECONDARY_BUTTON,
                  "text-[9.5px] px-1.5 py-1 justify-center gap-1",
                )}
                onClick={handleSaveAsLayer}
                title="Save buffer zone as a new layer in your project"
              >
                <BookmarkPlus size={11} />
                Save Layer
              </button>
              <button
                type="button"
                className={cx(
                  SECONDARY_BUTTON,
                  "text-[9.5px] px-1.5 py-1 justify-center gap-1",
                )}
                disabled={bufferResult.hits.length === 0}
                onClick={handleExportCsv}
                title="Download CSV of intercepted features"
              >
                <FileSpreadsheet size={11} />
                CSV
              </button>
              <button
                type="button"
                className={cx(
                  SECONDARY_BUTTON,
                  "text-[9.5px] px-1.5 py-1 justify-center gap-1",
                )}
                onClick={handleExportGeoJson}
                title="Download complete GeoJSON FeatureCollection"
              >
                <Download size={11} />
                GeoJSON
              </button>
            </div>
          </div>
        )}

        {/* Hit Results */}
        {bufferResult && (
          <div className="flex flex-col gap-1.5">
            <SectionLabel
              trailing={
                <span className="text-ink font-mono font-semibold">
                  ({bufferResult.total_hits} hits)
                </span>
              }
            >
              Ranked Spatial Intersections
            </SectionLabel>
            {bufferResult.hits.length === 0 ? (
              <div className="rounded-[2px] border border-line bg-tint py-4 text-center text-[10.5px] text-ink-muted">
                No features intercepted within this buffer envelope.
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
                          className="font-semibold text-ink truncate max-w-[170px]"
                          title={name}
                        >
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
                            style={{
                              backgroundColor: layer?.style?.color || "#06b6d4",
                            }}
                          />
                          {layer?.name || hit.layer_id}
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
          Constructs a 64-vertex true geodesic buffer polygon on WGS 84, scans the spatial index, and calculates exact ellipsoidal distances and azimuth bearings to all intercepted features.
        </InfoNote>
      </div>
    </PanelShell>
  );
}
