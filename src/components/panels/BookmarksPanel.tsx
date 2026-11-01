import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bookmark as BookmarkIcon,
  Calendar,
  Check,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  MapPin,
  Navigation,
  Pause,
  Play,
  Plus,
  RotateCw,
  Ruler,
  Search,
  ShieldAlert,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { PanelShell } from "../PanelShell";
import { useProjectStore } from "../../state/projectStore";
import { useMapStore } from "../../state/mapStore";
import { useUiStore } from "../../state/uiStore";
import {
  clearBookmarkOverlay,
  flyToBookmark,
  renderBookmarkOverlay,
  setBookmarkPinPicker,
  setBookmarkSelectHandler,
} from "../../map/mapController";
import { formatDistance, formatLat, formatLon } from "../../lib/format";
import { haversineMeters } from "../../lib/gis/geometry";
import { cx } from "../../lib/cx";
import type {
  Bookmark,
  BookmarkPriority,
  BookmarkStatus,
  BookmarkTier,
} from "../../lib/gis/types";
import { openTextFile, saveTextFile } from "../../lib/fileIo";
import {
  exportBookmarksToCsv,
  exportBookmarksToGeoJson,
  exportBookmarksToKml,
  importBookmarksFromCsv,
  importBookmarksFromGeoJson,
  importBookmarksFromKml,
} from "../../lib/gis/bookmarksIo";

const COLOR_PRESETS = [
  "#00e5ff", // Tactical Cyan (Default)
  "#f59e0b", // Warning Amber
  "#ef4444", // Flash Red
  "#10b981", // Emerald Recon
  "#3b82f6", // Electric Blue
  "#8b5cf6", // Intel Violet
  "#ec4899", // Neon Pink
  "#f43f5e", // Rose Crimson
];

const CATEGORY_PRESETS = [
  "Observation",
  "Recon",
  "Logistics",
  "Incident",
  "Checkpoint",
  "POI",
  "Maritime",
];

type PanelMode = "list" | "details" | "edit" | "add";
type SortOrder = "newest" | "oldest" | "title" | "priority" | "distance";

let externalEditOpener: ((bookmarkId: string) => void) | null = null;

export function triggerEditBookmark(bookmarkId: string): void {
  useUiStore.getState().openPanel("bookmarks");
  if (externalEditOpener) {
    externalEditOpener(bookmarkId);
  }
}

