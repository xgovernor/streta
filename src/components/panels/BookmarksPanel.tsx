import { useState } from "react";
import {
  Bookmark,
  Calendar,
  Check,
  Copy,
  MapPin,
  Navigation,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { PanelShell } from "../PanelShell";
import { useProjectStore } from "../../state/projectStore";
import { useMapStore } from "../../state/mapStore";
import { useUiStore } from "../../state/uiStore";
import { flyTo } from "../../map/mapController";
import { formatLat, formatLon } from "../../lib/format";
import { cx } from "../../lib/cx";

export function BookmarksPanel() {
  const bookmarks = useProjectStore((state) => state.bookmarks);
  const addBookmark = useProjectStore((state) => state.addBookmark);
  const removeBookmark = useProjectStore((state) => state.removeBookmark);
  const closePanel = useUiStore((state) => state.closePanel);
  const flash = useUiStore((state) => state.flash);
  const coordFormat = useUiStore((state) => state.coordFormat);
  const camera = useMapStore((state) => state.camera);

  const [search, setSearch] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const tags = tagInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    addBookmark({
      title: title.trim(),
      notes: notes.trim() || undefined,
      tags: tags.length ? tags : undefined,
      lon: camera.lon,
      lat: camera.lat,
      zoom: Math.round(camera.zoom),
    });

    flash(`Bookmark "${title.trim()}" created`);
    setTitle("");
    setNotes("");
    setTagInput("");
    setIsAdding(false);
  };

  const handleFlyTo = (lon: number, lat: number, zoom: number, title: string) => {
    flyTo(lon, lat, zoom);
    flash(`Centered on "${title}"`);
  };

  const handleCopy = (id: string, lon: number, lat: number) => {
    const text = `${formatLat(lat, coordFormat)}, ${formatLon(lon, coordFormat)}`;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    flash("Coordinates copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredBookmarks = bookmarks.filter((b) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      b.title.toLowerCase().includes(q) ||
      (b.notes && b.notes.toLowerCase().includes(q)) ||
      (b.tags && b.tags.some((t) => t.toLowerCase().includes(q)))
    );
  });

  return (
    <PanelShell
      title="Bookmarks & Notes"
      eyebrow="Intelligence Record"
      side="left"
      flush={true}
      autoHeight={true}
      onClose={() => closePanel("left")}
      footer={
        <>
          <span>
            {bookmarks.length} bookmark{bookmarks.length === 1 ? "" : "s"}
          </span>
          <span className="text-ink-muted">Click to inspect</span>
        </>
      }
    >
      <div className="flex flex-col">
        {/* Carbon Primary Action Toolbar Button */}
        <button
          type="button"
          onClick={() => setIsAdding((v) => !v)}
          className={cx(
            "flex h-9 w-full items-center justify-center gap-2 border-b border-line px-3 text-[11px] font-bold uppercase tracking-[0.05em] transition-colors",
            isAdding
              ? "bg-tint text-accent border-b-2 border-accent"
              : "bg-accent text-shell hover:opacity-90"
          )}
        >
          {isAdding ? (
            <>
              <X size={13} strokeWidth={2.5} />
              <span>Cancel Entry</span>
            </>
          ) : (
            <>
              <Plus size={13} strokeWidth={2.5} />
              <span>Bookmark View</span>
            </>
          )}
        </button>

        {/* Carbon Add Form Drawer (Flush) */}
        {isAdding && (
          <form
            onSubmit={handleCreate}
            className="flex flex-col gap-2.5 border-b border-line bg-tint/40 p-3 text-[11px]"
          >
            <div className="flex items-center justify-between font-mono text-[8.5px] uppercase tracking-[0.1em] text-ink-muted">
              <span>Fix</span>
              <span className="text-ink-soft">
                {formatLat(camera.lat, coordFormat)}, {formatLon(camera.lon, coordFormat)} (Z{Math.round(camera.zoom)})
              </span>
            </div>

            <input
              type="text"
              required
              placeholder="Title (e.g. Chokepoint Alpha)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-7 w-full border border-line bg-solid px-2 font-mono text-[11px] text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
              autoFocus
            />

            <textarea
              placeholder="Tactical remarks or operational notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full resize-none border border-line bg-solid p-2 font-sans text-[11px] text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />

            <input
              type="text"
              placeholder="Tags (comma-separated, e.g. Port, Anchor, Red)"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              className="h-7 w-full border border-line bg-solid px-2 font-mono text-[10px] text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />

            <div className="grid grid-cols-2 gap-2 border-t border-line/60 pt-2">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="h-7 border border-line bg-solid text-[10.5px] font-medium text-ink-muted transition-colors hover:bg-tint hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-7 bg-accent text-[10.5px] font-bold text-shell transition-colors hover:opacity-90"
              >
                Save
              </button>
            </div>
          </form>
        )}

        {/* Carbon Search Component (Flush, full-width) */}
        {bookmarks.length > 0 && (
          <div className="relative flex h-8 w-full items-center border-b border-line bg-solid px-3 text-ink-muted transition-colors focus-within:bg-raised">
            <Search size={13} strokeWidth={1.8} className="mr-2 shrink-0 text-ink-muted" />
            <input
              type="search"
              placeholder="Filter by title, tag, or note..."
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

        {/* Carbon Structured List of Bookmarks (Flush, edge-to-edge) */}
        <div className="divide-y divide-line overflow-y-auto">
          {filteredBookmarks.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-8 text-center text-ink-muted">
              <Bookmark size={22} className="mb-2 opacity-30" />
              <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink">
                {bookmarks.length === 0 ? "No Bookmarks Recorded" : "No Matching Bookmarks"}
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-ink-muted max-w-[220px]">
                {bookmarks.length === 0
                  ? "Save points of interest, vessel observations, or tactical positions with one click."
                  : "Try a different search term or clear the filter."}
              </p>
            </div>
          ) : (
            filteredBookmarks.map((bm) => (
              <div
                key={bm.id}
                className="group relative flex flex-col gap-1.5 px-3.5 py-3 transition-colors hover:bg-tint/60"
              >
                {/* Header row: Title & Quick Icons */}
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleFlyTo(bm.lon, bm.lat, bm.zoom, bm.title)}
                    className="truncate text-left text-[11.5px] font-bold text-ink transition-colors hover:text-accent hover:underline"
                    title={`Fly to ${bm.title}`}
                  >
                    {bm.title}
                  </button>
                  <div className="flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => handleCopy(bm.id, bm.lon, bm.lat)}
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
                      title="Delete bookmark"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>

                {/* Notes */}
                {bm.notes && (
                  <p className="line-clamp-2 text-[10.5px] leading-relaxed text-ink-soft">
                    {bm.notes}
                  </p>
                )}

                {/* Coordinate and Zoom metadata */}
                <div className="flex flex-wrap items-center gap-3 pt-0.5 font-mono text-[9px] text-ink-muted">
                  <span className="flex items-center gap-1">
                    <MapPin size={10} className="text-accent" />
                    {formatLat(bm.lat, coordFormat)}, {formatLon(bm.lon, coordFormat)} (Z{bm.zoom})
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar size={10} />
                    {new Date(bm.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>

                {/* Tags */}
                {bm.tags && bm.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {bm.tags.map((tag) => (
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

                {/* Navigate & Inspect Button (Carbon style secondary) */}
                <button
                  type="button"
                  onClick={() => handleFlyTo(bm.lon, bm.lat, bm.zoom, bm.title)}
                  className="mt-1 flex h-6 w-full items-center justify-center gap-1.5 border border-line bg-solid text-[10px] font-semibold text-ink-soft transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
                >
                  <Navigation size={10} />
                  <span>Navigate & Inspect</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </PanelShell>
  );
}
