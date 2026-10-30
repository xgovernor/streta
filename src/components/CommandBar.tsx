import { useEffect, useState } from "react";
import {
  BellRing,
  History,
  Maximize2,
  Minimize2,
  Plane,
  Satellite,
  Search,
  Ship,
} from "lucide-react";
import { useProjectStore } from "../state/projectStore";
import { useTelemetryStore } from "../state/telemetryStore";
import { useUiStore } from "../state/uiStore";
import { cx } from "../lib/cx";

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="grid size-[26px] shrink-0 place-items-center rounded-[2px] bg-accent-soft"
    >
      <svg viewBox="0 0 28 28" className="size-[24px]">
        <circle cx="14" cy="14" r="7" fill="none" stroke="var(--accent)" strokeWidth="1.2" />
        <path d="M14 5v18M5 14h18" stroke="var(--accent)" strokeWidth="1.2" />
        <circle cx="14" cy="14" r="1.5" fill="var(--accent)" />
      </svg>
    </span>
  );
}

function LiveClock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const utcStr = time.toISOString().slice(11, 19) + "Z";
  const localStr = time.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex items-center gap-2 font-mono text-[10px] text-ink-muted">
      <span className="flex items-center gap-1 font-bold text-ink">
        <span className="text-[8px] uppercase tracking-wider text-ink-muted">UTC</span>
        {utcStr}
      </span>
      <span className="hidden mid:inline text-ink-soft">
        <span className="text-[8px] uppercase tracking-wider text-ink-muted mr-1">LOC</span>
        {localStr}
      </span>
    </div>
  );
}

