import { useState } from "react";
import { motion, type Variants } from "motion/react";
import {
  Compass,
  Frame,
  Globe2,
  Layers,
  Loader2,
  LocateFixed,
  Map as MapIcon,
  Minus,
  Plus,
} from "lucide-react";
import {
  fitToData,
  resetNorth,
  setUserLocation,
  zoomBy,
} from "../map/mapController";
import { resolveCurrentLocation } from "../lib/gis/geolocation";
import { useMapStore } from "../state/mapStore";
import { useUiStore } from "../state/uiStore";
import { cx } from "../lib/cx";

const FLOATING_BTN =
  "grid size-8 place-items-center rounded-[2px] border border-line bg-solid/90 text-ink-soft shadow-panel backdrop-blur-md transition-colors hover:border-line-strong hover:bg-tint hover:text-ink focus-visible:outline-2";

const floatingControlsVariants: Variants = {
  hidden: { opacity: 0, scale: 0.88 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.75, delay: 0.3, ease: [0.16, 1, 0.3, 1] },
  },
};

export function FloatingCanvasControls() {
  const booted = useUiStore((state) => state.booted);
  const rotation = useMapStore((state) => state.camera.rotation);
  const flash = useUiStore((state) => state.flash);
  const basemapTrayOpen = useUiStore((state) => state.basemapTrayOpen);
  const toggleBasemapTray = useUiStore((state) => state.toggleBasemapTray);
  const rightPanel = useUiStore((state) => state.rightPanel);
  const leftPanel = useUiStore((state) => state.leftPanel);
  const tableMaximized = useUiStore((state) => state.tableMaximized);
  const viewMode = useUiStore((state) => state.viewMode);
  const setViewMode = useUiStore((state) => state.setViewMode);
  const [locating, setLocating] = useState(false);

  const isTableOpen = leftPanel === "table" || rightPanel === "table";

  const locate = async () => {
    if (locating) return;
    setLocating(true);
    flash("Finding your position…");

    try {
      const loc = await resolveCurrentLocation();
      if (loc) {
        setUserLocation(loc.longitude, loc.latitude, loc.accuracy);
        if (loc.placeName) {
          flash(`Located: ${loc.placeName}`);
        } else {
          flash("Centered on your location");
        }
      } else {
        flash("Location unavailable or permission denied.");
      }
    } catch {
      flash("Failed to determine location.");
    } finally {
      setLocating(false);
    }
  };
  return (
    <motion.div
      initial="hidden"
      animate={
        booted
          ? isTableOpen && tableMaximized
            ? { opacity: 0, scale: 0.88, transition: { duration: 0.2 } }
            : "visible"
          : "hidden"
      }
      variants={floatingControlsVariants}
      className={cx(
        "pointer-events-auto absolute z-40 flex flex-col items-center gap-1 select-none transition-[right,bottom] duration-200 ease-out",
        isTableOpen && tableMaximized && "pointer-events-none",
        rightPanel && rightPanel !== "table"
          ? "right-[calc(var(--ribbon-w)+312px+16px)]"
          : "right-[calc(var(--ribbon-w)+14px)]",
        isTableOpen
          ? "bottom-[calc(var(--footer-h)+var(--timeline-h)+var(--table-h,340px)+20px)] max-h-[calc(100vh-var(--commandbar-h)-var(--footer-h)-var(--timeline-h)-var(--table-h,340px)-32px)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : basemapTrayOpen
            ? "bottom-[calc(var(--footer-h)+var(--timeline-h)+118px)]"
            : "bottom-[calc(var(--footer-h)+var(--timeline-h)+14px)]"
      )}
    >
      {/* 2D / 3D renderer toggle */}
      <button
        type="button"
        onClick={() => setViewMode(viewMode === "3d" ? "2d" : "3d")}
        className={cx(
          FLOATING_BTN,
          viewMode === "3d" && "border-cyan-400 bg-cyan-950/40 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.3)]"
        )}
        title={viewMode === "3d" ? "Switch to 2D map" : "Switch to 3D globe"}
        aria-label="Toggle 2D and 3D map"
        aria-pressed={viewMode === "3d"}
      >
        {viewMode === "3d" ? (
          <MapIcon size={15} strokeWidth={2} />
        ) : (
          <Globe2 size={15} strokeWidth={2} />
        )}
      </button>

      <div className="my-0.5 h-px w-5 bg-line/80" />

      {/* Layers & Basemap Tray Toggle */}
      <button
        type="button"
        onClick={toggleBasemapTray}
        className={cx(
          FLOATING_BTN,
          basemapTrayOpen && "border-cyan-400 bg-cyan-950/40 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.3)]"
        )}
        title="Basemap Layers & Cartography (L)"
        aria-label="Toggle Basemaps"
        aria-pressed={basemapTrayOpen}
      >
        <Layers size={15} strokeWidth={2} />
      </button>

      {/* Tactical separator between tool buttons and camera stack */}
      <div className="my-0.5 h-px w-5 bg-line/80" />

      {/* Zoom In/Out Split Button */}
      <div className="flex flex-col overflow-hidden rounded-[2px] border border-line bg-solid/90 shadow-panel backdrop-blur-md">
        <button
          type="button"
          onClick={() => zoomBy(1)}
          className="grid size-8 place-items-center border-b border-line text-ink-soft transition-colors hover:bg-tint hover:text-ink focus-visible:outline-2"
          title="Zoom In (+)"
          aria-label="Zoom In"
        >
          <Plus size={15} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(-1)}
          className="grid size-8 place-items-center text-ink-soft transition-colors hover:bg-tint hover:text-ink focus-visible:outline-2"
          title="Zoom Out (−)"
          aria-label="Zoom Out"
        >
          <Minus size={15} strokeWidth={2.5} />
        </button>
      </div>

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
        disabled={locating}
        className={cx(
          FLOATING_BTN,
          locating && "border-cyan-400 bg-cyan-950/30 text-cyan-400"
        )}
        title="Find My Location (GPS / Network)"
        aria-label="Find My Location"
      >
        {locating ? (
          <Loader2 size={14} className="animate-spin text-cyan-400" />
        ) : (
          <LocateFixed size={14} strokeWidth={2} />
        )}
      </button>
    </motion.div>
  );
}
