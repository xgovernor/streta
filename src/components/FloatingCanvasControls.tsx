import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Compass,
  Crop,
  Download,
  Eye,
  EyeOff,
  Frame,
  Layers,
  LocateFixed,
  Minus,
  Plus,
} from "lucide-react";
import {
  downloadMapCapture,
  fitToData,
  flyTo,
  resetNorth,
  zoomBy,
} from "../map/mapController";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";
import { useUiStore } from "../state/uiStore";
import { BASEMAPS } from "../lib/gis/data";

const FLOATING_BTN =
  "grid size-8 place-items-center rounded-[2px] border border-line bg-solid/90 text-ink-soft shadow-panel backdrop-blur-md transition-colors hover:border-line-strong hover:bg-tint hover:text-ink focus-visible:outline-2";

export function FloatingCanvasControls() {
  const rotation = useMapStore((state) => state.camera.rotation);
  const flash = useUiStore((state) => state.flash);
  const setSnipMode = useUiStore((state) => state.setSnipMode);
  const basemap = useUiStore((state) => state.basemap);
  const setBasemap = useUiStore((state) => state.setBasemap);
  const graticule = useUiStore((state) => state.graticule);
  const setGraticule = useUiStore((state) => state.setGraticule);
  const trafficFlow = useUiStore((state) => state.trafficFlow);
  const setTrafficFlow = useUiStore((state) => state.setTrafficFlow);

  const layers = useProjectStore((state) => state.layers);
  const setLayerVisible = useProjectStore((state) => state.setLayerVisible);

  const [captureOpen, setCaptureOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);

  const captureRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);

  // Close popovers on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (captureRef.current && !captureRef.current.contains(e.target as Node)) {
        setCaptureOpen(false);
      }
      if (layersRef.current && !layersRef.current.contains(e.target as Node)) {
        setLayersOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleFullscreenCapture = () => {
    setCaptureOpen(false);
    const ok = downloadMapCapture("strata-map-capture.png");
    if (ok) {
      flash("Fullscreen map captured as PNG");
    } else {
      flash("Fullscreen map capture failed");
    }
  };

  const handleStartSnip = () => {
    setCaptureOpen(false);
    setSnipMode(true);
  };

  const locate = () => {
    if (!("geolocation" in navigator)) {
      flash("Location is not available in this window.");
      return;
    }
    flash("Finding your position…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        flyTo(pos.coords.longitude, pos.coords.latitude, 12);
        flash("Centered on your location");
      },
      () => {
        flash("Location permission denied or unavailable.");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  };

  return (
    <div className="pointer-events-auto absolute right-[calc(var(--ribbon-w)+12px)] bottom-[calc(var(--footer-h)+12px)] z-20 flex flex-col items-center gap-1 select-none">
      {/* Quick Layer Switcher Popover */}
      <div ref={layersRef} className="relative">
        <button
          type="button"
          onClick={() => setLayersOpen((v) => !v)}
          className={FLOATING_BTN}
          title="Quick Layer & Basemap Switcher"
          aria-label="Quick Layers & Basemap"
        >
          <Layers size={15} strokeWidth={2} />
        </button>

        {layersOpen && (
          <div className="absolute right-0 bottom-[calc(100%+6px)] z-30 flex w-[240px] flex-col gap-2 rounded-[2px] border border-line bg-solid p-2.5 font-sans text-ink shadow-panel backdrop-blur-md max-h-[min(380px,calc(100vh-var(--footer-h)-var(--commandbar-h)-160px))] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-1.5">
              <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-ink-muted">
                Quick Layer Toggles
              </span>
              <span className="font-mono text-[9px] text-ink-soft">
                {layers.length} Active
              </span>
            </div>

            {/* Tactical Overlays */}
            <div className="flex flex-col gap-1 text-[11px]">
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
                <span className="text-ink-soft">Real-time Traffic Flow</span>
                <input
                  type="checkbox"
                  checked={trafficFlow}
                  onChange={(e) => setTrafficFlow(e.target.checked)}
                  className="accent-accent size-3.5"
                />
              </label>
            </div>

            {/* Basemaps row */}
            <div className="border-t border-line pt-2">
              <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-ink-muted mb-1.5">
                Basemap
              </div>
              <div className="grid grid-cols-2 gap-1 text-[10.5px]">
                {BASEMAPS.slice(0, 4).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBasemap(b.id)}
                    className={`h-6 rounded-[2px] border px-2 text-left truncate font-mono text-[9.5px] transition-colors ${
                      basemap === b.id
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-line bg-tint/40 text-ink-muted hover:text-ink"
                    }`}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Vector layers toggle */}
            {layers.length > 0 && (
              <div className="border-t border-line pt-2 flex flex-col gap-1">
                <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-ink-muted mb-1">
                  Datasets
                </div>
                {layers.slice(0, 6).map((layer) => (
                  <div
                    key={layer.id}
                    className="flex items-center justify-between gap-1.5 rounded px-1.5 py-1 text-[10.5px] hover:bg-tint"
                  >
                    <span className="truncate text-ink-soft max-w-[160px]">
                      {layer.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setLayerVisible(layer.id, !layer.visible)}
                      className="text-ink-muted hover:text-ink"
                    >
                      {layer.visible ? <Eye size={12} /> : <EyeOff size={12} className="opacity-40" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Screenshot Capture Suite Dropdown */}
      <div ref={captureRef} className="relative">
        <button
          type="button"
          onClick={() => setCaptureOpen((v) => !v)}
          className={FLOATING_BTN}
          title="Screenshot & Snip Capture Tool"
          aria-label="Screenshot Capture"
        >
          <Camera size={15} strokeWidth={2} />
        </button>

        {captureOpen && (
          <div className="absolute right-0 bottom-[calc(100%+6px)] z-30 flex w-[210px] flex-col gap-1 rounded-[2px] border border-line bg-solid p-1.5 font-sans text-ink shadow-panel backdrop-blur-md">
            <div className="px-2 py-1 font-mono text-[8px] uppercase tracking-[0.16em] text-ink-muted border-b border-line pb-1">
              Capture Screen
            </div>
            <button
              type="button"
              onClick={handleFullscreenCapture}
              className="flex h-8 items-center gap-2 rounded-[2px] px-2 text-left text-[11px] font-semibold text-ink-soft transition-colors hover:bg-tint hover:text-ink"
            >
              <Download size={13} className="text-accent" />
              <span>Fullscreen Snapshot</span>
            </button>
            <button
              type="button"
              onClick={handleStartSnip}
              className="flex h-8 items-center gap-2 rounded-[2px] px-2 text-left text-[11px] font-semibold text-ink-soft transition-colors hover:bg-tint hover:text-ink"
            >
              <Crop size={13} className="text-cyan-400" />
              <span className="flex-1">Selective Region Snip</span>
              <span className="font-mono text-[8px] text-ink-muted">BOX</span>
            </button>
          </div>
        )}
      </div>

      {/* Tactical separator between tool buttons and camera stack */}
      <div className="my-0.5 h-px w-5 bg-line/80" />

      {/* Camera Navigation Cluster */}
      <button
        type="button"
        onClick={() => zoomBy(1)}
        className={FLOATING_BTN}
        title="Zoom In (+)"
        aria-label="Zoom In"
      >
        <Plus size={15} strokeWidth={2.5} />
      </button>

      <button
        type="button"
        onClick={() => zoomBy(-1)}
        className={FLOATING_BTN}
        title="Zoom Out (−)"
        aria-label="Zoom Out"
      >
        <Minus size={15} strokeWidth={2.5} />
      </button>

      <button
        type="button"
        onClick={resetNorth}
        className={FLOATING_BTN}
        title="Reset North (0)"
        aria-label="Reset North"
      >
        <Compass
          size={16}
          style={{ transform: `rotate(${-rotation}rad)` }}
          className="transition-transform duration-75 text-accent"
        />
      </button>

      <button
        type="button"
        onClick={fitToData}
        className={FLOATING_BTN}
        title="Fit to Data Extent"
        aria-label="Fit to Data Extent"
      >
        <Frame size={14} strokeWidth={2} />
      </button>

      <button
        type="button"
        onClick={locate}
        className={FLOATING_BTN}
        title="Find My Location"
        aria-label="Find My Location"
      >
        <LocateFixed size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