export function CommandBar() {
  const togglePanel = useUiStore((state) => state.togglePanel);
  const timelineOpen = useUiStore((state) => state.timelineOpen);
  const toggleTimeline = useUiStore((state) => state.toggleTimeline);
  const setAlertsOpen = useUiStore((state) => state.setAlertsOpen);
  const projectName = useProjectStore((state) => state.projectName);
  const dirty = useProjectStore((state) => state.dirty);

  const openAlerts = useTelemetryStore((state) => state.openAlerts);
  const flights = useTelemetryStore((state) => state.flights);
  const vessels = useTelemetryStore((state) => state.vessels);
  const satellites = useTelemetryStore((state) => state.satellites);

  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreen = () => {
      setFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreen);
    return () => document.removeEventListener("fullscreenchange", handleFullscreen);
  }, []);

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

  return (
    <header
      className="pointer-events-auto absolute inset-x-0 top-0 z-[30] flex h-[var(--commandbar-h)] items-center justify-between border-b border-line bg-solid px-2.5 select-none"
      aria-label="Command bar"
    >
      {/* Left: Brand & Mission Workspace Breadcrumb */}
      <div className="flex items-center gap-2">
        <BrandMark />
        <span className="select-none font-sans text-[13px] font-bold tracking-[0.02em] text-ink">
          Strata
        </span>
        <span className="text-ink-muted text-xs">/</span>
        <button
          type="button"
          onClick={() => togglePanel("project")}
          className="flex items-center gap-1.5 rounded-[2px] px-1.5 py-0.5 font-mono text-[11px] text-ink-soft transition-colors hover:bg-tint hover:text-ink"
          title="Open Project Workspace (P)"
        >
          <span className="max-w-[130px] truncate font-medium">{projectName || "Untitled"}</span>
          {dirty && <span className="size-1.5 rounded-full bg-warn" title="Unsaved changes" />}
        </button>

        {/* Quick Search Omnibar Trigger */}
        <button
          type="button"
          onClick={() => togglePanel("search")}
          className="ml-2 flex h-[26px] items-center gap-2 rounded-[2px] border border-line bg-tint/60 px-2.5 font-sans text-[11px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink w-[180px] mid:w-[130px] compact:hidden"
          title="Search places, coordinates, or entities (/)"
        >
          <Search size={12} />
          <span className="flex-1 text-left truncate text-[10.5px]">Search & find...</span>
          <kbd className="font-mono text-[8.5px] text-ink-muted bg-solid/80 px-1 py-0.5 rounded border border-line">
            /
          </kbd>
        </button>
      </div>

      {/* Center: Tactical Live Telemetry Feed Badges */}
      <div className="flex items-center gap-1.5 compact:hidden">
        {flights.length > 0 && (
          <button
            type="button"
            onClick={() => togglePanel("telemetry")}
            className="flex items-center gap-1.5 rounded-[2px] border border-line bg-tint/60 px-2 py-0.5 font-mono text-[10px] text-ink-soft hover:text-ink hover:bg-tint"
            title="Active ADS-B Airborne Flights"
          >
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <Plane size={11} className="rotate-[-45deg] text-accent" />
            <span className="font-bold text-ink">{flights.length}</span>
            <span className="text-[8px] text-ink-muted uppercase">Air</span>
          </button>
        )}

        {vessels.length > 0 && (
          <button
            type="button"
            onClick={() => togglePanel("telemetry")}
            className="flex items-center gap-1.5 rounded-[2px] border border-line bg-tint/60 px-2 py-0.5 font-mono text-[10px] text-ink-soft hover:text-ink hover:bg-tint"
            title="Active AIS Maritime Vessels"
          >
            <span className="size-1.5 rounded-full bg-cyan-400" />
            <Ship size={11} className="text-cyan-400" />
            <span className="font-bold text-ink">{vessels.length}</span>
            <span className="text-[8px] text-ink-muted uppercase">Sea</span>
          </button>
        )}

        {satellites.length > 0 && (
          <button
            type="button"
            onClick={() => togglePanel("telemetry")}
            className="flex items-center gap-1.5 rounded-[2px] border border-line bg-tint/60 px-2 py-0.5 font-mono text-[10px] text-ink-soft hover:text-ink hover:bg-tint"
            title="Tracked Orbital Satellites"
          >
            <span className="size-1.5 rounded-full bg-purple-400" />
            <Satellite size={11} className="text-purple-400" />
            <span className="font-bold text-ink">{satellites.length}</span>
            <span className="text-[8px] text-ink-muted uppercase">Space</span>
          </button>
        )}
      </div>

      {/* Right: Clock & Global Mission Controls */}
      <div className="flex items-center gap-2">
        <LiveClock />

        <span className="mx-1 h-[18px] w-px bg-line" aria-hidden="true" />

        {/* 4D Timeline scrubber toggle */}
        <button
          type="button"
          className={cx(
            "grid size-[28px] place-items-center rounded-[2px] text-ink-soft transition-colors hover:bg-tint hover:text-ink",
            timelineOpen && "bg-accent-soft text-accent"
          )}
          title={timelineOpen ? "Close 4D Timeline" : "Open 4D Replay Timeline"}
          aria-pressed={timelineOpen}
          onClick={toggleTimeline}
        >
          <History size={14} strokeWidth={2} />
        </button>

        {/* Tactical Alert Queue with unacknowledged count */}
        <button
          type="button"
          className={cx(
            "relative grid size-[28px] place-items-center rounded-[2px] text-ink-soft transition-colors hover:bg-tint hover:text-ink",
            openAlerts > 0 && "bg-warn-10 text-warn"
          )}
          title={openAlerts ? `${openAlerts} open alerts` : "Alerts — none open"}
          onClick={() => setAlertsOpen(true)}
        >
          <BellRing size={14} strokeWidth={2} />
          {openAlerts > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-[14px] place-items-center rounded-full bg-warn px-[3px] font-mono text-[8.5px] font-bold text-shell">
              {openAlerts}
            </span>
          )}
        </button>

        {/* Fullscreen toggle */}
        <button
          type="button"
          className="grid size-[28px] place-items-center rounded-[2px] text-ink-soft transition-colors hover:bg-tint hover:text-ink"
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={toggleFullscreen}
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    </header>
  );
}
