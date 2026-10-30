import {
  Compass,
  Frame,
  Layers,
  LocateFixed,
  Minus,
  Plus,
} from "lucide-react";
import {
  fitToData,
  flyTo,
  resetNorth,
  zoomBy,
} from "../map/mapController";
import { useMapStore } from "../state/mapStore";
import { useUiStore } from "../state/uiStore";
import { cx } from "../lib/cx";

const FLOATING_BTN =
  "grid size-8 place-items-center rounded-[2px] border border-line bg-solid/90 text-ink-soft shadow-panel backdrop-blur-md transition-colors hover:border-line-strong hover:bg-tint hover:text-ink focus-visible:outline-2";

export function FloatingCanvasControls() {
  const rotation = useMapStore((state) => state.camera.rotation);
  const flash = useUiStore((state) => state.flash);
  const basemapTrayOpen = useUiStore((state) => state.basemapTrayOpen);
  const toggleBasemapTray = useUiStore((state) => state.toggleBasemapTray);

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
    <div
      className={cx(
        "pointer-events-auto absolute right-[calc(var(--ribbon-w)+12px)] z-40 flex flex-col items-center gap-1 select-none transition-[bottom] duration-200 ease-out",
        basemapTrayOpen
          ? "bottom-[calc(var(--footer-h)+108px)]"
          : "bottom-[calc(var(--footer-h)+12px)]"
      )}
    >
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
        className={FLOATING_BTN}
        title="Find My Location"
        aria-label="Find My Location"
      >
        <LocateFixed size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
