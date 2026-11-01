import { memo, useEffect, useRef } from "react";
import { cx } from "../lib/cx";
import { useMapStore } from "../state/mapStore";
import { useUiStore } from "../state/uiStore";
import { mountMap } from "./mapController";

export const MapCanvas = memo(function MapCanvas() {
  const targetRef = useRef<HTMLDivElement>(null);
  const viewMode = useUiStore((state) => state.viewMode);
  // Readiness is owned by the store (set on the map's first postrender).
  // Subscribing here keeps the fade driven by React state on every re-render,
  // so view-mode toggles can never wipe it out.
  const ready = useMapStore((state) => state.ready);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) {
      return;
    }

    return mountMap(target);
  }, []);

  return (
    <div
      ref={targetRef}
      className={cx(
        "absolute inset-0 z-0 overflow-hidden bg-map transition-opacity delay-[60ms] duration-500 ease-out [&_.ol-viewport]:size-full",
        ready && viewMode === "2d" ? "opacity-100" : "opacity-0",
        viewMode === "3d" && "pointer-events-none",
      )}
      role="application"
      aria-label="Interactive survey map"
    />
  );
});
