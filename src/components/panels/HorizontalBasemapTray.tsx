import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Camera,
  Check,
  Globe,
  Layers,
  Map as MapIcon,
  Moon,
  Mountain,
  Sun,
  X,
} from "lucide-react";
import type { BasemapId } from "../../lib/gis/types";
import { useUiStore } from "../../state/uiStore";
import { cx } from "../../lib/cx";

interface BasemapMeta {
  id: BasemapId;
  name: string;
  category: "satellite" | "vector" | "streets";
  badge: "photo" | "dark" | "light" | "topo" | "streets" | "osm";
  tooltip: string;
  tileUrl?: string;
  fallbackStyle: CSSProperties;
}

const BASEMAP_META: BasemapMeta[] = [
  {
    id: "satellite-imagery",
    name: "Satellite",
    category: "satellite",
    badge: "photo",
    tooltip: "GOOGLE SATELLITE (HIGH-RES)",
    tileUrl: "https://mt1.google.com/vt/lyrs=s&x=586&y=384&z=10",
    fallbackStyle: {
      backgroundColor: "#1c261b",
      backgroundImage:
        "radial-gradient(circle at 30% 40%, rgba(102,132,76,0.8) 0 22%, transparent 23%), radial-gradient(circle at 74% 30%, rgba(56,78,58,0.85) 0 18%, transparent 19%)",
    },
  },
  {
    id: "hybrid-basemap",
    name: "Hybrid",
    category: "satellite",
    badge: "photo",
    tooltip: "HYBRID (SATELLITE + ROADS)",
    tileUrl: "https://mt1.google.com/vt/lyrs=y&x=586&y=384&z=10",
    fallbackStyle: {
      backgroundColor: "#18221c",
      backgroundImage:
        "linear-gradient(74deg, transparent 43%, rgba(255,255,255,0.8) 43% 46%, transparent 46%), radial-gradient(circle at 34% 36%, rgba(96,124,82,0.72) 0 20%, transparent 21%)",
    },
  },
  {
    id: "maxar-satellite",
    name: "Maxar",
    category: "satellite",
    badge: "photo",
    tooltip: "MAXAR EARTH IMAGERY",
    tileUrl: "https://mt2.google.com/vt/lyrs=s&x=586&y=384&z=10",
    fallbackStyle: {
      backgroundColor: "#19211d",
      backgroundImage:
        "radial-gradient(circle at 38% 32%, rgba(126,138,124,0.6) 0 17%, transparent 18%)",
    },
  },
  {
    id: "midnight",
    name: "Dark Matter",
    category: "vector",
    badge: "dark",
    tooltip: "TACTICAL DARK CANVAS",
    fallbackStyle: {
      backgroundColor: "#0d131a",
      backgroundImage:
        "linear-gradient(90deg, rgba(30,50,70,0.4) 1px, transparent 1px), linear-gradient(rgba(30,50,70,0.4) 1px, transparent 1px), radial-gradient(circle at 70% 30%, rgba(6,182,212,0.2), transparent 50%)",
      backgroundSize: "14px 14px, 14px 14px, 100% 100%",
    },
  },
  {
    id: "positron",
    name: "Positron",
    category: "vector",
    badge: "light",
    tooltip: "CARTO POSITRON (LIGHT)",
    fallbackStyle: {
      backgroundColor: "#eae7e1",
      backgroundImage:
        "linear-gradient(90deg, rgba(30,60,90,0.12) 1px, transparent 1px), linear-gradient(rgba(30,60,90,0.12) 1px, transparent 1px), radial-gradient(circle at 66% 36%, rgba(80,140,180,0.3), transparent 42%)",
      backgroundSize: "14px 14px, 14px 14px, 100% 100%",
    },
  },
  {
    id: "google-maps",
    name: "Streets",
    category: "streets",
    badge: "streets",
    tooltip: "GOOGLE ROADMAP",
    tileUrl: "https://mt1.google.com/vt/lyrs=m&x=586&y=384&z=10",
    fallbackStyle: {
      backgroundColor: "#e8eaed",
      backgroundImage:
        "linear-gradient(90deg, transparent 33%, rgba(255,255,255,0.96) 33% 37%, transparent 37%), radial-gradient(circle at 74% 26%, rgba(126,178,116,0.6) 0 15%, transparent 16%)",
    },
  },
  {
    id: "atlas",
    name: "Atlas",
    category: "vector",
    badge: "topo",
    tooltip: "RELIEF TOPOGRAPHY",
    fallbackStyle: {
      backgroundColor: "#e8ddc2",
      backgroundImage:
        "radial-gradient(circle at 24% 72%, rgba(112,160,90,0.55) 0 18%, transparent 19%), linear-gradient(64deg, transparent 46%, rgba(255,255,255,0.9) 46% 50%, transparent 50%)",
    },
  },
  {
    id: "bright",
    name: "Bright",
    category: "vector",
    badge: "streets",
    tooltip: "LIBERTY / BRIGHT STREETS",
    fallbackStyle: {
      backgroundColor: "#f0e7d2",
      backgroundImage:
        "radial-gradient(circle at 30% 40%, rgba(120,168,96,0.55) 0 16%, transparent 17%), linear-gradient(58deg, transparent 48%, rgba(255,255,255,0.95) 48% 52%, transparent 52%)",
    },
  },
  {
    id: "openstreetmap",
    name: "OpenStreetMap",
    category: "streets",
    badge: "osm",
    tooltip: "STANDARD OPENSTREETMAP",
    tileUrl: "https://tile.openstreetmap.org/10/586/384.png",
    fallbackStyle: {
      backgroundColor: "#f3f0e8",
      backgroundImage:
        "linear-gradient(88deg, transparent 39%, rgba(255,255,255,0.96) 39% 42%, transparent 42%), radial-gradient(circle at 26% 28%, rgba(170,211,223,0.9) 0 15%, transparent 16%)",
    },
  },
];