export function BookmarksPanel() {
  const bookmarks = useProjectStore((state) => state.bookmarks);
  const projectName = useProjectStore((state) => state.projectName);
  const addBookmark = useProjectStore((state) => state.addBookmark);
  const removeBookmark = useProjectStore((state) => state.removeBookmark);
  const updateBookmark = useProjectStore((state) => state.updateBookmark);

  const closePanel = useUiStore((state) => state.closePanel);
  const flash = useUiStore((state) => state.flash);
  const coordFormat = useUiStore((state) => state.coordFormat);
  const camera = useMapStore((state) => state.camera);

  // Main navigation mode: list, details, edit, or add
  const [panelMode, setPanelMode] = useState<PanelMode>("list");
  const [selectedBookmarkId, setSelectedBookmarkId] = useState<string | null>(null);

  // Search, filter, and sort
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | BookmarkTier>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | BookmarkPriority>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [showFilters, setShowFilters] = useState(false);

  // Overlay visibility on map canvas
  const [showOnMap, setShowOnMap] = useState(true);

  // Pin dropper tool
  const [isDroppingPin, setIsDroppingPin] = useState(false);

  // Edit / Add Form fields
  const [formTitle, setFormTitle] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formTier, setFormTier] = useState<BookmarkTier>("project");
  const [formPriority, setFormPriority] = useState<BookmarkPriority>("routine");
  const [formStatus, setFormStatus] = useState<BookmarkStatus>("active");
  const [formCategory, setFormCategory] = useState("");
  const [formColor, setFormColor] = useState("#00e5ff");
  const [formTagInput, setFormTagInput] = useState("");
  const [formLon, setFormLon] = useState<number>(camera.lon);
  const [formLat, setFormLat] = useState<number>(camera.lat);
  const [formZoom, setFormZoom] = useState<number>(Math.round(camera.zoom));
  const [formRotation, setFormRotation] = useState<number>(camera.rotation ?? 0);

  // Feedback states
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isIoMenuOpen, setIsIoMenuOpen] = useState(false);

  // Tour mode state
  const [tourActive, setTourActive] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [tourPlaying, setTourPlaying] = useState(false);
  const [tourDwellSec, setTourDwellSec] = useState(4);
  const tourTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Synchronize tactical overlay layer on map canvas
  useEffect(() => {
    if (showOnMap) {
      renderBookmarkOverlay(bookmarks, selectedBookmarkId);
    } else {
      clearBookmarkOverlay();
    }
  }, [bookmarks, showOnMap, selectedBookmarkId]);

  // Hook up click listener from map canvas to highlight and open note details
  useEffect(() => {
    setBookmarkSelectHandler((hitId) => {
      setSelectedBookmarkId(hitId);
      const target = bookmarks.find((b) => b.id === hitId);
      if (target) {
        setPanelMode("details");
        flash(`Selected note: "${target.title}"`);
      }
    });

    return () => {
      setBookmarkSelectHandler(null);
      setBookmarkPinPicker(null);
    };
  }, [bookmarks, flash]);

  // Support external triggers (e.g. from context menu) to open editor
  useEffect(() => {
    externalEditOpener = (bId: string) => {
      const target = bookmarks.find((b) => b.id === bId);
      if (target) {
        handleOpenEdit(target);
      }
    };
    return () => {
      externalEditOpener = null;
    };
  }, [bookmarks]);

  // Active note in details mode
  const currentDetailBookmark = useMemo(() => {
    if (!selectedBookmarkId) return null;
    return bookmarks.find((b) => b.id === selectedBookmarkId) || null;
  }, [bookmarks, selectedBookmarkId]);

  // Open Details view
  const handleOpenDetails = (bm: Bookmark) => {
    setSelectedBookmarkId(bm.id);
    setPanelMode("details");
    flyToBookmark(bm);
  };

  // Open Edit view
  const handleOpenEdit = (bm: Bookmark) => {
    setSelectedBookmarkId(bm.id);
    setFormTitle(bm.title);
    setFormNotes(bm.notes ?? "");
    setFormTier(bm.tier ?? "project");
    setFormPriority(bm.priority ?? "routine");
    setFormStatus(bm.status ?? "active");
    setFormCategory(bm.category ?? "");
    setFormColor(bm.color ?? "#00e5ff");
    setFormTagInput((bm.tags ?? []).join(", "));
    setFormLon(bm.lon);
    setFormLat(bm.lat);
    setFormZoom(bm.zoom);
    setFormRotation(bm.rotation ?? 0);
    setPanelMode("edit");
  };

  // Open Add view
  const handleOpenAdd = () => {
    setFormTitle("");
    setFormNotes("");
    setFormTier("project");
    setFormPriority("routine");
    setFormStatus("active");
    setFormCategory("");
    setFormColor("#00e5ff");
    setFormTagInput("");
    setFormLon(camera.lon);
    setFormLat(camera.lat);
    setFormZoom(Math.round(camera.zoom));
    setFormRotation(camera.rotation ?? 0);
    setPanelMode("add");
  };

  // Interactive Map Pin Dropper
  const handleStartDropPin = () => {
    if (isDroppingPin) {
      setIsDroppingPin(false);
      setBookmarkPinPicker(null);
      return;
    }

    setIsDroppingPin(true);
    flash("Click anywhere on the map to place a tactical note pin");

    setBookmarkPinPicker(([lon, lat]) => {
      setIsDroppingPin(false);
      setBookmarkPinPicker(null);

      setFormLon(lon);
      setFormLat(lat);
      setFormZoom(Math.max(12, Math.round(camera.zoom)));
      setFormRotation(camera.rotation ?? 0);
      setFormTitle("");
      setFormNotes("");
      setFormTier("project");
      setFormPriority("routine");
      setFormStatus("active");
      setFormCategory("");
      setFormColor("#00e5ff");
      setFormTagInput("");
      setPanelMode("add");
      flash("Coordinates captured. Add details and save note.");
    });
  };

  // Snap / Update to Current Camera View
  const handleUpdateToCurrentView = () => {
    setFormLon(camera.lon);
    setFormLat(camera.lat);
    setFormZoom(Math.round(camera.zoom * 10) / 10);
    setFormRotation(camera.rotation ?? 0);
    flash("Updated fix and heading to current camera view");
  };

  // Save (Create or Update)
  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) return;

    const tags = formTagInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (panelMode === "edit" && selectedBookmarkId) {
      updateBookmark(selectedBookmarkId, {
        title: formTitle.trim(),
        notes: formNotes.trim() || undefined,
        tags: tags.length ? tags : undefined,
        tier: formTier,
        priority: formPriority,
        status: formStatus,
        category: formCategory.trim() || undefined,
        color: formColor,
        lon: formLon,
        lat: formLat,
        zoom: formZoom,
        rotation: formRotation,
      });
      flash(`Updated note "${formTitle.trim()}"`);
      setPanelMode("details");
    } else {
      const created = addBookmark({
        title: formTitle.trim(),
        notes: formNotes.trim() || undefined,
        tags: tags.length ? tags : undefined,
        tier: formTier,
        priority: formPriority,
        status: formStatus,
        category: formCategory.trim() || undefined,
        color: formColor,
        lon: formLon,
        lat: formLat,
        zoom: formZoom,
        rotation: formRotation,
      });
      flash(`Recorded note "${formTitle.trim()}"`);
      setSelectedBookmarkId(created.id);
      setPanelMode("details");
    }
  };

  // Fly to bookmark
  const handleFlyTo = (bm: Bookmark) => {
    setSelectedBookmarkId(bm.id);
    flyToBookmark(bm);
    flash(`Centered on "${bm.title}"`);
  };

  // Copy coordinates
  const handleCopyCoords = (id: string, lon: number, lat: number) => {
    const text = `${formatLat(lat, coordFormat)}, ${formatLon(lon, coordFormat)}`;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    flash("Coordinates copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Export handlers
  const handleExport = async (format: "geojson" | "kml" | "csv") => {
    const safeName = (projectName || "strata-bookmarks").replace(/[^\w-]+/g, "_");
    setIsIoMenuOpen(false);

    try {
      if (format === "geojson") {
        await saveTextFile(
          `${safeName}.geojson`,
          exportBookmarksToGeoJson(bookmarks),
          [{ name: "GeoJSON", extensions: ["geojson", "json"] }],
          "application/geo+json",
        );
      } else if (format === "kml") {
        await saveTextFile(
          `${safeName}.kml`,
          exportBookmarksToKml(bookmarks, projectName),
          [{ name: "OGC KML", extensions: ["kml"] }],
          "application/vnd.google-earth.kml+xml",
        );
      } else if (format === "csv") {
        await saveTextFile(
          `${safeName}.csv`,
          exportBookmarksToCsv(bookmarks),
          [{ name: "CSV", extensions: ["csv"] }],
          "text/csv",
        );
      }
      flash(`Exported ${bookmarks.length} notes to ${format.toUpperCase()}`);
    } catch (e) {
      flash(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Import handler
  const handleImport = async () => {
    setIsIoMenuOpen(false);
    try {
      const file = await openTextFile([
        {
          name: "Spatial & Bookmark Data",
          extensions: ["geojson", "json", "kml", "csv"],
        },
      ]);
      if (!file) return;

      let imported: Bookmark[] = [];
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith(".kml") || file.text.includes("<kml")) {
        imported = importBookmarksFromKml(file.text, "project");
      } else if (
        lowerName.endsWith(".csv") ||
        file.text.includes("longitude") ||
        file.text.includes("lat,")
      ) {
        imported = importBookmarksFromCsv(file.text, "project");
      } else {
        imported = importBookmarksFromGeoJson(file.text, "project");
      }

      if (imported.length === 0) {
        flash("No valid coordinates found in file to import");
        return;
      }

      for (const bm of imported) {
        addBookmark(bm);
      }

      flash(`Successfully imported ${imported.length} notes from ${file.name}`);
    } catch (e) {
      flash(`Import error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Filter & Sort bookmarks
  const filteredBookmarks = useMemo(() => {
    let list = bookmarks.filter((b) => {
      if (tierFilter !== "all" && (b.tier ?? "project") !== tierFilter) return false;
      if (priorityFilter !== "all" && (b.priority ?? "routine") !== priorityFilter) return false;
      if (categoryFilter !== "all" && (b.category || "Uncategorized") !== categoryFilter)
        return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesTitle = b.title.toLowerCase().includes(q);
        const matchesNotes = b.notes ? b.notes.toLowerCase().includes(q) : false;
        const matchesCategory = b.category ? b.category.toLowerCase().includes(q) : false;
        const matchesTags = b.tags ? b.tags.some((t) => t.toLowerCase().includes(q)) : false;
        if (!matchesTitle && !matchesNotes && !matchesCategory && !matchesTags) return false;
      }

      return true;
    });

    list = [...list].sort((a, b) => {
      if (sortOrder === "newest") return b.createdAt - a.createdAt;
      if (sortOrder === "oldest") return a.createdAt - b.createdAt;
      if (sortOrder === "title") return a.title.localeCompare(b.title);
      if (sortOrder === "priority") {
        const weights: Record<string, number> = {
          flash: 4,
          immediate: 3,
          priority: 2,
          routine: 1,
        };
        const wa = weights[a.priority ?? "routine"] || 0;
        const wb = weights[b.priority ?? "routine"] || 0;
        return wb - wa;
      }
      if (sortOrder === "distance") {
        const distA = haversineMeters([camera.lon, camera.lat], [a.lon, a.lat]);
        const distB = haversineMeters([camera.lon, camera.lat], [b.lon, b.lat]);
        return distA - distB;
      }
      return 0;
    });

    return list;
  }, [
    bookmarks,
    search,
    tierFilter,
    priorityFilter,
    categoryFilter,
    sortOrder,
    camera.lon,
    camera.lat,
  ]);

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    for (const b of bookmarks) {
      if (b.category) set.add(b.category);
    }
    return Array.from(set);
  }, [bookmarks]);

  // Briefing Tour runner effect
  useEffect(() => {
    if (!tourActive || !tourPlaying || filteredBookmarks.length === 0) {
      if (tourTimerRef.current) clearTimeout(tourTimerRef.current);
      return;
    }

    const current = filteredBookmarks[tourIndex];
    if (current) {
      flyToBookmark(current, 900);
      setSelectedBookmarkId(current.id);
    }

    tourTimerRef.current = setTimeout(() => {
      setTourIndex((prev) => (prev + 1) % filteredBookmarks.length);
    }, tourDwellSec * 1000);

    return () => {
      if (tourTimerRef.current) clearTimeout(tourTimerRef.current);
    };
  }, [tourActive, tourPlaying, tourIndex, tourDwellSec, filteredBookmarks]);

  const handleStartTour = () => {
    if (filteredBookmarks.length === 0) {
      flash("No bookmarks available to tour");
      return;
    }
    setTourActive(true);
    setTourIndex(0);
    setTourPlaying(true);
    const first = filteredBookmarks[0];
    flyToBookmark(first, 900);
    setSelectedBookmarkId(first.id);
  };

  const handleTourNext = () => {
    if (filteredBookmarks.length === 0) return;
    const nextIdx = (tourIndex + 1) % filteredBookmarks.length;
    setTourIndex(nextIdx);
    const next = filteredBookmarks[nextIdx];
    flyToBookmark(next, 900);
    setSelectedBookmarkId(next.id);
  };

  const handleTourPrev = () => {
    if (filteredBookmarks.length === 0) return;
    const prevIdx = (tourIndex - 1 + filteredBookmarks.length) % filteredBookmarks.length;
    setTourIndex(prevIdx);
    const prev = filteredBookmarks[prevIdx];
    flyToBookmark(prev, 900);
    setSelectedBookmarkId(prev.id);
  };

  // Determine panel expanded state
  const isExpandedView = panelMode === "details" || panelMode === "edit" || panelMode === "add";

  // Dynamic panel title and eyebrow
  const panelTitle =
    panelMode === "details" && currentDetailBookmark
      ? currentDetailBookmark.title
      : panelMode === "edit"
      ? "Edit Note"
      : panelMode === "add"
      ? "New Note"
      : "Bookmarks & Notes";

  const panelEyebrow =
    panelMode === "details" && currentDetailBookmark
      ? `${currentDetailBookmark.tier === "user" ? "Personal" : "Project"} Note`
      : panelMode === "edit" || panelMode === "add"
      ? "Saved Location"
      : "GIS Bookmarks";

  return (
    <PanelShell
      title={panelTitle}
      eyebrow={panelEyebrow}
      side="left"
      flush={true}
      expanded={isExpandedView}
      onClose={() => closePanel("left")}
      headerLeading={
        isExpandedView ? (
          <button
            type="button"
            onClick={() => {
              if (panelMode === "edit" && selectedBookmarkId) {
                setPanelMode("details");
              } else {
                setPanelMode("list");
              }
            }}
            className="flex size-6 items-center justify-center rounded-[2px] text-ink-muted transition-colors hover:bg-tint hover:text-ink -ml-1 mr-0.5"
            title="Back"
            aria-label="Back"
          >
            <ArrowLeft size={14} strokeWidth={2} />
          </button>
        ) : undefined
      }
      footer={
        <div className="flex w-full items-center justify-between text-[10px]">
          <span>
            {bookmarks.length} note{bookmarks.length === 1 ? "" : "s"} (
            {bookmarks.filter((b) => b.tier !== "user").length} project,{" "}
            {bookmarks.filter((b) => b.tier === "user").length} user)
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[9px] text-accent">
            <span
              className={cx(
                "inline-block size-1.5 rounded-full",
                showOnMap ? "bg-ok shadow-[0_0_6px_rgba(34,197,94,0.6)]" : "bg-ink-muted",
              )}
            />
            {showOnMap ? "PINS VISIBLE" : "PINS HIDDEN"}
          </span>
        </div>
      }
    >
      <div className="flex flex-col h-full overflow-hidden">
        {/* ========================================================================= */}
        {/* 1. SEPARATE NOTE DETAILS VIEW (Increased width with back button)          */}
        {/* ========================================================================= */}
        {panelMode === "details" && currentDetailBookmark && (
          <div className="flex flex-col overflow-y-auto p-4 animate-in fade-in slide-in-from-right-4 duration-200">
            {/* Top Status Bar */}
            <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2">
                <span
                  className="size-3 rounded-full shrink-0 shadow-sm"
                  style={{ backgroundColor: currentDetailBookmark.color || "#00e5ff" }}
                />
                <span
                  className={cx(
                    "rounded-[2px] border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider",
                    currentDetailBookmark.tier === "user"
                      ? "border-purple-500/30 bg-purple-950/40 text-purple-300"
                      : "border-cyan-500/30 bg-cyan-950/40 text-cyan-300",
                  )}
                >
                  {currentDetailBookmark.tier === "user" ? "Personal" : "Project"}
                </span>

                <span
                  className={cx(
                    "rounded-[2px] px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider",
                    currentDetailBookmark.priority === "flash"
                      ? "bg-critical-20 text-critical border border-critical/40 animate-pulse"
                      : currentDetailBookmark.priority === "immediate"
                      ? "bg-orange-950/40 text-orange-400 border border-orange-500/40"
                      : currentDetailBookmark.priority === "priority"
                      ? "bg-amber-950/40 text-amber-400 border border-amber-500/40"
                      : "bg-white/[0.04] border border-white/10 text-ink-muted",
                  )}
                >
                  {currentDetailBookmark.priority === "routine"
                    ? "NORMAL"
                    : currentDetailBookmark.priority?.toUpperCase() ?? "NORMAL"}
                </span>

                {currentDetailBookmark.status && (
                  <span className="font-mono text-[8.5px] uppercase text-ink-muted border border-white/10 bg-white/[0.03] px-1.5 py-0.5">
                    {currentDetailBookmark.status}
                  </span>
                )}
              </div>

              {currentDetailBookmark.category && (
                <span className="border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[8.5px] font-semibold text-accent">
                  {currentDetailBookmark.category}
                </span>
              )}
            </div>

            {/* Title & Notes Dossier */}
            <div className="mt-3.5 flex flex-col gap-1.5">
              <h1 className="text-[14px] font-bold text-ink leading-snug">
                {currentDetailBookmark.title}
              </h1>

              {currentDetailBookmark.notes ? (
                <div className="mt-1 rounded-[3px] border border-white/5 bg-white/[0.02] p-3 font-sans text-[11.5px] leading-relaxed text-ink-soft select-text whitespace-pre-wrap">
                  {currentDetailBookmark.notes}
                </div>
              ) : (
                <p className="mt-1 font-mono text-[10.5px] italic text-ink-muted">
                  No notes or description recorded for this location.
                </p>
              )}
            </div>

            {/* Quick Actions Grid */}
            <div className="mt-4 grid grid-cols-3 gap-2 border-y border-white/10 py-2.5">
              <button
                type="button"
                onClick={() => handleFlyTo(currentDetailBookmark)}
                className="flex h-8 items-center justify-center gap-1.5 rounded-[3px] border border-accent bg-accent text-[10.5px] font-semibold text-shell shadow-sm transition-opacity hover:opacity-90"
              >
                <Navigation size={12} />
                <span>Fly To</span>
              </button>

              <button
                type="button"
                onClick={() => handleOpenEdit(currentDetailBookmark)}
                className="flex h-8 items-center justify-center gap-1.5 rounded-[3px] border border-white/10 bg-white/[0.03] text-[10.5px] font-medium text-ink-soft transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-ink"
              >
                <Edit3 size={12} />
                <span>Edit Note</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  handleCopyCoords(
                    currentDetailBookmark.id,
                    currentDetailBookmark.lon,
                    currentDetailBookmark.lat,
                  )
                }
                className="flex h-8 items-center justify-center gap-1.5 rounded-[3px] border border-white/10 bg-white/[0.03] text-[10.5px] font-medium text-ink-soft transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-ink"
              >
                {copiedId === currentDetailBookmark.id ? (
                  <Check size={12} className="text-ok" />
                ) : (
                  <Copy size={12} />
                )}
                <span>Copy Coords</span>
              </button>
            </div>

            {/* Geographic & Camera Coordinates Dossier */}
            <div className="mt-4 flex flex-col gap-2 rounded-[3px] border border-white/5 bg-white/[0.02] p-3 font-mono text-[10px]">
              <div className="flex items-center justify-between border-b border-white/5 pb-1.5 text-ink-muted uppercase tracking-wider text-[8.5px]">
                <span className="flex items-center gap-1">
                  <MapPin size={10} className="text-accent" />
                  <span>Coordinates</span>
                </span>
                <span className="text-accent font-semibold">WGS 84</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-ink">
                <div>
                  <span className="block text-[8px] uppercase text-ink-muted">Coordinates</span>
                  <span className="font-semibold text-[10.5px]">
                    {formatLat(currentDetailBookmark.lat, coordFormat)},{" "}
                    {formatLon(currentDetailBookmark.lon, coordFormat)}
                  </span>
                </div>

                <div>
                  <span className="block text-[8px] uppercase text-ink-muted">Camera Level</span>
                  <span className="font-semibold text-[10.5px]">
                    Zoom {currentDetailBookmark.zoom}
                    {currentDetailBookmark.rotation
                      ? ` · Heading ${Math.round(
                          (((currentDetailBookmark.rotation * 180) / Math.PI) % 360),
                        )}°`
                      : ""}
                  </span>
                </div>

                <div>
                  <span className="block text-[8px] uppercase text-ink-muted">Proximity</span>
                  <span className="font-semibold text-[10.5px] text-accent">
                    {formatDistance(
                      haversineMeters(
                        [camera.lon, camera.lat],
                        [currentDetailBookmark.lon, currentDetailBookmark.lat],
                      ),
                    )}{" "}
                    from view
                  </span>
                </div>

                <div>
                  <span className="block text-[8px] uppercase text-ink-muted">Recorded</span>
                  <span className="text-[10px] text-ink-muted">
                    {new Date(currentDetailBookmark.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            </div>

            {/* Tags */}
            {currentDetailBookmark.tags && currentDetailBookmark.tags.length > 0 && (
              <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[8.5px] uppercase tracking-wider text-ink-muted">
                  Tags:
                </span>
                {currentDetailBookmark.tags.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1 rounded-[2px] border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.04em] text-ink-soft"
                  >
                    <Tag size={8} />
                    {t}
                  </span>
                ))}
              </div>
            )}

            {/* Analytical Tools Shortcuts */}
            <div className="mt-4 flex flex-col gap-1.5">
              <span className="font-mono text-[8px] uppercase tracking-wider text-ink-muted">
                Spatial Operations
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const uiState = useUiStore.getState();
                    if (uiState.viewMode === "3d") {
                      uiState.notify("Measuring works on the 2D map — switch back to 2D");
                      return;
                    }
                    useProjectStore.getState().setMeasureMode("distance");
                    uiState.openPanel("measure");
                    flash(`Distance measurement initiated from "${currentDetailBookmark.title}"`);
                  }}
                  className="flex h-7 items-center justify-center gap-1.5 rounded-[3px] border border-white/10 bg-white/[0.03] text-[10px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
                >
                  <Ruler size={11} />
                  <span>Measure Distance</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    useUiStore.getState().openPanel("buffer");
                    flash(`Buffer analysis opened for "${currentDetailBookmark.title}"`);
                  }}
                  className="flex h-7 items-center justify-center gap-1.5 rounded-[3px] border border-white/10 bg-white/[0.03] text-[10px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
                >
                  <ShieldAlert size={11} />
                  <span>Buffer Query</span>
                </button>
              </div>
            </div>

            {/* Delete button */}
            <div className="mt-6 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => {
                  removeBookmark(currentDetailBookmark.id);
                  flash(`Deleted note "${currentDetailBookmark.title}"`);
                  setPanelMode("list");
                }}
                className="flex h-7 w-full items-center justify-center gap-1.5 rounded-[3px] border border-critical/30 bg-critical-20/20 text-[10.5px] font-semibold text-critical transition-colors hover:bg-critical-20/40"
              >
                <Trash2 size={11} />
                <span>Delete This Note</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 2. DEDICATED NOTE EDIT / ADD FORM VIEW (Increased width with back button) */}
        {/* ========================================================================= */}
        {(panelMode === "edit" || panelMode === "add") && (
          <form
            onSubmit={handleSaveForm}
            className="flex flex-col overflow-y-auto p-4 gap-3 animate-in fade-in slide-in-from-right-4 duration-200 text-ink"
          >
            {/* Location Fix & Camera View Banner */}
            <div className="flex items-center justify-between rounded-[3px] border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-[10px]">
              <div className="flex items-center gap-1.5 font-mono text-ink-muted">
                <MapPin size={11} className="text-accent shrink-0" />
                <span>
                  {formatLat(formLat, coordFormat)}, {formatLon(formLon, coordFormat)}
                </span>
                <span className="text-[9px] text-ink-muted/60">· Z{formZoom}</span>
              </div>
              <button
                type="button"
                onClick={handleUpdateToCurrentView}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono text-ink-muted transition-colors hover:bg-white/10 hover:text-ink"
                title="Update coordinates to current map center"
              >
                <RotateCw size={9} />
                <span>Current view</span>
              </button>
            </div>

            {/* Title */}
            <div className="flex flex-col gap-1">
              <label className="text-[9.5px] font-medium uppercase tracking-wider text-ink-muted">
                Title <span className="text-accent">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="Name or title of this location..."
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                className="h-8 w-full rounded-[3px] border border-white/10 bg-white/[0.03] px-2.5 text-[12px] font-medium text-ink placeholder:text-ink-muted/40 transition-colors hover:border-white/20 focus:border-accent/80 focus:bg-white/[0.05] focus:outline-none"
                autoFocus
              />
            </div>

            {/* Marker Color Row */}
            <div className="flex items-center justify-between py-0.5">
              <span className="text-[9.5px] font-medium uppercase tracking-wider text-ink-muted">
                Marker Color
              </span>
              <div className="flex items-center gap-2">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFormColor(c)}
                    style={{ backgroundColor: c }}
                    aria-label={`Color ${c}`}
                    className={cx(
                      "size-4 rounded-full transition-all",
                      formColor === c
                        ? "scale-125 ring-2 ring-white/90 ring-offset-1 ring-offset-[#0b0f17]"
                        : "opacity-70 hover:opacity-100 hover:scale-110",
                    )}
                  />
                ))}
              </div>
            </div>

            {/* Notes / Description */}
            <div className="flex flex-col gap-1">
              <label className="text-[9.5px] font-medium uppercase tracking-wider text-ink-muted">
                Notes
              </label>
              <textarea
                placeholder="Add description, field observations, or notes..."
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={4}
                className="w-full resize-none rounded-[3px] border border-white/10 bg-white/[0.03] p-2.5 text-[11px] leading-relaxed text-ink placeholder:text-ink-muted/40 transition-colors hover:border-white/20 focus:border-accent/80 focus:bg-white/[0.05] focus:outline-none"
              />
            </div>

            {/* Storage Tier & Priority */}
            <div className="grid grid-cols-2 gap-3 text-[10px]">
              <div className="flex flex-col gap-1">
                <label className="text-[9.5px] font-medium uppercase tracking-wider text-ink-muted">
                  Save to
                </label>
                <div className="flex h-7 rounded-[3px] bg-white/[0.04] p-0.5 border border-white/5">
                  <button
                    type="button"
                    onClick={() => setFormTier("project")}
                    className={cx(
                      "flex-1 rounded-[2px] text-[9.5px] font-medium transition-all",
                      formTier === "project"
                        ? "bg-white/15 text-ink font-semibold shadow-sm"
                        : "text-ink-muted hover:text-ink",
                    )}
                  >
                    Project
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormTier("user")}
                    className={cx(
                      "flex-1 rounded-[2px] text-[9.5px] font-medium transition-all",
                      formTier === "user"
                        ? "bg-purple-500/25 text-purple-200 font-semibold shadow-sm"
                        : "text-ink-muted hover:text-ink",
                    )}
                  >
                    Personal
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[9.5px] font-medium uppercase tracking-wider text-ink-muted">
                  Priority
                </label>
                <select
                  value={formPriority}
                  onChange={(e) => setFormPriority(e.target.value as BookmarkPriority)}
                  className="h-7 w-full rounded-[3px] border border-white/10 bg-[#161a22] px-2 text-[10.5px] text-ink outline-none transition-colors hover:border-white/20 focus:border-accent/80"
                >
                  <option value="routine">Normal</option>
                  <option value="priority">High</option>
                  <option value="immediate">Urgent</option>
                  <option value="flash">Critical</option>
                </select>
              </div>
            </div>

            {/* Category & Status */}
            <div className="grid grid-cols-2 gap-3 text-[10px]">
              <div className="flex flex-col gap-1">
                <label className="text-[9.5px] font-medium uppercase tracking-wider text-ink-muted">
                  Category
                </label>
                <input
                  type="text"
                  list="category-options"
                  placeholder="e.g. Navigation, Survey"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="h-7 w-full rounded-[3px] border border-white/10 bg-white/[0.03] px-2 text-[10.5px] text-ink outline-none placeholder:text-ink-muted/40 transition-colors hover:border-white/20 focus:border-accent/80"
                />
                <datalist id="category-options">
                  {CATEGORY_PRESETS.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[9.5px] font-medium uppercase tracking-wider text-ink-muted">
                  Status
                </label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as BookmarkStatus)}
                  className="h-7 w-full rounded-[3px] border border-white/10 bg-[#161a22] px-2 text-[10.5px] text-ink outline-none transition-colors hover:border-white/20 focus:border-accent/80"
                >
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="resolved">Resolved</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>

            {/* Tags */}
            <div className="flex flex-col gap-1">
              <label className="text-[9.5px] font-medium uppercase tracking-wider text-ink-muted">
                Tags
              </label>
              <input
                type="text"
                placeholder="Separate with commas, e.g. Port, Anchor, Anchorage"
                value={formTagInput}
                onChange={(e) => setFormTagInput(e.target.value)}
                className="h-7 w-full rounded-[3px] border border-white/10 bg-white/[0.03] px-2 text-[10.5px] text-ink placeholder:text-ink-muted/40 outline-none transition-colors hover:border-white/20 focus:border-accent/80"
              />
            </div>

            {/* Action buttons */}
            <div className="mt-2 flex items-center justify-end gap-2 pt-3 border-t border-white/5">
              <button
                type="button"
                onClick={() => {
                  if (panelMode === "edit" && selectedBookmarkId) {
                    setPanelMode("details");
                  } else {
                    setPanelMode("list");
                  }
                }}
                className="h-8 rounded-[3px] px-4 text-[11px] font-medium text-ink-muted transition-colors hover:bg-white/[0.06] hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-8 rounded-[3px] bg-accent px-5 text-[11px] font-semibold text-shell shadow-sm transition-opacity hover:opacity-90 active:scale-[0.98]"
              >
                {panelMode === "edit" ? "Save Changes" : "Save Note"}
              </button>
            </div>
          </form>
        )}

        {/* ========================================================================= */}
        {/* 3. STANDARD LIST VIEW (Original 310px width with rich overview cards)     */}
        {/* ========================================================================= */}
        {panelMode === "list" && (
          <div className="flex flex-col overflow-hidden h-full animate-in fade-in duration-150">
            {/* Primary Action Toolbar */}
            <div className="grid grid-cols-2 divide-x divide-line border-b border-line bg-raised/50">
              <button
                type="button"
                onClick={handleOpenAdd}
                className="flex h-9 items-center justify-center gap-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.05em] bg-accent text-shell hover:opacity-90 transition-colors"
              >
                <Plus size={12} strokeWidth={2.5} />
                <span>Bookmark View</span>
              </button>

              <button
                type="button"
                onClick={handleStartDropPin}
                className={cx(
                  "flex h-9 items-center justify-center gap-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.05em] transition-colors",
                  isDroppingPin
                    ? "bg-accent-soft text-accent border-b-2 border-accent animate-pulse"
                    : "bg-surface hover:bg-tint text-ink",
                )}
                title="Click to activate crosshair pin dropper"
              >
                <MapPin size={12} strokeWidth={2} className="text-accent" />
                <span>{isDroppingPin ? "Click Map Canvas" : "Drop Pin"}</span>
              </button>
            </div>

            {/* Secondary Utility Bar: Map Pins, Tour, Filter, I/O */}
            <div className="flex h-7 items-center justify-between border-b border-line bg-solid px-2 text-[10px] text-ink-muted">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowOnMap((v) => !v)}
                  className={cx(
                    "flex h-5 items-center gap-1 rounded-[2px] px-1.5 font-mono text-[9px] uppercase tracking-wider transition-colors",
                    showOnMap
                      ? "bg-tint text-accent border border-accent/40"
                      : "text-ink-muted hover:text-ink hover:bg-tint",
                  )}
                  title="Toggle visibility of pins on the map canvas"
                >
                  {showOnMap ? <Eye size={10} /> : <EyeOff size={10} />}
                  <span>Map Pins</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (tourActive) {
                      setTourActive(false);
                      setTourPlaying(false);
                    } else {
                      handleStartTour();
                    }
                  }}
                  className={cx(
                    "flex h-5 items-center gap-1 rounded-[2px] px-1.5 font-mono text-[9px] uppercase tracking-wider transition-colors",
                    tourActive
                      ? "bg-accent-soft text-accent border border-accent/40"
                      : "text-ink-muted hover:text-ink hover:bg-tint",
                  )}
                  title="Sequential camera briefing tour across bookmarks"
                >
                  <Navigation size={10} />
                  <span>Tour</span>
                </button>
              </div>

              <div className="relative flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowFilters((v) => !v)}
                  className={cx(
                    "flex h-5 items-center gap-1 rounded-[2px] px-1.5 font-mono text-[9px] transition-colors",
                    showFilters || tierFilter !== "all" || priorityFilter !== "all"
                      ? "bg-tint text-accent"
                      : "text-ink-muted hover:text-ink hover:bg-tint",
                  )}
                  title="Toggle filtering and sorting options"
                >
                  <SlidersHorizontal size={10} />
                  <span>Filter</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsIoMenuOpen((v) => !v)}
                  className="flex h-5 items-center gap-1 rounded-[2px] px-1.5 font-mono text-[9px] text-ink-muted hover:bg-tint hover:text-ink"
                  title="Export or Import bookmarks (KML, GeoJSON, CSV)"
                >
                  <Download size={10} />
                  <span>I/O</span>
                </button>

                {/* I/O Dropdown Menu */}
                {isIoMenuOpen && (
                  <div className="absolute right-0 top-6 z-50 flex w-44 flex-col border border-line bg-raised shadow-xl">
                    <div className="border-b border-line px-2 py-1 font-mono text-[8px] uppercase tracking-wider text-ink-muted">
                      Export Dataset
                    </div>
                    <button
                      type="button"
                      onClick={() => handleExport("kml")}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-left text-[10px] text-ink transition-colors hover:bg-tint hover:text-accent"
                    >
                      <Download size={11} />
                      <span>Google Earth KML 2.2</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExport("geojson")}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-left text-[10px] text-ink transition-colors hover:bg-tint hover:text-accent"
                    >
                      <Download size={11} />
                      <span>GeoJSON FeatureCollection</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExport("csv")}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-left text-[10px] text-ink transition-colors hover:bg-tint hover:text-accent"
                    >
                      <Download size={11} />
                      <span>Spreadsheet CSV</span>
                    </button>
                    <div className="border-y border-line px-2 py-1 font-mono text-[8px] uppercase tracking-wider text-ink-muted">
                      Import Data
                    </div>
                    <button
                      type="button"
                      onClick={handleImport}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-left text-[10px] text-ink transition-colors hover:bg-tint hover:text-accent"
                    >
                      <Upload size={11} />
                      <span>Import KML / GeoJSON / CSV</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Briefing Tour Control Banner */}
            {tourActive && filteredBookmarks.length > 0 && (
              <div className="flex flex-col gap-1 border-b border-line bg-accent-soft/30 px-3 py-2 text-[10px]">
                <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-accent">
                  <span>
                    Tour Step {tourIndex + 1} of {filteredBookmarks.length}
                  </span>
                  <span className="truncate max-w-[140px] text-ink font-semibold">
                    "{filteredBookmarks[tourIndex]?.title}"
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleTourPrev}
                      className="grid size-6 place-items-center border border-line bg-solid text-ink hover:border-accent hover:text-accent"
                      title="Previous Bookmark"
                    >
                      <SkipBack size={11} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setTourPlaying((p) => !p)}
                      className="flex h-6 items-center gap-1 border border-accent bg-accent px-2 text-[10px] font-bold text-shell hover:opacity-90"
                      title={tourPlaying ? "Pause Tour" : "Play Tour"}
                    >
                      {tourPlaying ? <Pause size={10} /> : <Play size={10} />}
                      <span>{tourPlaying ? "Pause" : "Play"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleTourNext}
                      className="grid size-6 place-items-center border border-line bg-solid text-ink hover:border-accent hover:text-accent"
                      title="Next Bookmark"
                    >
                      <SkipForward size={11} />
                    </button>
                  </div>

                  <div className="flex items-center gap-1 font-mono text-[9px] text-ink-muted">
                    <span>Dwell:</span>
                    <select
                      value={tourDwellSec}
                      onChange={(e) => setTourDwellSec(Number(e.target.value))}
                      className="h-5 border border-line bg-solid px-1 text-[9px] text-ink outline-none"
                    >
                      <option value={3}>3s</option>
                      <option value={5}>5s</option>
                      <option value={8}>8s</option>
                      <option value={12}>12s</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => {
                        setTourActive(false);
                        setTourPlaying(false);
                      }}
                      className="ml-1 text-ink-muted hover:text-critical"
                      title="Close Tour"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Filter Drawer */}
            {showFilters && (
              <div className="flex flex-col gap-2 border-b border-line bg-raised/70 p-2.5 text-[10px]">
                <div className="flex items-center justify-between font-mono text-[8.5px] uppercase tracking-wider text-ink-muted">
                  <span>Filter & Sort Criteria</span>
                  <button
                    type="button"
                    onClick={() => {
                      setTierFilter("all");
                      setPriorityFilter("all");
                      setCategoryFilter("all");
                      setSortOrder("newest");
                    }}
                    className="text-accent hover:underline"
                  >
                    Reset All
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <div>
                    <label className="mb-0.5 block font-mono text-[8px] uppercase text-ink-muted">
                      Tier
                    </label>
                    <select
                      value={tierFilter}
                      onChange={(e) => setTierFilter(e.target.value as any)}
                      className="h-6 w-full border border-line bg-solid px-1 text-[9.5px] text-ink outline-none"
                    >
                      <option value="all">All Tiers</option>
                      <option value="project">Project</option>
                      <option value="user">Personal</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-0.5 block font-mono text-[8px] uppercase text-ink-muted">
                      Priority
                    </label>
                    <select
                      value={priorityFilter}
                      onChange={(e) => setPriorityFilter(e.target.value as any)}
                      className="h-6 w-full border border-line bg-solid px-1 text-[9.5px] text-ink outline-none"
                    >
                      <option value="all">All Priorities</option>
                      <option value="flash">Flash</option>
                      <option value="immediate">Immediate</option>
                      <option value="priority">Priority</option>
                      <option value="routine">Routine</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-0.5 block font-mono text-[8px] uppercase text-ink-muted">
                      Sort By
                    </label>
                    <select
                      value={sortOrder}
                      onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                      className="h-6 w-full border border-line bg-solid px-1 text-[9.5px] text-ink outline-none"
                    >
                      <option value="newest">Newest First</option>
                      <option value="oldest">Oldest First</option>
                      <option value="title">Title (A-Z)</option>
                      <option value="priority">Priority High→Low</option>
                      <option value="distance">Distance from Camera</option>
                    </select>
                  </div>
                </div>

                {availableCategories.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 pt-1 font-mono text-[8.5px]">
                    <span className="text-ink-muted">Category:</span>
                    <button
                      type="button"
                      onClick={() => setCategoryFilter("all")}
                      className={cx(
                        "px-1.5 py-0.5 rounded-[2px] transition-colors",
                        categoryFilter === "all"
                          ? "bg-accent text-shell font-bold"
                          : "text-ink-muted hover:text-ink",
                      )}
                    >
                      All
                    </button>
                    {availableCategories.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategoryFilter(cat)}
                        className={cx(
                          "px-1.5 py-0.5 rounded-[2px] transition-colors",
                          categoryFilter === cat
                            ? "bg-accent text-shell font-bold"
                            : "text-ink-muted hover:text-ink",
                        )}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Search Bar */}
            {bookmarks.length > 0 && (
              <div className="relative flex h-8 w-full items-center border-b border-line bg-solid px-3 text-ink-muted transition-colors focus-within:bg-raised">
                <Search size={13} strokeWidth={1.8} className="mr-2 shrink-0 text-ink-muted" />
                <input
                  type="search"
                  placeholder="Filter by title, tag, category, or note..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-full flex-1 border-0 bg-transparent font-sans text-[11px] text-ink outline-none placeholder:text-ink-muted"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="grid size-5 place-items-center text-ink-muted hover:text-ink"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )}

            {/* List of Bookmarks */}
            <div className="flex-1 divide-y divide-line overflow-y-auto">
              {filteredBookmarks.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-4 py-8 text-center text-ink-muted">
                  <BookmarkIcon size={22} className="mb-2 opacity-30" />
                  <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink">
                    {bookmarks.length === 0 ? "No Bookmarks Recorded" : "No Matching Bookmarks"}
                  </div>
                  <p className="mt-1 max-w-[220px] text-[10px] leading-relaxed text-ink-muted">
                    {bookmarks.length === 0
                      ? "Save points of interest, vessel observations, or tactical positions with one click."
                      : "Try a different search term or clear the filter."}
                  </p>
                </div>
              ) : (
                filteredBookmarks.map((bm) => {
                  const isSelected = selectedBookmarkId === bm.id;
                  const distMeters = haversineMeters([camera.lon, camera.lat], [bm.lon, bm.lat]);

                  return (
                    <div
                      key={bm.id}
                      className={cx(
                        "group relative flex flex-col gap-1.5 px-3.5 py-3 transition-colors cursor-pointer",
                        isSelected
                          ? "bg-accent-soft/30 border-l-2 border-accent"
                          : "hover:bg-tint/60",
                      )}
                      onClick={() => handleOpenDetails(bm)}
                    >
                      {/* Header row: Tier Badge, Priority, Title & Quick Icons */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
                          {/* Priority dot */}
                          <span
                            className="inline-block size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: bm.color || "#00e5ff" }}
                            title={`Color: ${bm.color || "#00e5ff"}`}
                          />

                          {/* Tier badge */}
                          <span
                            className={cx(
                              "shrink-0 rounded-[2px] border px-1 py-0.2 font-mono text-[7.5px] font-bold uppercase tracking-wider",
                              bm.tier === "user"
                                ? "border-purple-500/30 bg-purple-950/40 text-purple-300"
                                : "border-cyan-500/30 bg-cyan-950/40 text-cyan-300",
                            )}
                          >
                            {bm.tier === "user" ? "USER" : "PROJ"}
                          </span>

                          {/* Priority tag */}
                          {bm.priority && bm.priority !== "routine" && (
                            <span
                              className={cx(
                                "shrink-0 rounded-[2px] px-1 py-0.2 font-mono text-[7.5px] font-bold uppercase tracking-wider",
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

                          <span className="truncate text-left text-[11.5px] font-bold text-ink transition-colors group-hover:text-accent">
                            {bm.title}
                          </span>
                        </div>

                        {/* Quick action buttons on card */}
                        <div
                          className="flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(bm)}
                            className="grid size-5 place-items-center rounded-[2px] text-ink-muted transition-colors hover:bg-tint hover:text-ink"
                            title="Edit note"
                          >
                            <Edit3 size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyCoords(bm.id, bm.lon, bm.lat)}
                            className="grid size-5 place-items-center rounded-[2px] text-ink-muted transition-colors hover:bg-tint hover:text-ink"
                            title="Copy coordinates"
                          >
                            {copiedId === bm.id ? (
                              <Check size={11} className="text-ok" />
                            ) : (
                              <Copy size={11} />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeBookmark(bm.id)}
                            className="grid size-5 place-items-center rounded-[2px] text-ink-muted transition-colors hover:bg-critical-20 hover:text-critical"
                            title="Delete note"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>

                      {/* Notes excerpt */}
                      {bm.notes && (
                        <p className="line-clamp-2 text-[10.5px] leading-relaxed text-ink-soft">
                          {bm.notes}
                        </p>
                      )}

                      {/* Coordinate and Zoom metadata + Distance */}
                      <div className="flex flex-wrap items-center gap-3 pt-0.5 font-mono text-[9px] text-ink-muted">
                        <span className="flex items-center gap-1">
                          <MapPin size={10} className="text-accent" />
                          {formatLat(bm.lat, coordFormat)}, {formatLon(bm.lon, coordFormat)} (Z
                          {bm.zoom})
                        </span>
                        <span className="text-ink-soft">{formatDistance(distMeters)} away</span>
                        <span className="flex items-center gap-1">
                          <Calendar size={10} />
                          {new Date(bm.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>

                      {/* Category & Tags */}
                      {(bm.category || (bm.tags && bm.tags.length > 0)) && (
                        <div className="flex flex-wrap items-center gap-1 pt-0.5">
                          {bm.category && (
                            <span className="border border-line bg-raised px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-accent font-semibold">
                              {bm.category}
                            </span>
                          )}
                          {bm.tags?.map((tag) => (
                            <span
                              key={tag}
                              className="flex items-center gap-1 border border-line bg-tint/80 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.04em] text-ink-soft"
                            >
                              <Tag size={8} />
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Navigate & Inspect Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDetails(bm);
                        }}
                        className="mt-1 flex h-6 w-full items-center justify-center gap-1.5 border border-line bg-solid text-[10px] font-semibold text-ink-soft transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
                      >
                        <Navigation size={10} />
                        <span>Inspect Note Details</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </PanelShell>
  );
}
