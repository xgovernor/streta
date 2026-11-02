import { useEffect, useRef, useState } from "react";
import { motion, type Variants } from "motion/react";
import {
  BellRing,
  Bookmark,
  FolderKanban,
  History,
  Layers,
  Maximize2,
  Minimize2,
  Plane,
  Radio,
  Satellite,
  Search,
  Settings,
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
      className="grid size-[26px] shrink-0 place-items-center rounded-[2px] bg-accent-soft text-accent"
    >
      <svg viewBox="0 0 28 28" className="size-[22px]">
        <circle cx="14" cy="14" r="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M14 5v18M5 14h18" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="14" cy="14" r="1.5" fill="currentColor" />
      </svg>
    </span>
  );
}

/** 3x3 square matrix icon matching Anduril Lattice's menu trigger */
function GridNineIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="currentColor" className={className} aria-hidden="true">
      <rect x="1" y="1" width="3" height="3" rx="0.5" />
      <rect x="5.5" y="1" width="3" height="3" rx="0.5" />
      <rect x="10" y="1" width="3" height="3" rx="0.5" />
      <rect x="1" y="5.5" width="3" height="3" rx="0.5" />
      <rect x="5.5" y="5.5" width="3" height="3" rx="0.5" />
      <rect x="10" y="5.5" width="3" height="3" rx="0.5" />
      <rect x="1" y="10" width="3" height="3" rx="0.5" />
      <rect x="5.5" y="10" width="3" height="3" rx="0.5" />
      <rect x="10" y="10" width="3" height="3" rx="0.5" />
    </svg>
  );
}

function LiveClock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const dayName = days[time.getUTCDay()];
  const dayNum = time.getUTCDate();
  const monthName = months[time.getUTCMonth()];
  const yearNum = String(time.getUTCFullYear()).slice(-2);
  const dateStr = `${dayName} ${dayNum} ${monthName} ${yearNum}`;
  const utcTimeStr = time.toISOString().slice(11, 19) + "Z";

  return (
    <div className="flex items-center gap-2.5 font-mono text-[10px]">
      <span className="flex items-center gap-1.5 font-sans text-[10px] font-semibold text-emerald-400">
        <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
        Online
      </span>
      <span className="text-ink-muted">
        <span className="text-ink-soft">{dateStr}</span>, {utcTimeStr}
      </span>
    </div>
  );
}

const navVariants: Variants = {
  hidden: { opacity: 0, y: -48 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.85, delay: 0.08, ease: [0.16, 1, 0.3, 1] },
  },
};

