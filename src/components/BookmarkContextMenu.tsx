import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Edit3,
  Flag,
  Layers,
  MapPin,
  Navigation,
  RotateCw,
  Ruler,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";
import { useUiStore } from "../state/uiStore";
import { flyToBookmark } from "../map/mapController";
import { formatDistance, formatLat, formatLon } from "../lib/format";
import { haversineMeters } from "../lib/gis/geometry";
import { triggerEditBookmark } from "./panels/BookmarksPanel";
import { exportBookmarksToKml } from "../lib/gis/bookmarksIo";
import { saveTextFile } from "../lib/fileIo";
import { cx } from "../lib/cx";
import type { BookmarkPriority, BookmarkTier } from "../lib/gis/types";

const MENU_WIDTH = 260;
const MENU_HEIGHT = 440;
const PADDING = 8;

export function BookmarkContextMenu() {
  const menu = useMapStore((state) => state.bookmarkContextMenu);
  const setMenu = useMapStore((state) => state.setBookmarkContextMenu);
  const bookmarks = useProjectStore((state) => state.bookmarks);
  const updateBookmark = useProjectStore((state) => state.updateBookmark);
  const removeBookmark = useProjectStore((state) => state.removeBookmark);
  const flash = useUiStore((state) => state.flash);
  const coordFormat = useUiStore((state) => state.coordFormat);
  const camera = useMapStore((state) => state.camera);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    if (!menu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu, setMenu]);

  if (!menu) return null;

  const targetBookmark = bookmarks.find((b) => b.id === menu.bookmarkId);
  if (!targetBookmark) return null;

  // Viewport clamping
  const winW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const winH = typeof window !== "undefined" ? window.innerHeight : 800;
  const x = Math.min(Math.max(menu.x, PADDING), winW - MENU_WIDTH - PADDING);
  const y = Math.min(Math.max(menu.y, PADDING), winH - MENU_HEIGHT - PADDING);

  const bm = targetBookmark;
  const distMeters = haversineMeters([camera.lon, camera.lat], [bm.lon, bm.lat]);

  const copyToClipboard = async (text: string, label: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      flash(`Copied ${label}`);
      setTimeout(() => setCopiedKey(null), 1400);
    } catch {
      flash("Failed to copy to clipboard");
    }
  };

  const handleFlyTo = () => {
    flyToBookmark(bm);
    flash(`Centered on "${bm.title}"`);
    setMenu(null);
  };

  const handleOpenEdit = () => {
    triggerEditBookmark(bm.id);
    setMenu(null);
  };

  const handleSnapToCamera = () => {
    updateBookmark(bm.id, {
      lon: camera.lon,
      lat: camera.lat,
      zoom: Math.round(camera.zoom * 10) / 10,
      rotation: camera.rotation ?? 0,
    });
    flash(`Snapped "${bm.title}" to current camera coordinates`);
    setMenu(null);
  };

  const handleSetPriority = (priority: BookmarkPriority) => {
    updateBookmark(bm.id, { priority });
    flash(`Updated priority for "${bm.title}" to ${priority.toUpperCase()}`);
  };

  const handleToggleTier = () => {
    const nextTier: BookmarkTier = bm.tier === "user" ? "project" : "user";
    updateBookmark(bm.id, { tier: nextTier });
    flash(`Moved note to ${nextTier === "user" ? "Personal User" : "Shared Project"} storage tier`);
  };

  const handleMeasureFromHere = () => {
    const uiState = useUiStore.getState();
    if (uiState.viewMode === "3d") {
      uiState.notify("Measuring works on the 2D map — switch back to 2D");
      setMenu(null);
      return;
    }
    useProjectStore.getState().setMeasureMode("distance");
    uiState.openPanel("measure");
    flash(`Measurement mode activated from "${bm.title}"`);
    setMenu(null);
  };

  const handleOpenBuffer = () => {
    useUiStore.getState().openPanel("buffer");
    flash(`Threat / Range Ring buffer analysis opened for "${bm.title}"`);
    setMenu(null);
  };

  const handleExportKml = async () => {
    try {
      const safeName = bm.title.replace(/[^\w-]+/g, "_");
      await saveTextFile(
        `${safeName}.kml`,
        exportBookmarksToKml([bm], bm.title),
        [{ name: "OGC KML", extensions: ["kml"] }],
        "application/vnd.google-earth.kml+xml",
      );
      flash(`Exported "${bm.title}" as KML placemark`);
      setMenu(null);
    } catch (e) {
      flash(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDelete = () => {
    removeBookmark(bm.id);
    flash(`Deleted note "${bm.title}"`);
    setMenu(null);
  };

  return (
    <div
      ref={menuRef}
      className="pointer-events-auto fixed z-50 flex w-[260px] flex-col rounded-[2px] border border-[#2b3142] bg-[#13161f]/95 text-ink shadow-[0_12px_36px_rgba(0,0,0,0.7)] backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
      style={{ left: `${x}px`, top: `${y}px` }}
      role="menu"
      aria-label={`Options for ${bm.title}`}
    >
      {/* Header with Title, Color, Tier and Priority badges */}
      <div className="flex items-start justify-between gap-2 border-b border-[#232733] bg-[#1a1e2b] px-3 py-2.5">
        <div className="flex flex-1 items-start gap-2 overflow-hidden">
          <span
            className="mt-1 inline-block size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: bm.color || "#00e5ff" }}
          />
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={cx(
                  "rounded-[2px] border px-1 font-mono text-[7.5px] font-bold uppercase tracking-wider",
                  bm.tier === "user"
                    ? "border-purple-500/30 bg-purple-950/40 text-purple-300"
                    : "border-cyan-500/30 bg-cyan-950/40 text-cyan-300",
                )}
              >
                {bm.tier === "user" ? "USER" : "PROJ"}
              </span>

              {bm.priority && bm.priority !== "routine" && (
                <span
                  className={cx(
                    "rounded-[2px] px-1 font-mono text-[7.5px] font-bold uppercase tracking-wider",
                    bm.priority === "flash"
                      ? "bg-critical-20 text-critical border border-critical/40 animate-pulse"
                      : bm.priority === "immediate"
                        ? "bg-orange-950/40 text-orange-400 border border-orange-500/40"
                        : "bg-amber-950/40 text-amber-400 border border-amber-500/40",
                  )}
                >
                  {bm.priority}
                </span>
              )}

              {bm.category && (
                <span className="font-mono text-[9.5px] text-ink-muted truncate">
                  {bm.category}
                </span>
              )}
            </div>

            <div className="mt-0.5 truncate text-[11px] font-bold text-ink" title={bm.title}>
              {bm.title}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setMenu(null)}
          className="text-ink-muted hover:text-ink transition-colors"
          title="Close menu"
        >
          <X size={13} />
        </button>
      </div>

      {/* Coordinate & Distance Subheader */}
      <div className="flex items-center justify-between border-b border-[#232733] bg-[#161a25] px-3 py-1.5 font-mono text-[8.5px] text-ink-muted">
        <span className="flex items-center gap-1">
          <MapPin size={9} className="text-accent" />
          {formatLat(bm.lat, coordFormat)}, {formatLon(bm.lon, coordFormat)}
        </span>
        <span className="text-accent/90 font-medium">
          {formatDistance(distMeters)} away
        </span>
      </div>

      {/* Menu Actions List */}
      <div className="flex flex-col p-1 text-[10.5px]">
        {/* Fly To */}
        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] font-semibold text-accent hover:bg-[#1e2330] transition-colors"
          onClick={handleFlyTo}
        >
          <Navigation size={12} className="flex-none text-accent" />
          <span className="flex-1">Fly To & Inspect Fix</span>
          <span className="font-mono text-[8.5px] text-accent/80">Z{bm.zoom}</span>
        </button>

        {/* Edit Note */}
        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
          onClick={handleOpenEdit}
        >
          <Edit3 size={12} className="flex-none text-ink-muted" />
          <span className="flex-1">Edit Note Properties</span>
        </button>

        {/* Measure From Here */}
        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
          onClick={handleMeasureFromHere}
        >
          <Ruler size={12} className="flex-none text-ink-muted" />
          <span className="flex-1">Range & Bearing from Here</span>
          <span className="font-mono text-[8.5px] text-ink-muted">R&B</span>
        </button>

        {/* Threat Buffer / Radial Range */}
        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
          onClick={handleOpenBuffer}
        >
          <ShieldAlert size={12} className="flex-none text-ink-muted" />
          <span className="flex-1">Threat / Range Ring Buffer</span>
          <span className="font-mono text-[8.5px] text-ink-muted">Radius</span>
        </button>

        {/* Snap Fix to Current Camera */}
        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
          onClick={handleSnapToCamera}
        >
          <RotateCw size={12} className="flex-none text-ink-muted" />
          <span className="flex-1">Snap Fix to Current Camera</span>
        </button>

        <div className="my-1 border-t border-[#232733]" />

        {/* Priority Quick Triage Section */}
        <div className="px-2 py-1">
          <div className="mb-1 flex items-center justify-between font-mono text-[9.5px] uppercase tracking-wider text-ink-muted">
            <span className="flex items-center gap-1">
              <Flag size={9} />
              <span>Priority Triage</span>
            </span>
            <span className="text-accent uppercase font-bold">{bm.priority ?? "routine"}</span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {(["routine", "priority", "immediate", "flash"] as BookmarkPriority[]).map((p) => {
              const isPrioActive = (bm.priority ?? "routine") === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleSetPriority(p)}
                  className={cx(
                    "h-5 rounded-[2px] border font-mono text-[7.5px] font-bold uppercase transition-colors",
                    isPrioActive
                      ? p === "flash"
                        ? "border-red-500 bg-red-950/60 text-red-300 ring-1 ring-red-500"
                        : p === "immediate"
                          ? "border-orange-500 bg-orange-950/60 text-orange-300 ring-1 ring-orange-500"
                          : p === "priority"
                            ? "border-amber-500 bg-amber-950/60 text-amber-300 ring-1 ring-amber-500"
                            : "border-cyan-500 bg-cyan-950/60 text-cyan-300 ring-1 ring-cyan-500"
                      : "border-[#2b3142] bg-[#161a25] text-ink-muted hover:text-ink hover:bg-[#1e2330]",
                  )}
                >
                  {p.slice(0, 4)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Storage Tier Toggle */}
        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
          onClick={handleToggleTier}
        >
          <Layers size={12} className="flex-none text-ink-muted" />
          <span className="flex-1">
            Storage: Switch to {bm.tier === "user" ? "Shared Project" : "Personal User"}
          </span>
        </button>

        {/* Copy Coordinates */}
        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
          onClick={() =>
            copyToClipboard(
              `${formatLat(bm.lat, coordFormat)}, ${formatLon(bm.lon, coordFormat)}`,
              "coordinates",
              "coords",
            )
          }
        >
          {copiedKey === "coords" ? (
            <Check size={12} className="flex-none text-ok" />
          ) : (
            <Copy size={12} className="flex-none text-ink-muted" />
          )}
          <span className="flex-1">Copy Coordinates</span>
        </button>

        {/* Export Placemark */}
        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
          onClick={handleExportKml}
        >
          <Download size={12} className="flex-none text-ink-muted" />
          <span className="flex-1">Export Placemark (KML)</span>
        </button>

        <div className="my-1 border-t border-[#232733]" />

        {/* Delete Note */}
        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] text-critical hover:bg-critical/15 transition-colors"
          onClick={handleDelete}
        >
          <Trash2 size={12} className="flex-none text-critical" />
          <span className="flex-1">Delete Note</span>
        </button>
      </div>
    </div>
  );
}
