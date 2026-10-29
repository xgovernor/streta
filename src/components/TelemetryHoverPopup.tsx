import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Compass,
  Flame,
  Navigation,
  Plane,
  Satellite,
  Ship,
} from "lucide-react";
import { useTelemetryStore } from "../state/telemetryStore";
import { useUiStore } from "../state/uiStore";
import { resolveVesselFlag } from "../lib/gis/telemetryExtendedDb";

const POPUP_WIDTH = 260;
const POPUP_HEIGHT = 180;
const EDGE_PADDING = 12;

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

function toCompassHeading(deg: number): string {
  const directions = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return directions[idx];
}

export function TelemetryHoverPopup() {
  const hoveredTarget = useTelemetryStore((state) => state.hoveredTarget);
  const hoverPosition = useTelemetryStore((state) => state.hoverPosition);
  const setSelectedTarget = useTelemetryStore((state) => state.setSelectedTarget);
  const openPanel = useUiStore((state) => state.openPanel);

  const stylePosition = useMemo(() => {
    if (!hoverPosition) return null;
    const windowWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
    const windowHeight = typeof window !== "undefined" ? window.innerHeight : 800;

    // Feature-anchored: Center horizontally on the feature's screen pixel
    const idealLeft = hoverPosition.x - POPUP_WIDTH / 2;
    const left = clamp(idealLeft, EDGE_PADDING, windowWidth - POPUP_WIDTH - EDGE_PADDING);

    // Position above feature by default, flip below if too close to the top viewport edge
    let placedBelow = false;
    let top = hoverPosition.y - POPUP_HEIGHT - 18;

    if (top < EDGE_PADDING) {
      top = hoverPosition.y + 22;
      placedBelow = true;
    } else if (top + POPUP_HEIGHT > windowHeight - EDGE_PADDING) {
      top = windowHeight - POPUP_HEIGHT - EDGE_PADDING;
    }

    const arrowOffsetLeft = clamp(hoverPosition.x - left, 20, POPUP_WIDTH - 20);

    return { left, top, placedBelow, arrowOffsetLeft };
  }, [hoverPosition]);

  if (!hoveredTarget || !stylePosition) {
    return null;
  }

  const handleClick = () => {
    setSelectedTarget(hoveredTarget);
    openPanel("telemetry");
  };

  const { type, data } = hoveredTarget;

  return (
    <div
      onClick={handleClick}
      style={{ left: stylePosition.left, top: stylePosition.top }}
      className="pointer-events-auto absolute z-40 w-[260px] cursor-pointer overflow-visible rounded-xl border border-sky-500/40 bg-slate-950/95 p-3 font-sans text-slate-100 shadow-[0_20px_45px_-8px_rgba(0,0,0,0.9)] backdrop-blur-md transition-[left,top] duration-75 hover:border-sky-400/80"
      title="Click to inspect extended details & track"
    >
      {/* Tactical target-lock pointer stem */}
      {stylePosition.placedBelow ? (
        <div
          style={{ left: stylePosition.arrowOffsetLeft }}
          className="absolute -top-1.5 -translate-x-1/2 size-3 rotate-45 border-l border-t border-sky-500/50 bg-slate-950"
        />
      ) : (
        <div
          style={{ left: stylePosition.arrowOffsetLeft }}
          className="absolute -bottom-1.5 -translate-x-1/2 size-3 rotate-45 border-r border-b border-sky-500/50 bg-slate-950"
        />
      )}
      {/* 1. ADS-B Flight Target */}
      {type === "flight" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2">
              <div className="grid size-6 place-items-center rounded-md bg-sky-500/20 text-sky-400">
                <Plane size={14} className="rotate-[-45deg]" />
              </div>
              <div>
                <div className="font-mono text-xs font-bold tracking-wider text-sky-300">
                  {data.callsign || data.icao24}
                </div>
                <div className="text-[10px] text-slate-400 truncate max-w-[140px]">
                  {data.originCountry || "Unknown Nation"}
                </div>
              </div>
            </div>
            {data.emergency && (
              <span className="flex items-center gap-1 rounded bg-red-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-red-400">
                <AlertTriangle size={10} />
                {data.emergency}
              </span>
            )}
            {!data.emergency && data.squawk && (
              <span className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[9.5px] text-slate-400">
                SQK {data.squawk}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10.5px]">
            <div className="rounded-md bg-slate-900/60 p-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-slate-400">Altitude</div>
              <div className="font-mono font-semibold text-slate-100">
                {Math.round(data.altitudeMeters).toLocaleString()} m
              </div>
              <div className="text-[9px] text-slate-400 font-mono">
                {Math.round(data.altitudeMeters * 3.28084).toLocaleString()} ft
              </div>
            </div>
            <div className="rounded-md bg-slate-900/60 p-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-slate-400">Ground Speed</div>
              <div className="font-mono font-semibold text-slate-100">
                {Math.round(data.velocityMps * 1.94384)} kts
              </div>
              <div className="text-[9px] text-slate-400 font-mono">
                {Math.round(data.velocityMps * 3.6)} km/h
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-300 pt-0.5">
            <div className="flex items-center gap-1">
              <Compass size={11} className="text-sky-400" />
              <span>{Math.round(data.headingDeg || 0)}° {toCompassHeading(data.headingDeg || 0)}</span>
            </div>
            <div className="font-mono text-[9.5px]">
              {data.verticalRateFpm ? (
                <span className={data.verticalRateFpm > 0 ? "text-emerald-400" : "text-amber-400"}>
                  {data.verticalRateFpm > 0 ? "+" : ""}{data.verticalRateFpm} fpm
                </span>
              ) : (
                <span className="text-slate-400">Level Cruise</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Satellite Target */}
      {type === "satellite" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2">
              <div className="grid size-6 place-items-center rounded-md bg-purple-500/20 text-purple-300">
                <Satellite size={14} />
              </div>
              <div>
                <div className="font-mono text-xs font-bold text-purple-200 truncate max-w-[140px]">
                  {data.name}
                </div>
                <div className="text-[9.5px] text-slate-400 font-mono">
                  NORAD #{data.noradId}
                </div>
              </div>
            </div>
            <span className="rounded bg-purple-950/60 px-1.5 py-0.5 text-[9px] font-semibold text-purple-300 border border-purple-500/30">
              LEO Orbit
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10.5px]">
            <div className="rounded-md bg-slate-900/60 p-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-slate-400">Altitude</div>
              <div className="font-mono font-semibold text-purple-100">
                {Math.round(data.altitudeKm).toLocaleString()} km
              </div>
            </div>
            <div className="rounded-md bg-slate-900/60 p-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-slate-400">Velocity</div>
              <div className="font-mono font-semibold text-purple-100">
                {data.velocityKmh ? (data.velocityKmh / 3600).toFixed(2) : "7.66"} km/s
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-300 pt-0.5">
            <span>Period: ~92.8 min</span>
            <span className="text-[9px] font-mono text-slate-400">
              {data.latitude?.toFixed(2)}°, {data.longitude?.toFixed(2)}°
            </span>
          </div>
        </div>
      )}

      {/* 3. AIS Vessel Target */}
      {type === "vessel" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2">
              <div className="grid size-6 place-items-center rounded-md bg-teal-500/20 text-teal-300">
                <Ship size={14} />
              </div>
              <div>
                <div className="font-mono text-xs font-bold text-teal-200 truncate max-w-[140px]">
                  {data.name || `MMSI ${data.mmsi}`}
                </div>
                <div className="text-[9.5px] text-slate-400 truncate max-w-[140px]">
                  {resolveVesselFlag(data.mmsi)}
                </div>
              </div>
            </div>
            <span className="rounded bg-teal-950/60 px-1.5 py-0.5 text-[9px] font-semibold text-teal-300 border border-teal-500/30">
              {data.shipType || "Cargo"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10.5px]">
            <div className="rounded-md bg-slate-900/60 p-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-slate-400">Speed (SOG)</div>
              <div className="font-mono font-semibold text-teal-100">
                {(data.speedKnots || 0).toFixed(1)} kts
              </div>
            </div>
            <div className="rounded-md bg-slate-900/60 p-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-slate-400">Course (COG)</div>
              <div className="font-mono font-semibold text-teal-100">
                {Math.round(data.courseDeg || 0)}° {toCompassHeading(data.courseDeg || 0)}
              </div>
            </div>
          </div>

          {data.destination && (
            <div className="text-[9.5px] text-slate-300 truncate">
              <span className="text-slate-400">Dest:</span> {data.destination}
            </div>
          )}
        </div>
      )}

      {/* 4. Earthquake Target */}
      {type === "earthquake" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2">
              <div className="grid size-6 place-items-center rounded-md bg-amber-500/20 text-amber-300">
                <Activity size={14} />
              </div>
              <div>
                <div className="font-mono text-xs font-bold text-amber-200">
                  M {data.magnitude.toFixed(1)} Earthquake
                </div>
                <div className="text-[9.5px] text-slate-400 truncate max-w-[140px]">
                  Depth: {data.depthKm} km
                </div>
              </div>
            </div>
          </div>
          <div className="text-[10px] text-slate-300 line-clamp-2">
            {data.place}
          </div>
        </div>
      )}

      {/* 5. Fire Target */}
      {type === "fire" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2">
              <div className="grid size-6 place-items-center rounded-md bg-orange-500/20 text-orange-400">
                <Flame size={14} />
              </div>
              <div>
                <div className="font-mono text-xs font-bold text-orange-300">
                  Thermal Hotspot
                </div>
                <div className="text-[9.5px] text-slate-400">
                  FRP: {data.frpMw ? `${data.frpMw.toFixed(1)} MW` : "Active"}
                </div>
              </div>
            </div>
          </div>
          <div className="text-[10px] text-slate-300">
            Detected via NASA {data.satellite || "VIIRS"} · Conf: {data.confidence}
          </div>
        </div>
      )}

      {/* Bottom Hint */}
      <div className="mt-2.5 flex items-center justify-between border-t border-slate-800/80 pt-1.5 text-[8.5px] font-mono text-slate-400">
        <span>CLICK TO INSPECT & TRACK</span>
        <Navigation size={10} className="text-sky-400" />
      </div>
    </div>
  );
}
