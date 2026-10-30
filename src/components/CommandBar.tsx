import { useEffect, useState } from "react";
import {
  BellRing,
  Camera,
  Database,
  Frame,
  GitMerge,
  Globe,
  Hexagon,
  History,
  LocateFixed,
  Maximize2,
  Minimize2,
  Mountain,
  Radar,
  Ruler,
  Search,
  Settings2,
  Table,
} from "lucide-react";
import type { PanelId } from "../lib/gis/types";
import { downloadMapCapture, fitToData, flyTo, resetNorth } from "../map/mapController";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";
import { useTelemetryStore } from "../state/telemetryStore";
import { useUiStore, type AnalysisTab } from "../state/uiStore";
import { cx } from "../lib/cx";

const SHELL_BUTTON =
  "inline-flex h-[28px] items-center gap-1.5 rounded-[2px] px-2 text-[11.5px] font-semibold text-ink-soft transition-colors hover:bg-tint hover:text-ink focus-visible:outline-2";

const SHELL_ACTIVE = "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent";

const ICON_CLUSTER_BUTTON =
  "grid h-[28px] w-[28px] place-items-center rounded-[2px] text-ink-soft transition-colors hover:bg-tint hover:text-ink";

interface WorkspaceTool {
  id: PanelId;
  label: string;
  icon: typeof Search;
  shortcut?: string;
}

const WORKSPACE_TOOLS: WorkspaceTool[] = [
  { id: "search", label: "Search", icon: Search, shortcut: "/" },
  { id: "data", label: "Data", icon: Database, shortcut: "D" },
  { id: "table", label: "Table", icon: Table, shortcut: "T" },
  { id: "project", label: "Project", icon: Frame },
  { id: "join", label: "Join", icon: GitMerge },
  { id: "basemaps", label: "Basemap", icon: Globe },
];

const ANALYSIS_TOOLS: {
  tab: AnalysisTab;
  label: string;
  icon: typeof Search;
  measure?: "distance" | "area";
  shortcut?: string;
}[] = [
  { tab: "distance", label: "Measure distance", icon: Ruler, measure: "distance", shortcut: "M" },
  { tab: "area", label: "Measure area", icon: Hexagon, measure: "area", shortcut: "A" },
  { tab: "elevation", label: "Elevation profile", icon: Mountain },
  { tab: "buffer", label: "Proximity buffer", icon: Radar },
  { tab: "knn", label: "k-Nearest neighbors", icon: LocateFixed },
];

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="grid size-[28px] shrink-0 place-items-center rounded-[2px] bg-accent-soft"
    >
      <svg viewBox="0 0 28 28" className="size-[28px]">
        <circle cx="14" cy="14" r="7" fill="none" stroke="var(--accent)" strokeWidth="1" />
        <path d="M14 5v18M5 14h18" stroke="var(--accent)" strokeWidth="1" />
        <circle cx="14" cy="14" r="1.5" fill="var(--accent)" />
      </svg>
    </span>
  );
}

