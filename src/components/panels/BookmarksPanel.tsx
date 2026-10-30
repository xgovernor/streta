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
} from "lucide-react";
import { PanelShell } from "../PanelShell";
import { useProjectStore } from "../../state/projectStore";
import { useMapStore } from "../../state/mapStore";
import { useUiStore } from "../../state/uiStore";
import { flyTo } from "../../map/mapController";
import { formatLat, formatLon } from "../../lib/format";

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
      onClose={() => closePanel("left")}
    >
      <div className="flex flex-col gap-3 p-3">
        {/* Top actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsAdding((v) => !v)}
            className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[2px] bg-accent px-2 text-[10.5px] font-bold text-shell transition-colors hover:opacity-90"
          >
            <Plus size={13} strokeWidth={2.5} />
            <span>Bookmark View</span>
          </button>
        </div>

        {/* Create form drawer */}
        {isAdding && (
          <form
            onSubmit={handleCreate}
            className="flex flex-col gap-2 rounded-[2px] border border-line bg-tint/40 p-2.5 text-[11px]"
          >
            <div className="flex items-center justify-between text-[9px] font-mono text-ink-muted">
              <span>CURRENT CAMERA FIX</span>
              <span>
                {formatLat(camera.lat, coordFormat)}, {formatLon(camera.lon, coordFormat)} (Z{Math.round(camera.zoom)})
              </span>
            </div>

            <input
              type="text"
              required
              placeholder="Title (e.g. Chokepoint Alpha)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-7 w-full rounded-[2px] border border-line bg-solid px-2 font-mono text-[11px] text-ink placeholder:text-ink-muted focus:border-line-strong focus:outline-none"
              autoFocus
            />

            <textarea
              placeholder="Tactical remarks or operational notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-[2px] border border-line bg-solid p-2 font-sans text-[11px] text-ink placeholder:text-ink-muted focus:border-line-strong focus:outline-none"
            />

            <input
              type="text"
              placeholder="Tags (comma-separated, e.g. Port, Anchor, Red)"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              className="h-7 w-full rounded-[2px] border border-line bg-solid px-2 font-mono text-[10px] text-ink placeholder:text-ink-muted focus:border-line-strong focus:outline-none"
            />

            <div className="flex items-center justify-end gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="h-6 rounded-[2px] px-2 text-[10px] font-medium text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-6 rounded-[2px] bg-accent px-3 text-[10px] font-bold text-shell hover:opacity-90"
              >
                Save
              </button>
            </div>
          </form>
        )}

        {/* Search filter */}
        {bookmarks.length > 0 && (
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="search"
              placeholder="Filter by title, tag, or note..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 w-full rounded-[2px] border border-line bg-tint/60 pl-8 pr-2 font-sans text-[11px] text-ink placeholder:text-ink-muted focus:border-line-strong focus:outline-none"
            />
          </div>
        )}

        {/* Bookmarks list */}
        <div className="flex flex-col gap-2 overflow-y-auto">
          {filteredBookmarks.length === 0 ? (
            <div className="grid place-items-center rounded-[2px] border border-dashed border-line p-6 text-center">
              <Bookmark size={20} className="mb-2 text-ink-muted opacity-40" />
              <div className="text-[11px] font-semibold text-ink">
                {bookmarks.length === 0 ? "No bookmarks recorded" : "No matching bookmarks"}
              </div>
              <div className="mt-1 text-[9.5px] text-ink-muted">
                {bookmarks.length === 0
                  ? "Save points of interest, vessel observations, or tactical positions with one click."
                  : "Try a different search term or clear the filter."}
              </div>
            </div>
          ) : (
            filteredBookmarks.map((bm) => (
              <div
                key={bm.id}
                className="group relative flex flex-col gap-1.5 rounded-[2px] border border-line bg-tint/30 p-2.5 transition-colors hover:border-line-strong"
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    onClick={() => handleFlyTo(bm.lon, bm.lat, bm.zoom, bm.title)}
                    className="cursor-pointer font-bold text-ink hover:underline text-[11.5px]"
                  >
                    {bm.title}
                  </div>
                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => handleCopy(bm.id, bm.lon, bm.lat)}
                      className="grid size-5 place-items-center rounded text-ink-muted hover:bg-tint hover:text-ink"
                      title="Copy coordinates"
                    >
                      {copiedId === bm.id ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBookmark(bm.id)}
                      className="grid size-5 place-items-center rounded text-ink-muted hover:bg-critical-20 hover:text-critical"
                      title="Delete bookmark"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>

                {bm.notes && (
                  <p className="line-clamp-2 text-[10.5px] text-ink-soft">
                    {bm.notes}
                  </p>
                )}

                {/* Coordinate and Zoom metadata */}
                <div className="flex flex-wrap items-center gap-2 pt-0.5 font-mono text-[9px] text-ink-muted">
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
                  <div className="flex flex-wrap gap-1 pt-1">
                    {bm.tags.map((tag) => (
                      <span
                        key={tag}
                        className="flex items-center gap-1 rounded-[2px] bg-tint px-1.5 py-0.5 font-mono text-[8.5px] text-ink-soft"
                      >
                        <Tag size={8} />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Quick fly-to action bar */}
                <button
                  type="button"
                  onClick={() => handleFlyTo(bm.lon, bm.lat, bm.zoom, bm.title)}
                  className="mt-1 flex h-6 w-full items-center justify-center gap-1.5 rounded-[2px] bg-tint text-[10px] font-semibold text-ink-soft transition-colors hover:bg-accent-soft hover:text-accent"
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
