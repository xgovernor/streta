import { Copy, Eraser, Hexagon, Ruler } from "lucide-react";
import { clearMeasureSketch, measureCoordinates } from "../../map/mapController";
import { cx } from "../../lib/cx";
import { formatArea, formatDistance } from "../../lib/format";
import { useProjectStore } from "../../state/projectStore";
import { useUiStore } from "../../state/uiStore";
import { PanelShell } from "../PanelShell";
import { InfoNote, KeyValue, SECONDARY_BUTTON, SectionLabel } from "./shared";

const MODES = [
  { id: "distance", label: "Distance", icon: Ruler },
  { id: "area", label: "Area", icon: Hexagon },
] as const;

export function MeasurePanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const notify = useUiStore((state) => state.notify);
  const measureMode = useProjectStore((state) => state.measureMode);
  const setMeasureMode = useProjectStore((state) => state.setMeasureMode);
  const summary = useProjectStore((state) => state.measureSummary);

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

  return (
    <PanelShell
      eyebrow="Analysis"
      title="Measure"
      side="right"
      onClose={closePanel}
      footer={
        <>
          <span>Geodesic · WGS 84</span>
          <span>{measureMode === "off" ? "Idle" : "Drawing"}</span>
        </>
      }
    >
      <SectionLabel>Mode</SectionLabel>
      <div className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg border border-line bg-tint p-0.5">
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const active = measureMode === mode.id;

          return (
            <button
              key={mode.id}
              type="button"
              className={cx(
                "flex h-[26px] items-center justify-center gap-[5px] rounded-md text-[10.5px] font-semibold transition-colors",
                active
                  ? "bg-solid text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink",
              )}
              aria-pressed={active}
              onClick={() =>
                setMeasureMode(active ? "off" : mode.id)
              }
            >
              <Icon size={13} strokeWidth={1.9} aria-hidden="true" />
              {mode.label}
            </button>
          );
        })}
      </div>

      <SectionLabel>Readout</SectionLabel>
      <div className="flex flex-col gap-[7px]">
        {summary?.mode === "area" ? (
          <KeyValue label="Area" value={formatArea(summary.area)} />
        ) : null}
        <KeyValue
          label={summary?.mode === "area" ? "Perimeter" : "Distance"}
          value={summary ? formatDistance(summary.distance) : "—"}
        />
        <KeyValue label="Vertices" value={summary ? `${summary.vertices}` : "—"} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5">
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

      <InfoNote>
        {measureMode === "off"
          ? "Pick distance or area, then click on the map to start. Lengths are measured on the WGS 84 spheroid, so they hold at any latitude."
          : "Click to add a vertex, double-click to finish. Segment lengths appear on the map as you draw; Esc ends the tool."}
      </InfoNote>
    </PanelShell>
  );
}