export function HorizontalBasemapTray() {
  const basemapTrayOpen = useUiStore((state) => state.basemapTrayOpen);
  const setBasemapTrayOpen = useUiStore((state) => state.setBasemapTrayOpen);
  const basemap = useUiStore((state) => state.basemap);
  const setBasemap = useUiStore((state) => state.setBasemap);
  const graticule = useUiStore((state) => state.graticule);
  const setGraticule = useUiStore((state) => state.setGraticule);
  const trafficFlow = useUiStore((state) => state.trafficFlow);
  const setTrafficFlow = useUiStore((state) => state.setTrafficFlow);

  const [overlaysPopoverOpen, setOverlaysPopoverOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const trayRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const overlaysRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!basemapTrayOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (
        trayRef.current &&
        !trayRef.current.contains(e.target as Node)
      ) {
        setBasemapTrayOpen(false);
        setOverlaysPopoverOpen(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [basemapTrayOpen, setBasemapTrayOpen]);

  if (!basemapTrayOpen) return null;

  return (
    <div
      ref={trayRef}
      className="pointer-events-auto absolute left-[var(--ribbon-w)] right-[var(--ribbon-w)] bottom-[var(--footer-h)] z-30 flex h-[98px] items-center border-t border-line bg-solid/95 px-2 py-1.5 shadow-panel backdrop-blur-md animate-panel-bottom select-none"
      role="region"
      aria-label="Basemaps and Cartography Tray"
    >
      {/* Horizontal Scrolling Cards Strip */}
      <div
        ref={scrollContainerRef}
        onWheel={(e) => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollLeft += e.deltaY;
          }
        }}
        className="flex flex-1 items-center gap-2 overflow-x-auto py-0.5 px-0.5 scroll-smooth no-scrollbar min-w-0"
      >
        {/* ── Leftmost Special Card: Overlays & Grid (Google Maps Style) ── */}
        <div ref={overlaysRef} className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setOverlaysPopoverOpen((v) => !v)}
            onMouseEnter={() => setHoveredId("overlays")}
            onMouseLeave={() => setHoveredId(null)}
            className={cx(
              "group relative flex h-[88px] w-[88px] flex-shrink-0 flex-col justify-between overflow-hidden rounded-[3px] border text-left transition-all",
              overlaysPopoverOpen || graticule || trafficFlow
                ? "border-cyan-400 bg-cyan-950/20 shadow-[0_0_12px_rgba(6,182,212,0.35)] ring-1 ring-cyan-400"
                : "border-line/80 bg-tint/60 hover:border-line-strong hover:scale-[1.02]"
            )}
            title="Tactical Overlays & Grid"
          >
            {/* Visual Vector Grid Illustration Background */}
            <div
              className="absolute inset-0 bg-[#16202c]"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 50% 50%, rgba(6,182,212,0.2) 0%, transparent 65%), linear-gradient(0deg, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
                backgroundSize: "100% 100%, 14px 14px, 14px 14px",
              }}
            />

            {/* Top Indicator */}
            <div className="relative z-10 flex items-center justify-between p-1.5">
              <span className="flex items-center gap-1 rounded bg-black/60 px-1 py-0.5 font-mono text-[7.5px] uppercase font-bold text-cyan-400 backdrop-blur-sm">
                <span>GRID</span>
              </span>
              {(graticule || trafficFlow) && (
                <span className="size-2 rounded-full bg-cyan-400 animate-pulse" />
              )}
            </div>

            {/* Bottom Gradient & Text */}
            <div className="relative z-10 flex items-center gap-1.5 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-1.5 pt-3">
              <Layers size={13} className="text-white drop-shadow flex-shrink-0" />
              <span className="truncate font-sans text-[11px] font-bold text-white drop-shadow">
                Layers
              </span>
            </div>
          </button>

          {/* Hover Tooltip */}
          {hoveredId === "overlays" && (
            <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 z-50 whitespace-nowrap rounded-[2px] border border-white/20 bg-black/95 px-2 py-0.5 font-mono text-[8.5px] font-bold tracking-[0.08em] text-white shadow-md">
              TACTICAL OVERLAYS
              <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 border-4 border-transparent border-t-black/95" />
            </div>
          )}
        </div>

        {/* ── Basemap Thumbnail Cards ── */}
        {BASEMAP_META.map((meta) => {
          const isSelected = basemap === meta.id;
          return (
            <div key={meta.id} className="relative flex-shrink-0">
              <button
                type="button"
                onClick={() => setBasemap(meta.id)}
                onMouseEnter={() => setHoveredId(meta.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={cx(
                  "group relative flex h-[88px] w-[144px] flex-shrink-0 flex-col justify-between overflow-hidden rounded-[3px] border text-left transition-all",
                  isSelected
                    ? "border-cyan-400 shadow-[0_0_14px_rgba(6,182,212,0.45)] ring-1 ring-cyan-400"
                    : "border-line/80 hover:border-line-strong hover:scale-[1.02]"
                )}
                aria-pressed={isSelected}
                title={meta.tooltip}
              >
                {/* Background Image / Texture */}
                <div
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-300 group-hover:scale-105"
                  style={{
                    ...meta.fallbackStyle,
                    backgroundImage: meta.tileUrl
                      ? `url(${meta.tileUrl})`
                      : meta.fallbackStyle.backgroundImage,
                  }}
                />

                {/* Top Overlay Badges */}
                <div className="relative z-10 flex items-center justify-between p-1.5">
                  {/* Photo Camera or Category Badge (like user screenshot) */}
                  <span className="flex items-center gap-0.5 rounded bg-black/65 px-1 py-0.5 text-white backdrop-blur-sm">
                    {meta.badge === "photo" && <Camera size={11} />}
                    {meta.badge === "dark" && <Moon size={11} />}
                    {meta.badge === "light" && <Sun size={11} />}
                    {meta.badge === "topo" && <Mountain size={11} />}
                    {meta.badge === "streets" && <MapIcon size={11} />}
                    {meta.badge === "osm" && <Globe size={11} />}
                  </span>

                  {/* Active Checked Badge */}
                  {isSelected && (
                    <span className="grid size-4 place-items-center rounded-full bg-cyan-400 text-black shadow-md">
                      <Check size={10} strokeWidth={3} />
                    </span>
                  )}
                </div>

                {/* Bottom Title Bar with Dark Gradient */}
                <div className="relative z-10 flex flex-col justify-end bg-gradient-to-t from-black/95 via-black/70 to-transparent p-1.5 pt-3">
                  <span className="truncate font-sans text-[11.5px] font-bold text-white drop-shadow-md">
                    {meta.name}
                  </span>
                  <span className="font-mono text-[8px] uppercase tracking-[0.06em] text-zinc-300">
                    {isSelected ? "Active" : meta.category}
                  </span>
                </div>
              </button>

              {/* Hover Tooltip (Matching black pill in user screenshot) */}
              {hoveredId === meta.id && (
                <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 z-50 whitespace-nowrap rounded-[2px] border border-white/20 bg-black/95 px-2 py-0.5 font-mono text-[8.5px] font-bold tracking-[0.08em] text-white shadow-md">
                  {meta.tooltip}
                  <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 border-4 border-transparent border-t-black/95" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pinned Right Dismiss/Close Button */}
      <div className="flex-shrink-0 pl-2 border-l border-line/60 ml-1">
        <button
          type="button"
          onClick={() => setBasemapTrayOpen(false)}
          className="grid size-8 place-items-center rounded-[2px] border border-line/70 bg-tint/60 text-ink-muted transition-colors hover:border-line hover:bg-tint hover:text-ink"
          title="Close basemaps tray (Esc)"
          aria-label="Close tray"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      {/* Popover Drawer for Overlays (rendered at container level to prevent overflow clipping) */}
      {overlaysPopoverOpen && (
        <div className="absolute left-2 bottom-[calc(100%+6px)] z-50 flex w-[210px] flex-col gap-2 rounded-[3px] border border-line bg-solid p-2.5 font-sans text-ink shadow-panel backdrop-blur-md animate-panel-bottom">
          <div className="flex items-center justify-between border-b border-line pb-1.5">
            <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.14em] text-ink-muted">
              Tactical Overlays
            </span>
            <button
              type="button"
              onClick={() => setOverlaysPopoverOpen(false)}
              className="text-ink-muted hover:text-ink"
            >
              <X size={12} />
            </button>
          </div>

          <div className="flex flex-col gap-1.5 text-[11px]">
            <label className="flex items-center justify-between rounded px-1.5 py-1 hover:bg-tint cursor-pointer">
              <span className="text-ink-soft">Graticule Grid</span>
              <input
                type="checkbox"
                checked={graticule}
                onChange={(e) => setGraticule(e.target.checked)}
                className="accent-accent size-3.5"
              />
            </label>

            <label className="flex items-center justify-between rounded px-1.5 py-1 hover:bg-tint cursor-pointer">
              <span className="text-ink-soft">Live Traffic Flow</span>
              <input
                type="checkbox"
                checked={trafficFlow}
                onChange={(e) => setTrafficFlow(e.target.checked)}
                className="accent-accent size-3.5"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
