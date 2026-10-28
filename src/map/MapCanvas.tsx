import { memo, useEffect, useRef } from "react";
import { mountMap } from "./mapController";

export const MapCanvas = memo(function MapCanvas() {
  const targetRef = useRef<HTMLDivElement>(null);

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
      className="absolute inset-0 z-0 overflow-hidden bg-map opacity-0 transition-opacity delay-[60ms] duration-500 ease-out [&.is-ready]:opacity-100 [&_.ol-viewport]:size-full"
      role="application"
      aria-label="Interactive survey map"
    />
  );
});
