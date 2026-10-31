import { useMemo, useRef, useState } from "react";
import {
  Copy,
  Loader2,
  PlusCircle,
  Ruler,
  Trash2,
  TrendingUp,
} from "lucide-react";
import {
  getMeasurementLines,
  measureCoordinates,
  setProfileHoverCoord,
} from "../../map/mapController";
import { cx } from "../../lib/cx";
import { computeElevationProfile } from "../../lib/gis/tiledBackend";
import { useMapStore } from "../../state/mapStore";
import { useProjectStore } from "../../state/projectStore";
import { useUiStore } from "../../state/uiStore";
import { PanelShell } from "../PanelShell";
import {
  InfoNote,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SectionLabel,
} from "./shared";
import { ElevationChart } from "../analysis/ElevationChart";

export function ElevationPanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const notify = useUiStore((state) => state.notify);
  const measureMode = useProjectStore((state) => state.measureMode);
  const setMeasureMode = useProjectStore((state) => state.setMeasureMode);
  const measureSummary = useProjectStore((state) => state.measureSummary);

  // Elevation Profile state (lifted into useMapStore for persistent analysis)
  const elevationResult = useMapStore((state) => state.elevationResult);
  const setElevationResult = useMapStore((state) => state.setElevationResult);
  const elevationSelectedFeatureId = useMapStore((state) => state.elevationSelectedFeatureId);
  const setElevationSelectedFeatureId = useMapStore((state) => state.setElevationSelectedFeatureId);
  const [elevationLoading, setElevationLoading] = useState(false);
  const [sampleCount, setSampleCount] = useState<number>(40);
  const lastSlicedIdRef = useRef<string | null>(useMapStore.getState().elevationSelectedFeatureId);

  // Available measurement lines on canvas (reacts to measurement updates)
  const availableLines = useMemo(() => getMeasurementLines(), [measureSummary]);
  const lineStrings = useMemo(
    () => availableLines.filter((l) => l.type === "LineString"),
    [availableLines],
  );
  const targetLines = lineStrings.length > 0 ? lineStrings : availableLines;
  const activeLineId = targetLines.some((l) => l.id === elevationSelectedFeatureId)
    ? elevationSelectedFeatureId
    : targetLines[0]?.id ?? null;

  const handleSliceElevation = async (overrideTargetId?: string, overrideSampleCount?: number) => {
    const targetId = overrideTargetId ?? activeLineId ?? undefined;
    const coords = measureCoordinates(targetId);
    if (coords.length < 2) {
      notify("Draw at least 2 points on the map first");
      return;
    }

    const count = overrideSampleCount ?? sampleCount;
    setElevationLoading(true);
    if (targetId) {
      lastSlicedIdRef.current = targetId;
      setElevationSelectedFeatureId(targetId);
    }
    try {
      const res = await computeElevationProfile(coords, count);
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

  const changeSampleCount = (count: number) => {
    setSampleCount(count);
    if (elevationResult) {
      handleSliceElevation(undefined, count);
    }
  };

  return (
    <PanelShell
      eyebrow="Analysis"
      title="Terrain Elevation"
      side="right"
      onClose={() => {
        setProfileHoverCoord(null);
        closePanel("right");
      }}
      footer={
        <>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-accent" />
            WGS 84 Ellipsoidal
          </span>
          <span>Copernicus DEM GLO-90</span>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SectionLabel>Cross-Section Transect Slicer</SectionLabel>

        {/* Path Status & Multi-Line Selector */}
        {targetLines.length > 1 ? (
          <div className="flex flex-col gap-1.5 rounded-[2px] border border-line bg-tint p-2">
            <div className="flex items-center justify-between text-[10px] text-ink-muted">
              <span>Active Profile Path:</span>
              <span>{targetLines.length} paths on canvas</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {targetLines.map((line) => {
                const isSelected = activeLineId === line.id;
                return (
                  <button
                    key={line.id}
                    type="button"
                    className={cx(
                      "flex items-center gap-1 rounded-[2px] px-2 py-1 font-mono text-[10px] transition-colors",
                      isSelected
                        ? "bg-accent/15 text-accent border border-accent/40 font-semibold"
                        : "bg-solid text-ink-muted hover:text-ink border border-line",
                    )}
                    onClick={() => {
                      setElevationSelectedFeatureId(line.id);
                      handleSliceElevation(line.id);
                    }}
                  >
                    <Ruler size={10} />
                    <span>Line #{line.index}</span>
                    <span className="text-[9px] opacity-75">({line.formattedDistance})</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : targetLines.length === 1 ? (
          <div className="flex items-center justify-between rounded-[2px] border border-line bg-tint px-2.5 py-1.5 text-[11px] font-mono">
            <span className="text-ink-muted flex items-center gap-1.5">
              <Ruler size={12} className="text-accent" />
              <span>Line #{targetLines[0].index}</span>
            </span>
            <span className="text-ink font-semibold">
              {targetLines[0].formattedDistance} ({targetLines[0].vertexCount} pts)
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-[2px] border border-dashed border-line p-3 text-center">
            <div className="text-[11px] text-ink-muted">
              No measurement line plotted yet.
            </div>
            <button
              type="button"
              className={cx(SECONDARY_BUTTON, "justify-center gap-1.5 text-[11px]")}
              onClick={() => {
                setMeasureMode("distance");
                notify("Click map to plot elevation cross-section path (double-click to finish)");
              }}
            >
              <PlusCircle size={12} />
              <span>Plot Path on Map</span>
            </button>
          </div>
        )}

        {measureMode === "distance" && (
          <div className="flex items-center gap-2 rounded-[2px] border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[10.5px] text-accent">
            <span className="size-1.5 rounded-full bg-accent animate-pulse" />
            <span>Drawing in progress: click map to add points, double-click to finish.</span>
          </div>
        )}

        <div className="flex items-center justify-between rounded-[2px] border border-line bg-tint p-2 text-[10.5px]">
          <span className="text-ink-muted">Sampling Density</span>
          <div className="flex gap-1">
            {[20, 40, 80].map((count) => (
              <button
                key={count}
                type="button"
                className={cx(
                  "rounded-[2px] px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors",
                  sampleCount === count
                    ? "bg-solid text-ink border border-line shadow-sm"
                    : "bg-transparent text-ink-muted hover:text-ink",
                )}
                onClick={() => changeSampleCount(count)}
              >
                {count} pts
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className={cx(PRIMARY_BUTTON, "w-full gap-2")}
          onClick={() => handleSliceElevation()}
          disabled={elevationLoading || (targetLines.length === 0 && measureCoordinates().length < 2)}
        >
          {elevationLoading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <TrendingUp size={13} strokeWidth={2} />
          )}
          {elevationResult ? "Re-sample Path Elevation" : "Sample Path Elevation"}
        </button>

        {elevationResult && (
          <div className="flex flex-col gap-2">
            <ElevationChart data={elevationResult} />
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                className={cx(SECONDARY_BUTTON, "text-[10px] h-[24px] text-critical/80 hover:text-critical gap-1")}
                onClick={() => {
                  setElevationResult(null);
                  setProfileHoverCoord(null);
                  notify("Elevation profile cleared");
                }}
              >
                <Trash2 size={11} /> Clear Profile
              </button>
              <button
                type="button"
                className={cx(SECONDARY_BUTTON, "text-[10px] h-[24px] gap-1")}
                onClick={async () => {
                  const csv = [
                    "distance_km,elevation_m,slope_pct,latitude,longitude",
                    ...elevationResult.samples.map(
                      (s) =>
                        `${(s.distance_m / 1000).toFixed(3)},${s.elevation_m.toFixed(1)},${(s.slope_pct ?? 0).toFixed(1)},${s.lat.toFixed(5)},${s.lon.toFixed(5)}`,
                    ),
                  ].join("\n");
                  try {
                    await navigator.clipboard.writeText(csv);
                    notify("Elevation & Slope CSV copied to clipboard");
                  } catch {
                    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `elevation_profile_${Date.now()}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    notify("Elevation & Slope CSV downloaded");
                  }
                }}
              >
                <Copy size={11} /> Copy Profile CSV
              </button>
            </div>
          </div>
        )}

        {!elevationResult && targetLines.length > 0 && (
          <InfoNote>
            Click "Sample Path Elevation" to interpolate geodesic WGS 84 distances and slice global elevations from Copernicus DEM GLO-90.
          </InfoNote>
        )}
      </div>
    </PanelShell>
  );
}
