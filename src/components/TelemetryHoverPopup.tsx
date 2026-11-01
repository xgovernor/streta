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
import { resolveVesselFlagDetails } from "../lib/gis/telemetryExtendedDb";
import { computeVoyageRoute } from "../lib/gis/voyageRoute";

const POPUP_WIDTH = 270;
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
  const viewMode = useUiStore((state) => state.viewMode);

  const stylePosition = useMemo(() => {
    if (!hoverPosition) return null;
    const windowWidth = typeof window !== "undefined" ? window.innerWidth : 1200;

    // Feature-anchored: Center horizontally on the feature's screen pixel
    const idealLeft = hoverPosition.x - POPUP_WIDTH / 2;
    const left = clamp(idealLeft, EDGE_PADDING, windowWidth - POPUP_WIDTH - EDGE_PADDING);

    // Dynamic vertical anchoring:
    // When placed ABOVE (default):
    // Setting top coordinate to `hoverPosition.y - 24` with `transform: translateY(-100%)`
    // places the bottom edge of the popup box at `hoverPosition.y - 24`.
    // The downward caret (-bottom-1.5 = 6px) has its tip pointing at `hoverPosition.y - 18`,
    // touching right above the top boundary of the vessel/flight icon (ZERO gap!).
    //
    // When placed BELOW (if feature is within 220px of the top edge):
    // Setting top coordinate to `hoverPosition.y + 28` with `transform: none`
    // places the top edge of the popup box at `hoverPosition.y + 28`.
    // The upward caret (-top-1.5 = 6px) has its tip pointing at `hoverPosition.y + 22`,
    // touching right below the bottom of the vessel/flight icon.
    const placedBelow = hoverPosition.y < 220;
    const top = placedBelow ? hoverPosition.y + 28 : hoverPosition.y - 24;

    const arrowOffsetLeft = clamp(hoverPosition.x - left, 18, POPUP_WIDTH - 18);

    return { left, top, placedBelow, arrowOffsetLeft };
  }, [hoverPosition]);

  // Hover anchors come from OpenLayers pointermove pixel space, which no
  // longer reflects the screen in 3D: hide rather than lie.
  if (!hoveredTarget || !stylePosition || viewMode === "3d") {
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
      style={{
        left: stylePosition.left,
        top: stylePosition.top,
        transform: stylePosition.placedBelow ? "none" : "translateY(-100%)",
      }}
      className="pointer-events-auto absolute z-40 w-[270px] cursor-pointer overflow-visible rounded-[3px] border border-line bg-solid p-3 font-sans text-ink shadow-panel transition-[left,top] duration-75 hover:border-line-strong"
      title="Click to inspect extended details & track"
    >
      {/* Tactical target-lock pointer stem */}
      {stylePosition.placedBelow ? (
        <div
          style={{ left: stylePosition.arrowOffsetLeft }}
          className="absolute -top-1.5 -translate-x-1/2 size-3 rotate-45 border-l border-t border-line bg-solid"
        />
      ) : (
        <div
          style={{ left: stylePosition.arrowOffsetLeft }}
          className="absolute -bottom-1.5 -translate-x-1/2 size-3 rotate-45 border-r border-b border-line bg-solid"
        />
      )}

      {/* 1. ADS-B Flight Target */}
      {type === "flight" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <div className="flex items-center gap-2">
              <div className="grid size-6 place-items-center rounded-[2px] bg-tint text-accent">
                <Plane size={14} className="rotate-[-45deg]" />
              </div>
              <div>
                <div className="font-mono text-xs font-bold tracking-wider text-ink">
                  {data.callsign || data.icao24}
                </div>
                <div className="text-[10px] text-ink-muted truncate max-w-[140px]">
                  {data.originCountry || "Unknown Nation"}
                </div>
              </div>
            </div>
            {data.emergency ? (
              <span className="flex items-center gap-1 rounded-[2px] bg-critical-20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-critical">
                <AlertTriangle size={10} />
                {data.emergency}
              </span>
            ) : data.squawk ? (
              <span className="rounded-[2px] bg-tint px-1.5 py-0.5 font-mono text-[9.5px] text-ink-muted">
                SQK {data.squawk}
              </span>
            ) : (
              <span className="rounded-[2px] bg-tint px-1.5 py-0.5 text-[9px] font-semibold text-ink-soft border border-line">
                {data.categoryLabel || "Aircraft"}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10.5px]">
            <div className="rounded-[2px] bg-tint p-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-ink-muted">Altitude</div>
              <div className="font-mono font-semibold text-ink">
                {Math.round(data.altitudeMeters).toLocaleString()} m
              </div>
              <div className="text-[9px] text-ink-muted font-mono">
                {Math.round(data.altitudeMeters * 3.28084).toLocaleString()} ft
              </div>
            </div>
            <div className="rounded-[2px] bg-tint p-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-ink-muted">Ground Speed</div>
              <div className="font-mono font-semibold text-ink">
                {Math.round(data.velocityMps * 1.94384)} kts
              </div>
              <div className="text-[9px] text-ink-muted font-mono">
                {Math.round(data.velocityMps * 3.6)} km/h
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-ink-soft pt-0.5">
            <div className="flex items-center gap-1">
              <Compass size={11} className="text-ink-soft" />
              <span>{Math.round(data.headingDeg || 0)}° {toCompassHeading(data.headingDeg || 0)}</span>
            </div>
            <div className="font-mono text-[9.5px]">
              {data.verticalRateFpm ? (
                <span className={data.verticalRateFpm > 0 ? "text-ok" : "text-warn"}>
                  {data.verticalRateFpm > 0 ? "+" : ""}{data.verticalRateFpm} fpm
                </span>
              ) : (
                <span className="text-ink-muted">Level Cruise</span>
              )}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-line pt-1.5 text-[8.5px] font-mono text-ink-muted">
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[8px] font-bold text-ink-soft tracking-wider">LIVE ADS-B</span>
            </div>
            <div className="flex items-center gap-1 text-ink font-semibold">
              <span>INSPECT & TRACK</span>
              <Navigation size={10} className="text-accent" />
            </div>
          </div>
        </div>
      )}

      {/* 2. Satellite Target */}
      {type === "satellite" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <div className="flex items-center gap-2">
              <div className="grid size-6 place-items-center rounded-[2px] bg-tint text-accent">
                <Satellite size={14} />
              </div>
              <div>
                <div className="font-mono text-xs font-bold text-ink truncate max-w-[140px]">
                  {data.name}
                </div>
                <div className="text-[9.5px] text-ink-muted font-mono">
                  NORAD #{data.noradId}
                </div>
              </div>
            </div>
            <span className="rounded-[2px] bg-tint px-1.5 py-0.5 text-[9px] font-semibold text-ink-soft border border-line">
              LEO Orbit
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10.5px]">
            <div className="rounded-[2px] bg-tint p-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-ink-muted">Altitude</div>
              <div className="font-mono font-semibold text-ink">
                {Math.round(data.altitudeKm).toLocaleString()} km
              </div>
            </div>
            <div className="rounded-[2px] bg-tint p-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-ink-muted">Velocity</div>
              <div className="font-mono font-semibold text-ink">
                {data.velocityKmh ? (data.velocityKmh / 3600).toFixed(2) : "7.66"} km/s
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-ink-soft pt-0.5">
            <span>Period: ~92.8 min</span>
            <span className="text-[9px] font-mono text-ink-muted">
              {data.latitude?.toFixed(2)}°, {data.longitude?.toFixed(2)}°
            </span>
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-line pt-1.5 text-[8.5px] font-mono text-ink-muted">
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-cyan-400" />
              <span className="text-[8px] font-bold text-ink-soft tracking-wider">SGP4 ORBIT</span>
            </div>
            <div className="flex items-center gap-1 text-ink font-semibold">
              <span>INSPECT & TRACK</span>
              <Navigation size={10} className="text-accent" />
            </div>
          </div>
        </div>
      )}

      {/* 3. AIS Vessel Target (MarineTraffic & VesselFinder Standard) */}
      {type === "vessel" && (() => {
        const flagInfo = resolveVesselFlagDetails(data.mmsi);
        const navStatus = data.status || "Under way";
        const isUnderWay = /engine|sailing|under way/i.test(navStatus);
        const isAnchor = /anchor/i.test(navStatus);
        const isMoored = /moored/i.test(navStatus);
        const statusDotClass = isUnderWay
          ? "bg-emerald-500"
          : isAnchor
          ? "bg-amber-500"
          : isMoored
          ? "bg-cyan-500"
          : "bg-neutral-400";

        const voyage =
          data.destination && data.lon != null && data.lat != null
            ? computeVoyageRoute(data.lon, data.lat, data.destination, data.speedKnots || 0)
            : null;

        return (
          <div className="space-y-2">
            {/* Header: Name, Flag, Type */}
            <div className="flex items-center justify-between border-b border-line pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="grid size-6 shrink-0 place-items-center rounded-[2px] bg-tint text-accent">
                  <Ship size={14} />
                </div>
                <div className="min-w-0">
                  <div className="font-mono text-xs font-bold text-ink truncate max-w-[155px]">
                    {data.name || `MMSI ${data.mmsi}`}
                  </div>
                  <div className="flex items-center gap-1 text-[9.5px] text-ink-muted truncate max-w-[155px]">
                    <span>{flagInfo.emoji}</span>
                    <span className="truncate">{flagInfo.country}</span>
                  </div>
                </div>
              </div>
              <span className="shrink-0 rounded-[2px] bg-tint px-1.5 py-0.5 text-[9px] font-semibold text-ink-soft border border-line">
                {data.shipType || "Cargo"}
              </span>
            </div>

            {/* Navigational Status & Radio Identity */}
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-1.5 truncate">
                <span className={`size-1.5 shrink-0 rounded-full ${statusDotClass}`} />
                <span className="font-medium text-ink truncate text-[9.5px]">{navStatus}</span>
              </div>
              <div className="font-mono text-[9px] text-ink-muted shrink-0">
                MMSI {data.mmsi}{data.callsign ? ` · ${data.callsign}` : ""}
              </div>
            </div>

            {/* Kinematics Grid: SOG, COG, Heading */}
            <div className="grid grid-cols-2 gap-2 text-[10.5px]">
              <div className="rounded-[2px] bg-tint p-1.5">
                <div className="text-[8px] uppercase tracking-wider text-ink-muted">Speed (SOG)</div>
                <div className="font-mono font-semibold text-ink">
                  {(data.speedKnots || 0).toFixed(1)} kts
                </div>
                <div className="text-[8.5px] font-mono text-ink-muted">
                  {((data.speedKnots || 0) * 1.852).toFixed(1)} km/h
                </div>
              </div>
              <div className="rounded-[2px] bg-tint p-1.5">
                <div className="text-[8px] uppercase tracking-wider text-ink-muted">Course (COG)</div>
                <div className="font-mono font-semibold text-ink">
                  {Math.round(data.courseDeg || 0)}° {toCompassHeading(data.courseDeg || 0)}
                </div>
                <div className="text-[8.5px] font-mono text-ink-muted">
                  {data.headingDeg != null && data.headingDeg > 0 && data.headingDeg <= 360
                    ? `HDG ${Math.round(data.headingDeg)}°`
                    : "True Motion"}
                </div>
              </div>
            </div>

            {/* Destination & Voyage Summary */}
            {data.destination ? (
              <div className="rounded-[2px] bg-tint p-1.5 text-[9.5px]">
                <div className="flex items-center justify-between text-ink-soft">
                  <span className="text-ink-muted uppercase tracking-wider text-[8px]">Destination</span>
                  {voyage && (
                    <span className="font-mono text-[9px] font-bold text-accent">
                      {Math.round(voyage.distanceNm).toLocaleString()} NM
                    </span>
                  )}
                </div>
                <div className="font-bold text-ink truncate mt-0.5">
                  {voyage?.label || data.destination}
                </div>
                {voyage && (
                  <div className="text-[8.5px] font-mono text-ink-muted mt-0.5 flex items-center justify-between">
                    <span>
                      ETA {voyage.etaDays < 1 ? `~${Math.max(1, Math.round(voyage.etaDays * 24))} H` : `~${voyage.etaDays.toFixed(1)} Days`}
                    </span>
                    <span className="text-[8px] uppercase tracking-wider text-ink-soft">Great-Circle</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between text-[9px] font-mono text-ink-muted bg-tint/60 px-2 py-1 rounded-[2px]">
                <span>FIX {Math.abs(data.lat).toFixed(3)}°{data.lat >= 0 ? "N" : "S"}, {Math.abs(data.lon).toFixed(3)}°{data.lon >= 0 ? "E" : "W"}</span>
                <span className="text-ink-soft">DEST UNREPORTED</span>
              </div>
            )}

            {/* Bottom Live Feed Badge & Inspection Hint */}
            <div className="mt-2.5 flex items-center justify-between border-t border-line pt-1.5 text-[8.5px] font-mono text-ink-muted">
              <div className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[8px] font-bold text-ink-soft tracking-wider">LIVE AIS STREAM</span>
              </div>
              <div className="flex items-center gap-1 text-ink font-semibold">
                <span>INSPECT & TRACK</span>
                <Navigation size={10} className="text-accent" />
              </div>
            </div>
          </div>
        );
      })()}

      {/* 4. Earthquake Target */}
      {type === "earthquake" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <div className="flex items-center gap-2">
              <div className="grid size-6 place-items-center rounded-[2px] bg-tint text-critical">
                <Activity size={14} />
              </div>
              <div>
                <div className="font-mono text-xs font-bold text-ink">
                  M {data.magnitude.toFixed(1)} Earthquake
                </div>
                <div className="text-[9.5px] text-ink-muted truncate max-w-[140px]">
                  Depth: {data.depthKm} km
                </div>
              </div>
            </div>
            {data.tsunami === 1 && (
              <span className="rounded-[2px] bg-critical-20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-critical">
                TSUNAMI
              </span>
            )}
          </div>
          <div className="text-[10px] text-ink-soft line-clamp-2">
            {data.place}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-1.5 text-[8.5px] font-mono text-ink-muted">
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-amber-500" />
              <span className="text-[8px] font-bold text-ink-soft tracking-wider">USGS SEISMIC</span>
            </div>
            <div className="flex items-center gap-1 text-ink font-semibold">
              <span>INSPECT & TRACK</span>
              <Navigation size={10} className="text-accent" />
            </div>
          </div>
        </div>
      )}

      {/* 5. Fire Target */}
      {type === "fire" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <div className="flex items-center gap-2">
              <div className="grid size-6 place-items-center rounded-[2px] bg-warn-20 text-warn">
                <Flame size={14} />
              </div>
              <div>
                <div className="font-mono text-xs font-bold text-warn">
                  Thermal Hotspot
                </div>
                <div className="text-[9.5px] text-ink-muted">
                  FRP: {data.frpMw ? `${data.frpMw.toFixed(1)} MW` : "Active"}
                </div>
              </div>
            </div>
          </div>
          <div className="text-[10px] text-ink-soft">
            Detected via NASA {data.satellite || "VIIRS"} · Conf: {data.confidence}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-1.5 text-[8.5px] font-mono text-ink-muted">
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-orange-500" />
              <span className="text-[8px] font-bold text-ink-soft tracking-wider">NASA FIRMS</span>
            </div>
            <div className="flex items-center gap-1 text-ink font-semibold">
              <span>INSPECT & TRACK</span>
              <Navigation size={10} className="text-accent" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
