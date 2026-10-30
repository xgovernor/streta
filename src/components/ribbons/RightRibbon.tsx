import {
  CircleDot,
  GitMerge,
  Hexagon,
  LocateFixed,
  Mountain,
  Ruler,
  Table,
} from "lucide-react";
import { useUiStore, type AnalysisTab } from "../../state/uiStore";
import { useProjectStore } from "../../state/projectStore";
import { cx } from "../../lib/cx";

interface ToolItem {
  id: string;
  label: string;
  icon: typeof Ruler;
  shortcut?: string;
  action: () => void;
  isActive: boolean;
}

export function RightRibbon() {
  const rightPanel = useUiStore((state) => state.rightPanel);
  const leftPanel = useUiStore((state) => state.leftPanel);
  const togglePanel = useUiStore((state) => state.togglePanel);
  const analysisTab = useUiStore((state) => state.analysisTab);
  const openAnalysisTab = useUiStore((state) => state.openAnalysisTab);
  const setMeasureModeDispatch = useProjectStore((state) => state.setMeasureMode);

  const handleTool = (tab: AnalysisTab, measure?: "distance" | "area") => {
    if (rightPanel === "measure" && analysisTab === tab) {
      togglePanel("measure");
      setMeasureModeDispatch("off");
      return;
    }
    openAnalysisTab(tab);
    if (measure) setMeasureModeDispatch(measure);
    else setMeasureModeDispatch("off");
  };

  const ASSISTING_TOOLS: ToolItem[] = [
    {
      id: "distance",
      label: "Geodesic Distance",
      icon: Ruler,
      shortcut: "M",
      isActive: rightPanel === "measure" && analysisTab === "distance",
      action: () => handleTool("distance", "distance"),
    },
    {
      id: "area",
      label: "Polygon Area & Perimeter",
      icon: Hexagon,
      shortcut: "A",
      isActive: rightPanel === "measure" && analysisTab === "area",
      action: () => handleTool("area", "area"),
    },
    {
      id: "elevation",
      label: "Terrain Elevation Profile",
      icon: Mountain,
      isActive: rightPanel === "measure" && analysisTab === "elevation",
      action: () => handleTool("elevation"),
    },
    {
      id: "buffer",
      label: "Proximity Buffer",
      icon: CircleDot,
      isActive: rightPanel === "measure" && analysisTab === "buffer",
      action: () => handleTool("buffer"),
    },
    {
      id: "knn",
      label: "k-Nearest Neighbors",
      icon: LocateFixed,
      isActive: rightPanel === "measure" && analysisTab === "knn",
      action: () => handleTool("knn"),
    },
    {
      id: "boolean",
      label: "Spatial Boolean Ops",
      icon: GitMerge,
      isActive: rightPanel === "measure" && analysisTab === "boolean",
      action: () => handleTool("boolean"),
    },
  ];

  const SECONDARY_TOOLS: ToolItem[] = [
    {
      id: "table",
      label: "Attribute Table",
      icon: Table,
      shortcut: "T",
      isActive: rightPanel === "table" || leftPanel === "table",
      action: () => togglePanel("table"),
    },
    {
      id: "join",
      label: "Relational Join",
      icon: GitMerge,
      isActive: leftPanel === "join",
      action: () => togglePanel("join"),
    },
  ];

  return (
    <aside
      className="pointer-events-auto absolute right-0 top-[var(--commandbar-h)] bottom-[var(--footer-h)] z-20 flex w-[var(--ribbon-w)] flex-col items-center justify-between border-l border-line bg-solid py-2 select-none"
      aria-label="Assisting Tools Ribbon"
    >
      <div className="flex w-full flex-col items-center gap-1">
        {ASSISTING_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={tool.action}
            className={cx(
              "group relative flex size-9 items-center justify-center rounded-[2px] transition-colors focus-visible:outline-2",
              tool.isActive
                ? "bg-tint text-accent before:absolute before:right-0 before:top-1.5 before:bottom-1.5 before:w-[2.5px] before:rounded-l before:bg-accent"
                : "text-ink-muted hover:bg-tint/70 hover:text-ink"
            )}
            title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
            aria-label={tool.label}
            aria-pressed={tool.isActive}
          >
            <tool.icon size={17} strokeWidth={2} />
            <span className="pointer-events-none absolute right-[calc(100%+8px)] z-50 hidden whitespace-nowrap rounded-[2px] border border-line bg-solid px-2 py-1 font-mono text-[9px] font-semibold text-ink shadow-panel group-hover:block">
              {tool.label}
              {tool.shortcut ? (
                <span className="ml-1.5 text-ink-muted">({tool.shortcut})</span>
              ) : null}
            </span>
          </button>
        ))}
      </div>

      <div className="flex w-full flex-col items-center gap-1 border-t border-line/60 pt-2">
        {SECONDARY_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={tool.action}
            className={cx(
              "group relative flex size-9 items-center justify-center rounded-[2px] transition-colors focus-visible:outline-2",
              tool.isActive
                ? "bg-tint text-accent before:absolute before:right-0 before:top-1.5 before:bottom-1.5 before:w-[2.5px] before:rounded-l before:bg-accent"
                : "text-ink-muted hover:bg-tint/70 hover:text-ink"
            )}
            title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
            aria-label={tool.label}
            aria-pressed={tool.isActive}
          >
            <tool.icon size={17} strokeWidth={2} />
            <span className="pointer-events-none absolute right-[calc(100%+8px)] z-50 hidden whitespace-nowrap rounded-[2px] border border-line bg-solid px-2 py-1 font-mono text-[9px] font-semibold text-ink shadow-panel group-hover:block">
              {tool.label}
              {tool.shortcut ? (
                <span className="ml-1.5 text-ink-muted">({tool.shortcut})</span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
