import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Navigation,
  Plane,
  RefreshCw,
  Satellite,
  Search,
  X,
} from "lucide-react";
import { cx } from "../../lib/cx";
import { flyTo } from "../../map/mapController";
import { useTelemetryStore, type SelectedTelemetryTarget } from "../../state/telemetryStore";
import { useUiStore } from "../../state/uiStore";
import { PanelShell } from "../PanelShell";
import { FIELD_INPUT, PRIMARY_BUTTON } from "./shared";

type TelemetryTab = "flights" | "earthquakes" | "satellites";

function formatTimeAgo(timestampMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function TelemetryPanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const flash = useUiStore((state) => state.flash);

  const [activeTab, setActiveTab] = useState<TelemetryTab>("flights");

  const flightsEnabled = useTelemetryStore((state) => state.flightsEnabled);
  const earthquakesEnabled = useTelemetryStore((state) => state.earthquakesEnabled);
  const satellitesEnabled = useTelemetryStore((state) => state.satellitesEnabled);
  const autoRefreshSeconds = useTelemetryStore((state) => state.autoRefreshSeconds);
  const loading = useTelemetryStore((state) => state.loading);
  const lastUpdated = useTelemetryStore((state) => state.lastUpdated);
  const selectedTarget = useTelemetryStore((state) => state.selectedTarget);

  const flights = useTelemetryStore((state) => state.flights);
  const earthquakes = useTelemetryStore((state) => state.earthquakes);
  const satellites = useTelemetryStore((state) => state.satellites);

  const flightSearch = useTelemetryStore((state) => state.flightSearch);
  const earthquakeMinMag = useTelemetryStore((state) => state.earthquakeMinMag);
  const satelliteSearch = useTelemetryStore((state) => state.satelliteSearch);

  const toggleFeed = useTelemetryStore((state) => state.toggleFeed);
  const setAutoRefresh = useTelemetryStore((state) => state.setAutoRefresh);
  const setFlightSearch = useTelemetryStore((state) => state.setFlightSearch);
  const setEarthquakeMinMag = useTelemetryStore((state) => state.setEarthquakeMinMag);
  const setSatelliteSearch = useTelemetryStore((state) => state.setSatelliteSearch);
  const setSelectedTarget = useTelemetryStore((state) => state.setSelectedTarget);
  const refreshFeeds = useTelemetryStore((state) => state.refreshFeeds);

  // Initial fetch on mount if empty
  useEffect(() => {
    if (flights.length === 0 && earthquakes.length === 0 && satellites.length === 0) {
      void refreshFeeds();
    }
  }, []);

  // Auto-refresh interval timer
  useEffect(() => {
    if (autoRefreshSeconds <= 0) return;
    const interval = setInterval(() => {
      void refreshFeeds();
    }, autoRefreshSeconds * 1000);
    return () => clearInterval(interval);
  }, [autoRefreshSeconds, refreshFeeds]);

  // Filtered lists
  const filteredFlights = useMemo(() => {
    const q = flightSearch.trim().toLowerCase();
    if (!q) return flights;
    return flights.filter(
      (f) =>
        f.callsign.toLowerCase().includes(q) ||
        f.icao24.toLowerCase().includes(q) ||
        f.originCountry.toLowerCase().includes(q)
    );
  }, [flights, flightSearch]);

  const filteredEarthquakes = useMemo(() => {
    return earthquakes.filter((e) => e.magnitude >= earthquakeMinMag);
  }, [earthquakes, earthquakeMinMag]);

  const filteredSatellites = useMemo(() => {
    const q = satelliteSearch.trim().toLowerCase();
    if (!q) return satellites;
    return satellites.filter(
      (s) => s.name.toLowerCase().includes(q) || String(s.noradId).includes(q)
    );
  }, [satellites, satelliteSearch]);

  const handleFlyToTarget = (target: SelectedTelemetryTarget) => {
    if (target.type === "flight") {
      flyTo(target.data.longitude, target.data.latitude, 9);
      flash(`Tracking Flight ${target.data.callsign || target.data.icao24}`);
    } else if (target.type === "earthquake") {
      flyTo(target.data.longitude, target.data.latitude, 7);
      flash(`Centered on M${target.data.magnitude.toFixed(1)} Epicenter`);
    } else if (target.type === "satellite") {
      flyTo(target.data.longitude, target.data.latitude, 4);
      flash(`Tracking Sub-Satellite Point: ${target.data.name}`);
    }
  };

  return (
    <PanelShell
      title="Telemetry & Live Feeds"
      eyebrow="Real-Time WebGL Radar"
      side="left"
      wide
      onClose={closePanel}
      headerTrailing={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="Refresh feeds"
            className="grid size-7 place-items-center rounded-lg text-ink-muted hover:bg-glass hover:text-ink disabled:opacity-40 transition-colors"
            disabled={loading}
            onClick={() => void refreshFeeds()}
          >
            <RefreshCw className={cx("size-3.5", loading && "animate-spin text-accent")} />
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        {/* Stream Status Banner */}
        <div className="flex items-center justify-between rounded-lg border border-line bg-surface-soft/60 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span
                className={cx(
                  "absolute inline-flex size-full animate-ping rounded-full opacity-75",
                  loading ? "bg-amber-400" : "bg-emerald-400"
                )}
              />
              <span
                className={cx(
                  "relative inline-flex size-2 rounded-full",
                  loading ? "bg-amber-500" : "bg-emerald-500"
                )}
              />
            </span>
            <span className="font-mono uppercase tracking-wider text-ink-muted">
              {loading ? "Streaming Telemetry..." : "Live WebGL Telemetry Active"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-ink-subtle">
              {lastUpdated ? formatTimeAgo(lastUpdated.getTime()) : "Connecting..."}
            </span>
            <select
              value={autoRefreshSeconds}
              onChange={(e) => setAutoRefresh(Number(e.target.value))}
              className="rounded bg-surface px-1.5 py-0.5 text-[11px] font-mono text-ink border border-line focus:outline-none"
              title="Auto-refresh interval"
            >
              <option value={0}>Auto: Off</option>
              <option value={10}>Auto: 10s</option>
              <option value={30}>Auto: 30s</option>
              <option value={60}>Auto: 60s</option>
            </select>
          </div>
        </div>

        {/* Global Feeds Overview Pill Counters */}
        <div className="grid grid-cols-3 gap-2">
          {/* Flights pill */}
          <button
            type="button"
            onClick={() => {
              setActiveTab("flights");
              if (!flightsEnabled) toggleFeed("flights");
            }}
            className={cx(
              "flex flex-col rounded-lg border p-2 text-left transition-all",
              activeTab === "flights"
                ? "border-accent bg-accent-soft/20 shadow-sm"
                : "border-line bg-surface/50 hover:border-line-strong hover:bg-surface-soft"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium text-ink">
                <Plane className="size-3.5 text-sky-400" />
                <span>Flights</span>
              </div>
              <input
                type="checkbox"
                checked={flightsEnabled}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleFeed("flights");
                }}
                className="size-3 rounded accent-accent"
                title="Toggle flight radar"
              />
            </div>
            <div className="mt-1 flex items-baseline justify-between font-mono">
              <span className="text-lg font-semibold text-ink">{flights.length}</span>
              <span className="text-[10px] text-sky-400">ADS-B</span>
            </div>
          </button>

          {/* Earthquakes pill */}
          <button
            type="button"
            onClick={() => {
              setActiveTab("earthquakes");
              if (!earthquakesEnabled) toggleFeed("earthquakes");
            }}
            className={cx(
              "flex flex-col rounded-lg border p-2 text-left transition-all",
              activeTab === "earthquakes"
                ? "border-accent bg-accent-soft/20 shadow-sm"
                : "border-line bg-surface/50 hover:border-line-strong hover:bg-surface-soft"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium text-ink">
                <Activity className="size-3.5 text-amber-400" />
                <span>Quakes</span>
              </div>
              <input
                type="checkbox"
                checked={earthquakesEnabled}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleFeed("earthquakes");
                }}
                className="size-3 rounded accent-accent"
                title="Toggle earthquake feed"
              />
            </div>
            <div className="mt-1 flex items-baseline justify-between font-mono">
              <span className="text-lg font-semibold text-ink">{earthquakes.length}</span>
              <span className="text-[10px] text-amber-400">USGS</span>
            </div>
          </button>

          {/* Satellites pill */}
          <button
            type="button"
            onClick={() => {
              setActiveTab("satellites");
              if (!satellitesEnabled) toggleFeed("satellites");
            }}
            className={cx(
              "flex flex-col rounded-lg border p-2 text-left transition-all",
              activeTab === "satellites"
                ? "border-accent bg-accent-soft/20 shadow-sm"
                : "border-line bg-surface/50 hover:border-line-strong hover:bg-surface-soft"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium text-ink">
                <Satellite className="size-3.5 text-purple-400" />
                <span>Orbits</span>
              </div>
              <input
                type="checkbox"
                checked={satellitesEnabled}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleFeed("satellites");
                }}
                className="size-3 rounded accent-accent"
                title="Toggle satellite feed"
              />
            </div>
            <div className="mt-1 flex items-baseline justify-between font-mono">
              <span className="text-lg font-semibold text-ink">{satellites.length}</span>
              <span className="text-[10px] text-purple-400">SGP4</span>
            </div>
          </button>
        </div>

        {/* Selected Target HUD Detail Box (if user clicked a feature on map or list) */}
        {selectedTarget && (
          <div className="relative overflow-hidden rounded-xl border border-accent/40 bg-accent-soft/10 p-3 shadow-md backdrop-blur-sm">
            <button
              type="button"
              className="absolute right-2 top-2 grid size-6 place-items-center rounded-md text-ink-muted hover:bg-glass hover:text-ink"
              onClick={() => setSelectedTarget(null)}
              title="Close inspection"
            >
              <X className="size-3.5" />
            </button>

            {selectedTarget.type === "flight" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-mono text-sky-400 font-semibold uppercase">
                    ADS-B Aircraft
                  </span>
                  <span className="font-mono text-sm font-bold text-ink">
                    {selectedTarget.data.callsign || selectedTarget.data.icao24}
                  </span>
                  <span className="text-xs text-ink-muted">
                    ({selectedTarget.data.originCountry})
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                  <div className="flex flex-col rounded bg-surface/60 p-1.5">
                    <span className="text-[10px] text-ink-subtle">ALTITUDE</span>
                    <span className="font-semibold text-ink">
                      {Math.round(selectedTarget.data.altitudeMeters).toLocaleString()} m
                    </span>
                    <span className="text-[10px] text-ink-muted">
                      ({Math.round(selectedTarget.data.altitudeMeters * 3.28084).toLocaleString()} ft)
                    </span>
                  </div>
                  <div className="flex flex-col rounded bg-surface/60 p-1.5">
                    <span className="text-[10px] text-ink-subtle">GROUND SPEED</span>
                    <span className="font-semibold text-ink">
                      {Math.round(selectedTarget.data.velocityMps * 3.6)} km/h
                    </span>
                    <span className="text-[10px] text-ink-muted">
                      ({Math.round(selectedTarget.data.velocityMps * 1.94384)} kts)
                    </span>
                  </div>
                  <div className="flex flex-col rounded bg-surface/60 p-1.5">
                    <span className="text-[10px] text-ink-subtle">HEADING</span>
                    <span className="font-semibold text-ink">
                      {Math.round(selectedTarget.data.headingDeg)}°
                    </span>
                    <span className="text-[10px] text-ink-muted">
                      {selectedTarget.data.squawk ? `Squawk: ${selectedTarget.data.squawk}` : "Airborne"}
                    </span>
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => handleFlyToTarget(selectedTarget)}
                    className={cx(PRIMARY_BUTTON, "text-xs py-1 px-3")}
                  >
                    <Navigation className="size-3" />
                    <span>Fly to Aircraft</span>
                  </button>
                </div>
              </div>
            )}

            {selectedTarget.type === "earthquake" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cx(
                      "rounded px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase",
                      selectedTarget.data.magnitude >= 6.0
                        ? "bg-red-500/20 text-red-400"
                        : selectedTarget.data.magnitude >= 4.5
                          ? "bg-amber-500/20 text-amber-400"
                          : "bg-cyan-500/20 text-cyan-400"
                    )}
                  >
                    M{selectedTarget.data.magnitude.toFixed(1)} Seismic Event
                  </span>
                  <span className="text-xs text-ink-muted">
                    {formatTimeAgo(selectedTarget.data.time)}
                  </span>
                </div>
                <div className="text-xs font-medium text-ink">{selectedTarget.data.place}</div>
                <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                  <div className="flex flex-col rounded bg-surface/60 p-1.5">
                    <span className="text-[10px] text-ink-subtle">DEPTH</span>
                    <span className="font-semibold text-ink">
                      {selectedTarget.data.depthKm.toFixed(1)} km
                    </span>
                  </div>
                  <div className="flex flex-col rounded bg-surface/60 p-1.5">
                    <span className="text-[10px] text-ink-subtle">SIGNIFICANCE</span>
                    <span className="font-semibold text-ink">
                      {selectedTarget.data.significance}
                    </span>
                  </div>
                  <div className="flex flex-col rounded bg-surface/60 p-1.5">
                    <span className="text-[10px] text-ink-subtle">TSUNAMI RISK</span>
                    <span
                      className={cx(
                        "font-semibold",
                        selectedTarget.data.tsunami ? "text-red-400" : "text-emerald-400"
                      )}
                    >
                      {selectedTarget.data.tsunami ? "YES" : "NO"}
                    </span>
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => handleFlyToTarget(selectedTarget)}
                    className={cx(PRIMARY_BUTTON, "text-xs py-1 px-3")}
                  >
                    <Navigation className="size-3" />
                    <span>Fly to Epicenter</span>
                  </button>
                </div>
              </div>
            )}

            {selectedTarget.type === "satellite" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-mono text-purple-400 font-semibold uppercase">
                    NORAD {selectedTarget.data.noradId}
                  </span>
                  <span className="text-sm font-bold text-ink">{selectedTarget.data.name}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                  <div className="flex flex-col rounded bg-surface/60 p-1.5">
                    <span className="text-[10px] text-ink-subtle">ALTITUDE</span>
                    <span className="font-semibold text-ink">
                      {(selectedTarget.data.altitudeKm ?? 0).toFixed(1)} km
                    </span>
                  </div>
                  <div className="flex flex-col rounded bg-surface/60 p-1.5">
                    <span className="text-[10px] text-ink-subtle">ORBITAL VELOCITY</span>
                    <span className="font-semibold text-ink">
                      {Math.round(selectedTarget.data.velocityKmh ?? 0).toLocaleString()} km/h
                    </span>
                  </div>
                  <div className="flex flex-col rounded bg-surface/60 p-1.5">
                    <span className="text-[10px] text-ink-subtle">GROUND POSITION</span>
                    <span className="font-semibold text-ink">
                      {(selectedTarget.data.latitude ?? 0).toFixed(2)}°, {(selectedTarget.data.longitude ?? 0).toFixed(2)}°
                    </span>
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => handleFlyToTarget(selectedTarget)}
                    className={cx(PRIMARY_BUTTON, "text-xs py-1 px-3")}
                  >
                    <Navigation className="size-3" />
                    <span>Fly to Sub-Satellite Point</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 1: Flights Feed */}
        {activeTab === "flights" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-ink-muted" />
                <input
                  type="text"
                  placeholder="Filter by callsign, ICAO, or country..."
                  value={flightSearch}
                  onChange={(e) => setFlightSearch(e.target.value)}
                  className={cx(FIELD_INPUT, "pl-8 text-xs py-1.5")}
                />
                {flightSearch && (
                  <button
                    type="button"
                    onClick={() => setFlightSearch("")}
                    className="absolute right-2.5 top-2.5 text-ink-subtle hover:text-ink"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex max-h-[300px] flex-col divide-y divide-line overflow-y-auto rounded-lg border border-line bg-surface/40">
              {filteredFlights.length === 0 ? (
                <div className="p-4 text-center text-xs text-ink-muted">
                  {flightsEnabled ? "No flights matching search." : "Flight radar feed is disabled."}
                </div>
              ) : (
                filteredFlights.map((flight) => (
                  <div
                    key={flight.icao24}
                    onClick={() => setSelectedTarget({ type: "flight", data: flight })}
                    className={cx(
                      "group flex items-center justify-between p-2.5 text-xs transition-colors hover:bg-surface-soft cursor-pointer",
                      selectedTarget?.type === "flight" &&
                        selectedTarget.data.icao24 === flight.icao24 &&
                        "bg-accent-soft/20"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="grid size-7 shrink-0 place-items-center rounded-md bg-surface border border-line text-sky-400 group-hover:border-accent"
                        style={{
                          transform: `rotate(${flight.headingDeg}deg)`,
                          transition: "transform 0.2s ease-out",
                        }}
                        title={`Heading ${Math.round(flight.headingDeg)}°`}
                      >
                        <Plane className="size-4" />
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-ink">
                            {flight.callsign || flight.icao24}
                          </span>
                          <span className="text-[10px] text-ink-subtle">{flight.icao24}</span>
                        </div>
                        <span className="text-[11px] text-ink-muted truncate max-w-[150px]">
                          {flight.originCountry}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 font-mono text-[11px]">
                      <div className="flex flex-col text-right">
                        <span className="text-ink">
                          {Math.round(flight.altitudeMeters).toLocaleString()} m
                        </span>
                        <span className="text-[10px] text-ink-subtle">
                          {Math.round(flight.velocityMps * 3.6)} km/h
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFlyToTarget({ type: "flight", data: flight });
                        }}
                        className="rounded p-1 text-ink-subtle hover:bg-glass hover:text-accent"
                        title="Fly to target"
                      >
                        <ArrowUpRight className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Earthquakes Feed */}
        {activeTab === "earthquakes" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-ink-muted">Min Magnitude:</span>
              <div className="flex items-center gap-1">
                {[1.0, 2.5, 4.5, 6.0].map((mag) => (
                  <button
                    key={mag}
                    type="button"
                    onClick={() => setEarthquakeMinMag(mag)}
                    className={cx(
                      "rounded px-2 py-0.5 font-mono text-xs border transition-colors",
                      earthquakeMinMag === mag
                        ? "border-accent bg-accent-soft text-accent font-semibold"
                        : "border-line bg-surface text-ink-muted hover:text-ink"
                    )}
                  >
                    M{mag}+
                  </button>
                ))}
              </div>
            </div>

            <div className="flex max-h-[300px] flex-col divide-y divide-line overflow-y-auto rounded-lg border border-line bg-surface/40">
              {filteredEarthquakes.length === 0 ? (
                <div className="p-4 text-center text-xs text-ink-muted">
                  {earthquakesEnabled
                    ? "No seismic events matching filter."
                    : "Earthquake feed is disabled."}
                </div>
              ) : (
                filteredEarthquakes.map((eq) => (
                  <div
                    key={eq.id}
                    onClick={() => setSelectedTarget({ type: "earthquake", data: eq })}
                    className={cx(
                      "group flex items-center justify-between p-2.5 text-xs transition-colors hover:bg-surface-soft cursor-pointer",
                      selectedTarget?.type === "earthquake" &&
                        selectedTarget.data.id === eq.id &&
                        "bg-accent-soft/20"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={cx(
                          "grid size-8 shrink-0 place-items-center rounded-lg font-mono font-bold text-xs shadow-sm",
                          eq.magnitude >= 6.0
                            ? "bg-red-500/20 text-red-400 border border-red-500/40"
                            : eq.magnitude >= 4.5
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                              : "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40"
                        )}
                      >
                        {eq.magnitude.toFixed(1)}
                      </div>
                      <div className="flex flex-col">
                        <span className="font-medium text-ink truncate max-w-[170px]">
                          {eq.place}
                        </span>
                        <div className="flex items-center gap-1.5 text-[10px] text-ink-subtle">
                          <span>Depth: {eq.depthKm.toFixed(1)} km</span>
                          <span>·</span>
                          <span>{formatTimeAgo(eq.time)}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFlyToTarget({ type: "earthquake", data: eq });
                      }}
                      className="rounded p-1 text-ink-subtle hover:bg-glass hover:text-accent"
                      title="Fly to epicenter"
                    >
                      <ArrowUpRight className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Satellites Feed */}
        {activeTab === "satellites" && (
          <div className="flex flex-col gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-ink-muted" />
              <input
                type="text"
                placeholder="Search satellite name or NORAD ID..."
                value={satelliteSearch}
                onChange={(e) => setSatelliteSearch(e.target.value)}
                className={cx(FIELD_INPUT, "pl-8 text-xs py-1.5")}
              />
            </div>

            <div className="flex max-h-[300px] flex-col divide-y divide-line overflow-y-auto rounded-lg border border-line bg-surface/40">
              {filteredSatellites.length === 0 ? (
                <div className="p-4 text-center text-xs text-ink-muted">
                  {satellitesEnabled
                    ? "No satellites matching search."
                    : "Satellite tracking feed is disabled."}
                </div>
              ) : (
                filteredSatellites.map((sat) => (
                  <div
                    key={sat.id}
                    onClick={() => setSelectedTarget({ type: "satellite", data: sat })}
                    className={cx(
                      "group flex items-center justify-between p-2.5 text-xs transition-colors hover:bg-surface-soft cursor-pointer",
                      selectedTarget?.type === "satellite" &&
                        selectedTarget.data.id === sat.id &&
                        "bg-accent-soft/20"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="grid size-7 shrink-0 place-items-center rounded-md bg-purple-500/20 text-purple-400 border border-purple-500/30">
                        <Satellite className="size-4" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-medium text-ink">{sat.name}</span>
                        <span className="font-mono text-[10px] text-ink-subtle">
                          NORAD {sat.noradId} · {(sat.altitudeKm ?? 0).toFixed(0)} km alt
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 font-mono text-[11px]">
                      <span className="text-ink">
                        {Math.round(sat.velocityKmh ?? 0).toLocaleString()} km/h
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFlyToTarget({ type: "satellite", data: sat });
                        }}
                        className="rounded p-1 text-ink-subtle hover:bg-glass hover:text-accent"
                        title="Fly to satellite"
                      >
                        <ArrowUpRight className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </PanelShell>
  );
}