export function CommandBar() {
  const leftPanel = useUiStore((state) => state.leftPanel);
  const rightPanel = useUiStore((state) => state.rightPanel);
  const togglePanel = useUiStore((state) => state.togglePanel);
  const analysisTab = useUiStore((state) => state.analysisTab);
  const openAnalysisTab = useUiStore((state) => state.openAnalysisTab);
  const timelineOpen = useUiStore((state) => state.timelineOpen);
  const toggleTimeline = useUiStore((state) => state.toggleTimeline);
  const setAlertsOpen = useUiStore((state) => state.setAlertsOpen);
  const setMeasureModeDispatch = useProjectStore((state) => state.setMeasureMode);
  const layerCount = useProjectStore((state) => state.layers.length);
  const rotation = useMapStore((state) => state.camera.rotation);
  const openAlerts = useTelemetryStore((state) => state.openAlerts);

  const [toolsOpen, setToolsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreen = () => {
      setFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreen);
    return () => document.removeEventListener("fullscreenchange", handleFullscreen);
  }, []);

  const toggleTool = (tab: AnalysisTab, measure?: "distance" | "area") => {
    setToolsOpen(false);
    if (rightPanel === "measure" && analysisTab === tab) {
      togglePanel("measure");
      return;
    }
    openAnalysisTab(tab);
    if (measure) setMeasureModeDispatch(measure);
    else setMeasureModeDispatch("off");
  };

  const locate = () => {
    if (!("geolocation" in navigator)) {
      useUiStore.getState().flash("Location is not available in this window.");
      return;
    }
    useUiStore.getState().flash("Finding your position…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        flyTo(position.coords.longitude, position.coords.latitude, 11);
        useUiStore.getState().flash("Centered on your location");
      },
      () => {
        useUiStore.getState().flash("Location permission denied or unavailable.");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      useUiStore.getState().flash("Fullscreen is not available in this window.");
    }
  };

  const toggleFit = () => {
    fitToData();
    if (!layerCount) {
      useUiStore.getState().flash("No datasets are loaded yet.");
    }
  };

  const measureActive = rightPanel === "measure";
  const toolsButtonActive = measureActive || toolsOpen;

  return (
    <header
      className="pointer-events-auto absolute inset-x-0 top-0 z-[30] flex h-[var(--commandbar-h)] items-center gap-1 border-b border-line bg-solid px-2"
      aria-label="Command bar"
    >
      <BrandMark />
      <span className="mr-2 select-none px-1 text-[12.5px] font-bold tracking-[0.02em] text-ink">
        Strata
      </span>

      {WORKSPACE_TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={cx(SHELL_BUTTON, styledActive(leftPanel, tool.id))}
          title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
          onClick={() => togglePanel(tool.id)}
        >
          <tool.icon size={13} strokeWidth={2} aria-hidden="true" />
          {tool.label}
        </button>
      ))}

      <button
        type="button"
        className="inline-flex h-[28px] items-center gap-1.5 rounded-[2px] px-2 text-[11.5px] font-semibold text-ink-muted transition-colors hover:text-ink"
        title="Settings"
        onClick={() => togglePanel("settings")}
      >
        <Settings2 size={13} strokeWidth={2} aria-hidden="true" />
        <span className="hidden compact:inline">Settings</span>
      </button>

      <span className="mx-1.5 h-[18px] w-px bg-line" aria-hidden="true" />

      {/* Measure & analysis dropdown, replacing the second icon rail */}
      <div className="relative">
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={toolsOpen}
          className={cx(SHELL_BUTTON, toolsButtonActive && SHELL_ACTIVE)}
          onClick={() => setToolsOpen((open) => !open)}
        >
          <Ruler size={13} strokeWidth={2} aria-hidden="true" />
          Measure&nbsp;&amp;&nbsp;analyze
        </button>

        {toolsOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-10 cursor-default"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setToolsOpen(false)}
            />
            <div
              role="menu"
              aria-label="Measure and analysis tools"
              className="absolute left-0 top-[calc(100%+4px)] z-20 w-[228px] rounded-[2px] border border-line bg-solid p-1 shadow-panel"
            >
              {ANALYSIS_TOOLS.map((tool) => (
                <button
                  key={tool.tab}
                  type="button"
                  role="menuitem"
                  className="flex h-[30px] w-full items-center gap-2 rounded-[2px] px-2.5 text-left text-[11.5px] font-semibold text-ink-soft transition-colors hover:bg-tint hover:text-ink"
                  onClick={() => toggleTool(tool.tab, tool.measure)}
                >
                  <tool.icon size={13} strokeWidth={2} aria-hidden="true" />
                  {tool.label}
                  {tool.shortcut ? (
                    <span className="ml-auto font-mono text-[9.5px] text-ink-muted">
                      {tool.shortcut}
                    </span>
                  ) : null}
                  {measureActive && analysisTab === tool.tab ? (
                    <span className="ml-1 size-1.5 rounded-full bg-accent" aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex-1" />

      {/* Camera and window controls — small, labelled on hover, but grouped and ordered */}
      <button type="button" className={ICON_CLUSTER_BUTTON} title="Reset north (0)" onClick={resetNorth}>
        <span
          aria-hidden="true"
          className="relative block size-[16px] rounded-full border border-current before:absolute before:-top-[2px] before:left-1/2 before:h-[3px] before:w-px before:-translate-x-1/2 before:bg-current"
        >
          <span
            className="absolute inset-0.5 origin-center transition-transform duration-75 ease-linear"
            style={{ transform: `rotate(${-rotation}rad)` }}
          >
            <span className="absolute left-1/2 top-0 h-1 w-[3px] -translate-x-1/2 rounded-t-[2px] bg-accent" />
          </span>
        </span>
      </button>
      <button type="button" className={ICON_CLUSTER_BUTTON} title="Fit to data extent" onClick={toggleFit}>
        <Frame size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      <button type="button" className={ICON_CLUSTER_BUTTON} title="Find my location" onClick={locate}>
        <LocateFixed size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={ICON_CLUSTER_BUTTON}
        title="Capture map as PNG"
        onClick={() => {
          const ok = downloadMapCapture();
          if (ok) {
            useUiStore.getState().flash("Map captured as PNG");
          } else {
            useUiStore.getState().flash("Map capture not available");
          }
        }}
      >
        <Camera size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={ICON_CLUSTER_BUTTON}
        title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        onClick={toggleFullscreen}
      >
        {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>

      <span className="mx-1.5 h-[18px] w-px bg-line" aria-hidden="true" />

      {/* Timeline dock toggle */}
      <button
        type="button"
        className={cx(ICON_CLUSTER_BUTTON, timelineOpen && "bg-accent-soft text-accent")}
        title={timelineOpen ? "Close timeline" : "Open timeline — scrub recorded positions"}
        aria-pressed={timelineOpen}
        onClick={toggleTimeline}
      >
        <History size={14} strokeWidth={2} aria-hidden="true" />
      </button>

      {/* Alert queue toggle with open-alert count */}
      <button
        type="button"
        className={cx(
          ICON_CLUSTER_BUTTON,
          "relative",
          openAlerts > 0 && "bg-warn-10 text-warn",
        )}
        title={openAlerts ? `${openAlerts} open alert${openAlerts === 1 ? "" : "s"}` : "Alerts — none open"}
        aria-label={`Alerts, ${openAlerts} open`}
        onClick={() => setAlertsOpen(true)}
      >
        <BellRing size={14} strokeWidth={2} aria-hidden="true" />
        {openAlerts > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-[14px] place-items-center rounded-full bg-warn px-[3px] font-mono text-[8.5px] font-bold text-shell">
            {openAlerts}
          </span>
        )}
      </button>
    </header>
  );
}

function styledActive(leftPanel: PanelId | null, id: PanelId): string {
  return leftPanel === id ? SHELL_ACTIVE : "";
}