export function CommandBar() {
  const booted = useUiStore((state) => state.booted);
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreen = () => {
      setFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreen);
    return () => document.removeEventListener("fullscreenchange", handleFullscreen);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

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
    <motion.header
      initial="hidden"
      animate={booted ? "visible" : "hidden"}
      variants={navVariants}
      className="pointer-events-auto absolute inset-x-0 top-0 z-[30] flex h-[var(--commandbar-h)] items-center justify-between border-b border-line bg-solid px-2.5 select-none"
      aria-label="Command bar"
    >
      {/* Left: Brand Mark & Anduril-style Operations Menu Trigger */}
      <div className="flex items-center gap-2">
        <BrandMark />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            className={cx(
              "group grid size-[26px] place-items-center rounded-[2px] transition-colors",
              menuOpen
                ? "bg-tint text-ink border border-line-strong"
                : "text-ink-soft hover:bg-tint hover:text-ink border border-transparent"
            )}
            title="Operations & Workspace Menu"
            aria-expanded={menuOpen}
            aria-haspopup="true"
          >
            <GridNineIcon className="size-[15px] text-ink-muted transition-colors group-hover:text-ink" />
          </button>

          {menuOpen && (
            <div
              className="absolute left-0 top-full mt-1.5 z-50 w-[260px] overflow-hidden rounded-[2px] border border-line bg-solid p-1 shadow-2xl backdrop-blur-md"
              role="menu"
            >
              {/* Project workspace summary */}
              <div className="px-2 py-1.5 border-b border-line mb-1">
                <div className="text-[9px] font-mono uppercase tracking-wider text-ink-muted">
                  Active Project
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-1">
                  <span className="truncate font-mono text-[11px] font-semibold text-ink">
                    {projectName || "Untitled"}
                  </span>
                  {dirty && (
                    <span className="rounded bg-warn/15 px-1 py-0.5 font-mono text-[8.5px] font-medium text-warn">
                      Unsaved
                    </span>
                  )}
                </div>
              </div>

              {/* Operational Modes */}
              <div className="px-1 py-0.5">
                <div className="px-1 py-0.5 text-[8.5px] font-mono uppercase tracking-wider text-ink-muted">
                  Operational Modes
                </div>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center justify-between rounded-[2px] px-2 py-1.5 text-left text-[11px] font-medium text-ink bg-tint/50 hover:bg-tint"
                >
                  <span className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                    Live Operations
                  </span>
                  <span className="font-mono text-[9px] text-emerald-400 font-semibold uppercase">
                    ACTIVE
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    toggleTimeline();
                    setMenuOpen(false);
                  }}
                  className={cx(
                    "flex w-full items-center justify-between rounded-[2px] px-2 py-1.5 text-left text-[11px] font-medium transition-colors hover:bg-tint hover:text-ink",
                    timelineOpen ? "text-accent bg-accent-soft/40" : "text-ink-soft"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <History size={12} />
                    4D Replay Timeline
                  </span>
                  {timelineOpen && (
                    <span className="font-mono text-[9px] text-accent uppercase">OPEN</span>
                  )}
                </button>
              </div>

              {/* Workspace Modules */}
              <div className="border-t border-line mt-1 px-1 py-0.5">
                <div className="px-1 py-0.5 text-[8.5px] font-mono uppercase tracking-wider text-ink-muted">
                  Workspace Panels
                </div>
                <button
                  type="button"
                  onClick={() => {
                    togglePanel("project");
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-[2px] px-2 py-1.5 text-left text-[11px] font-medium text-ink-soft transition-colors hover:bg-tint hover:text-ink"
                >
                  <span className="flex items-center gap-2">
                    <FolderKanban size={12} />
                    Project Workspace
                  </span>
                  <kbd className="font-mono text-[8.5px] text-ink-muted">P</kbd>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    togglePanel("data");
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-[2px] px-2 py-1.5 text-left text-[11px] font-medium text-ink-soft transition-colors hover:bg-tint hover:text-ink"
                >
                  <span className="flex items-center gap-2">
                    <Layers size={12} />
                    Layers & Datasets
                  </span>
                  <kbd className="font-mono text-[8.5px] text-ink-muted">D</kbd>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    togglePanel("telemetry");
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-[2px] px-2 py-1.5 text-left text-[11px] font-medium text-ink-soft transition-colors hover:bg-tint hover:text-ink"
                >
                  <span className="flex items-center gap-2">
                    <Radio size={12} />
                    Live Telemetry Feeds
                  </span>
                  <kbd className="font-mono text-[8.5px] text-ink-muted">T</kbd>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    togglePanel("bookmarks");
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-[2px] px-2 py-1.5 text-left text-[11px] font-medium text-ink-soft transition-colors hover:bg-tint hover:text-ink"
                >
                  <span className="flex items-center gap-2">
                    <Bookmark size={12} />
                    Mission Bookmarks
                  </span>
                  <kbd className="font-mono text-[8.5px] text-ink-muted">B</kbd>
                </button>
              </div>

              {/* Settings footer */}
              <div className="border-t border-line mt-1 px-1 pt-1 pb-0.5">
                <button
                  type="button"
                  onClick={() => {
                    togglePanel("settings");
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-[2px] px-2 py-1.5 text-left text-[11px] font-medium text-ink-soft transition-colors hover:bg-tint hover:text-ink"
                >
                  <span className="flex items-center gap-2">
                    <Settings size={12} />
                    Settings & Preferences
                  </span>
                  <kbd className="font-mono text-[8.5px] text-ink-muted">S</kbd>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Quick Search Omnibar Trigger */}
        <button
          type="button"
          onClick={() => togglePanel("search")}
          className="ml-1 flex h-[26px] items-center gap-2 rounded-[2px] border border-line bg-tint/60 px-2.5 font-sans text-[11px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink w-[180px] mid:w-[130px] compact:hidden"
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
            <span className="text-[9.5px] text-ink-muted uppercase">Air</span>
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
            <span className="text-[9.5px] text-ink-muted uppercase">Sea</span>
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
            <span className="text-[9.5px] text-ink-muted uppercase">Space</span>
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

        {/* Settings modal / panel toggle */}
        <button
          type="button"
          className="grid size-[28px] place-items-center rounded-[2px] text-ink-soft transition-colors hover:bg-tint hover:text-ink"
          title="Settings & Hardware (S)"
          onClick={() => togglePanel("settings")}
        >
          <Settings size={14} strokeWidth={2} />
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
    </motion.header>
  );
}
