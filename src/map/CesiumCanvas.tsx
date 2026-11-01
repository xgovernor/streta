import { memo, useEffect, useRef, useState } from "react";
import { Loader2, Globe } from "lucide-react";
import { mountCesium } from "./cesiumView";

/**
 * 3D frontend. The first 3D toggle pays a cold-load cost (Cesium chunk +
 * workers + imagery warm-up); this overlay says so instead of leaving the
 * user on a dark globe.
 */
export const CesiumCanvas = memo(function CesiumCanvas() {
  const targetRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) {
      return;
    }

    return mountCesium(target, () => setReady(true));
  }, []);

  return (
    <div
      ref={targetRef}
      className="absolute inset-0 z-0 overflow-hidden bg-map [&_.cesium-viewer]:size-full [&_.cesium-viewer-bottom]:bottom-1 [&_.cesium-viewer-bottom]:left-2"
      role="application"
      aria-label="Interactive 3D map"
    >
      {!ready && (
        <div
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-transparent"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 rounded-[3px] border border-line bg-solid px-3 py-2 font-mono text-[11px] text-ink-muted shadow-float">
            <Globe size={14} className="text-accent" />
            Loading 3D globe…
            <Loader2 size={12} className="animate-spin text-accent" />
          </div>
        </div>
      )}
    </div>
  );
});
