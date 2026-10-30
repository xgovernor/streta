import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { BASEMAPS } from "../../lib/gis/data";
import type { BasemapDefinition, BasemapId } from "../../lib/gis/types";
import { cx } from "../../lib/cx";
import { useUiStore } from "../../state/uiStore";
import { PanelShell } from "../PanelShell";
import { SectionLabel } from "./shared";

/** Swatches stand in for the map itself, so they read at 60px tall. */
const PREVIEWS: Record<BasemapId, CSSProperties> = {
  positron: {
    backgroundColor: "#e9e7e2",
    backgroundImage:
      "linear-gradient(90deg, rgba(30,60,90,0.09) 1px, transparent 1px), linear-gradient(rgba(30,60,90,0.09) 1px, transparent 1px), radial-gradient(circle at 66% 36%, rgba(80,140,180,0.28), transparent 42%)",
    backgroundSize: "16px 16px, 16px 16px, 100% 100%",
  },
  atlas: {
    backgroundColor: "#e9dec4",
    backgroundImage:
      "radial-gradient(circle at 24% 72%, rgba(112,160,90,0.55) 0 18%, transparent 19%), linear-gradient(64deg, transparent 46%, rgba(255,255,255,0.9) 46% 50%, transparent 50%), linear-gradient(-22deg, transparent 60%, rgba(158,190,212,0.85) 60% 63%, transparent 63%)",
  },
  bright: {
    backgroundColor: "#f1e8d4",
    backgroundImage:
      "radial-gradient(circle at 30% 40%, rgba(120,168,96,0.55) 0 16%, transparent 17%), linear-gradient(58deg, transparent 48%, rgba(255,255,255,0.95) 48% 52%, transparent 52%), linear-gradient(-28deg, transparent 58%, rgba(146,184,214,0.9) 58% 61%, transparent 61%)",
  },
  midnight: {
    backgroundColor: "#101820",
    backgroundImage:
      "linear-gradient(90deg, rgba(160,190,210,0.09) 1px, transparent 1px), linear-gradient(rgba(160,190,210,0.09) 1px, transparent 1px), radial-gradient(circle at 70% 30%, rgba(90,160,190,0.3), transparent 46%)",
    backgroundSize: "16px 16px, 16px 16px, 100% 100%",
  },
  "google-maps": {
    backgroundColor: "#e9eaed",
    backgroundImage:
      "linear-gradient(90deg, transparent 33%, rgba(255,255,255,0.96) 33% 37%, transparent 37%), linear-gradient(-4deg, transparent 57%, rgba(255,255,255,0.94) 57% 61%, transparent 61%), radial-gradient(circle at 74% 26%, rgba(126,178,116,0.6) 0 15%, transparent 16%), radial-gradient(circle at 16% 82%, rgba(160,200,232,0.85) 0 17%, transparent 18%)",
  },
  "satellite-imagery": {
    backgroundColor: "#22301f",
    backgroundImage:
      "radial-gradient(circle at 30% 40%, rgba(102,132,76,0.8) 0 22%, transparent 23%), radial-gradient(circle at 74% 30%, rgba(56,78,58,0.85) 0 18%, transparent 19%), radial-gradient(circle at 62% 78%, rgba(38,56,50,0.9) 0 21%, transparent 22%), linear-gradient(52deg, transparent 46%, rgba(138,160,118,0.4) 46% 50%, transparent 50%)",
  },
  "maxar-satellite": {
    backgroundColor: "#1a201e",
    backgroundImage:
      "radial-gradient(circle at 38% 32%, rgba(126,138,124,0.6) 0 17%, transparent 18%), radial-gradient(circle at 72% 68%, rgba(72,84,78,0.72) 0 22%, transparent 23%), linear-gradient(122deg, transparent 54%, rgba(148,156,146,0.32) 54% 57%, transparent 57%)",
  },
  "hybrid-basemap": {
    backgroundColor: "#1d2622",
    backgroundImage:
      "radial-gradient(circle at 34% 36%, rgba(96,124,82,0.72) 0 20%, transparent 21%), radial-gradient(circle at 74% 70%, rgba(46,62,56,0.86) 0 20%, transparent 21%), linear-gradient(74deg, transparent 43%, rgba(255,255,255,0.86) 43% 46%, transparent 46%), linear-gradient(-14deg, transparent 61%, rgba(250,214,120,0.8) 61% 63%, transparent 63%), radial-gradient(circle at 22% 24%, rgba(255,255,255,0.9) 0 1.6%, transparent 2.4%)",
  },
  openstreetmap: {
    backgroundColor: "#f4f1ea",
    backgroundImage:
      "linear-gradient(88deg, transparent 39%, rgba(255,255,255,0.96) 39% 42%, transparent 42%), linear-gradient(-6deg, transparent 65%, rgba(255,255,255,0.9) 65% 68%, transparent 68%), radial-gradient(circle at 26% 28%, rgba(170,211,223,0.9) 0 15%, transparent 16%), radial-gradient(circle at 76% 78%, rgba(200,221,182,0.9) 0 14%, transparent 15%)",
  },
};

const FAMILIES: { label: string; kind: BasemapDefinition["kind"] }[] = [
  { label: "Vector styles", kind: "style" },
  { label: "Raster imagery", kind: "raster" },
];

export function BasemapsPanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const basemap = useUiStore((state) => state.basemap);
  const setBasemap = useUiStore((state) => state.setBasemap);

  const active = BASEMAPS.find((item) => item.id === basemap);

  return (
    <PanelShell
      eyebrow="Base cartography"
      title="Basemaps"
      onClose={closePanel}
      footer={
        <>
          <span>{BASEMAPS.length} basemaps</span>
          <span>{active?.attribution[0]?.label ?? "—"}</span>
        </>
      }
    >
      {FAMILIES.map((family) => (
        <section key={family.kind}>
          <SectionLabel
            trailing={
              family.kind === "raster"
                ? "XYZ tiles"
                : "OpenFreeMap styles"
            }
          >
            {family.label}
          </SectionLabel>

          <div className="grid grid-cols-2 gap-2">
            {BASEMAPS.filter((item) => item.kind === family.kind).map((item) => {
              const selected = item.id === basemap;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={cx(
                    "rounded-[2px] border p-1 text-left transition-[border-color,background-color,transform] active:scale-[0.985]",
                    selected
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-tint hover:border-line-strong hover:bg-raised",
                  )}
                  aria-pressed={selected}
                  onClick={() => setBasemap(item.id)}
                >
                  <span
                    className="relative mb-[5px] block h-[60px] overflow-hidden rounded-[2px] border border-line"
                    style={PREVIEWS[item.id]}
                  >
                    {selected ? (
                      <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-accent text-on-accent">
                        <Check size={11} strokeWidth={2.2} aria-hidden="true" />
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-col gap-px px-1 pb-[3px]">
                    <strong className="text-[11px] font-semibold">
                      {item.name}
                    </strong>
                    <span className="font-mono text-[8px] uppercase tracking-[0.05em] text-ink-muted">
                      {item.tone}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}

    </PanelShell>
  );
}
