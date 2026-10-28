import { Moon, Sun } from "lucide-react";
import { VIEW_CRS, listCrs } from "../../lib/gis/crs";
import type { CoordinateFormat, ThemeMode } from "../../lib/gis/types";
import { cx } from "../../lib/cx";
import { useProjectStore } from "../../state/projectStore";
import { useUiStore } from "../../state/uiStore";
import { Kbd } from "../Kbd";
import { PanelShell } from "../PanelShell";

const SEGMENT_BUTTON =
  "flex h-[26px] items-center justify-center gap-[5px] rounded-md text-[10.5px] font-semibold transition-colors";

const SHORTCUTS: { label: string; keys: string[] }[] = [
  { label: "Zoom in / out", keys: ["+", "−"] },
  { label: "Reset north", keys: ["0"] },
  { label: "Search features", keys: ["/"] },
  { label: "Datasets and layers", keys: ["D", "L"] },
  { label: "Attribute table", keys: ["T"] },
  { label: "Measure distance", keys: ["M"] },
  { label: "Close panel / stop tool", keys: ["Esc"] },
];

export function SettingsPanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const coordFormat = useUiStore((state) => state.coordFormat);
  const setCoordFormat = useUiStore((state) => state.setCoordFormat);
  const layerCount = useProjectStore((state) => state.layers.length);

  const themes: { id: ThemeMode; label: string; icon: typeof Moon }[] = [
    { id: "dark", label: "Dark", icon: Moon },
    { id: "light", label: "Light", icon: Sun },
  ];
  const formats: { id: CoordinateFormat; label: string; hint: string }[] = [
    { id: "decimal", label: "Decimal", hint: "47.37690° N" },
    { id: "dms", label: "DMS", hint: "47°22′37″ N" },
    { id: "projected", label: "Projected", hint: "1,026,340.5 m" },
  ];

  return (
    <PanelShell
      eyebrow="Preferences"
      title="Settings"
      onClose={closePanel}
      footer={
        <>
          <span>Strata 0.1.0</span>
          <span>OpenLayers 10</span>
        </>
      }
    >
      <div className="mb-3.5">
        <div className="mb-1.5 flex items-baseline justify-between font-mono text-[8px] uppercase tracking-[0.1em] text-ink-muted">
          <span>Interface</span>
          <span>Theme</span>
        </div>
        <div className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg border border-line bg-tint p-0.5">
          {themes.map((item) => {
            const Icon = item.icon;
            const active = theme === item.id;

            return (
              <button
                key={item.id}
                type="button"
                className={cx(
                  SEGMENT_BUTTON,
                  active ? "bg-solid text-ink shadow-sm" : "text-ink-muted hover:text-ink",
                )}
                aria-pressed={active}
                onClick={() => setTheme(item.id)}
              >
                <Icon size={13} strokeWidth={1.8} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-3.5">
        <div className="mb-1.5 flex items-baseline justify-between font-mono text-[8px] uppercase tracking-[0.1em] text-ink-muted">
          <span>Readout</span>
          <span>{formats.find((item) => item.id === coordFormat)?.hint}</span>
        </div>
        <div className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg border border-line bg-tint p-0.5">
          {formats.map((item) => {
            const active = coordFormat === item.id;

            return (
              <button
                key={item.id}
                type="button"
                className={cx(
                  SEGMENT_BUTTON,
                  active ? "bg-solid text-ink shadow-sm" : "text-ink-muted hover:text-ink",
                )}
                aria-pressed={active}
                onClick={() => setCoordFormat(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-1.5 flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.13em] text-ink-muted">
        <span>Keyboard</span>
      </div>
      <div className="mb-3.5 flex flex-col gap-1.5">
        {SHORTCUTS.map((shortcut) => (
          <div
            key={shortcut.label}
            className="flex items-center justify-between text-[10.5px] text-ink-soft"
          >
            <span>{shortcut.label}</span>
            <span className="flex gap-[3px]">
              {shortcut.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line pt-[11px]">
        <div className="flex items-baseline justify-between text-[10.5px] text-ink-muted">
          <span>Map engine</span>
          <strong className="font-mono text-[9px] font-medium text-ink-soft">
            OpenLayers 10
          </strong>
        </div>
        <div className="flex items-baseline justify-between text-[10.5px] text-ink-muted">
          <span>View projection</span>
          <strong className="font-mono text-[9px] font-medium text-ink-soft">
            {VIEW_CRS}
          </strong>
        </div>
        <div className="flex items-baseline justify-between text-[10.5px] text-ink-muted">
          <span>Projections known</span>
          <strong className="font-mono text-[9px] font-medium text-ink-soft">
            {listCrs().length}
          </strong>
        </div>
        <div className="flex items-baseline justify-between text-[10.5px] text-ink-muted">
          <span>Layers loaded</span>
          <strong className="font-mono text-[9px] font-medium text-ink-soft">
            {layerCount}
          </strong>
        </div>
      </div>

    </PanelShell>
  );
}
