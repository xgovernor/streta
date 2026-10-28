import { useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Layers,
  Navigation,
  Plane,
  RefreshCw,
  Satellite,
  Search,
  X,
} from "lucide-react";
import { cx } from "../../lib/cx";
import { formatCount } from "../../lib/format";
import { GEOGRAPHIC_CRS } from "../../lib/gis/crs";
import {
  earthquakeTargetsToFeatures,
  flightTargetsToFeatures,
  satelliteTargetsToFeatures,
} from "../../lib/gis/tiledBackend";
import { flyTo } from "../../map/mapController";
import { useProjectStore } from "../../state/projectStore";
import {
  useTelemetryStore,
  type SelectedTelemetryTarget,
  type TelemetryFeedType,
} from "../../state/telemetryStore";
import { useUiStore } from "../../state/uiStore";
import {
  FIELD_INPUT,
  ICON_BUTTON,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SectionLabel,
  Switch,
} from "./shared";

type ExpandedFeed = "flights" | "earthquakes" | "satellites" | null;

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

export function LiveFeedsSection() {
  const notify = useUiStore((state) => state.notify);
  const flash = useUiStore((state) => state.flash);

  const addDataset = useProjectStore((state) => state.addDataset);

  const [expandedFeed, setExpandedFeed] = useState<ExpandedFeed>(null);

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

  // Filtered target lists
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
      flash(`Tracking Satellite: ${target.data.name}`);
    }
  };

  const snapshotFeed = (feed: TelemetryFeedType) => {
    if (feed === "flights") {
      if (flights.length === 0) {
        notify("No flight targets available to snapshot.");
        return;
      }
      const features = flightTargetsToFeatures(flights);
      const layerId = `flights_${Date.now().toString(36)}`;
      addDataset({
        name: `Live Flights (${formatCount(features.length)})`,
        kind: "sample",
        source: "telemetry:flights",
        layers: [
          {
            id: layerId,
            name: "ADS-B Flights",
            features,
            crs: GEOGRAPHIC_CRS,
            format: "geojson",
            source: "telemetry:flights",
          },
        ],
      });
      notify(`Snapshotted ${formatCount(features.length)} flights into workspace`);
    } else if (feed === "earthquakes") {
      if (earthquakes.length === 0) {
        notify("No earthquake events available to snapshot.");
        return;
      }
      const features = earthquakeTargetsToFeatures(earthquakes);
      const layerId = `quakes_${Date.now().toString(36)}`;
      addDataset({
        name: `USGS Earthquakes M${earthquakeMinMag}+ (${formatCount(features.length)})`,
        kind: "sample",
        source: "telemetry:earthquakes",
        layers: [
          {
            id: layerId,
            name: "Earthquake Epicenters",
            features,
            crs: GEOGRAPHIC_CRS,
            format: "geojson",
            source: "telemetry:earthquakes",
          },
        ],
      });
      notify(`Snapshotted ${formatCount(features.length)} earthquakes into workspace`);
    } else if (feed === "satellites") {
      if (satellites.length === 0) {
        notify("No satellite targets available to snapshot.");
        return;
      }
      const features = satelliteTargetsToFeatures(satellites);
      const layerId = `satellites_${Date.now().toString(36)}`;
      addDataset({
        name: `Orbital Satellites (${formatCount(features.length)})`,
        kind: "sample",
        source: "telemetry:satellites",
        layers: [
          {
            id: layerId,
            name: "Sub-Satellite Points",
            features,
            crs: GEOGRAPHIC_CRS,
            format: "geojson",
            source: "telemetry:satellites",
          },
        ],
      });
      notify(`Snapshotted ${formatCount(features.length)} satellites into workspace`);
    }
  };

  const anyLiveActive = flightsEnabled || earthquakesEnabled || satellitesEnabled;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <SectionLabel trailing="Real-time WebGL streaming">
          Live feeds & telemetry
        </SectionLabel>
        <div className="flex items-center gap-1.5 font-mono text-[9px] text-ink-muted">
          <span>{lastUpdated ? formatTimeAgo(lastUpdated.getTime()) : "Connecting"}</span>
          <button
            type="button"
            className={ICON_BUTTON}
            title="Refresh live feeds"
            aria-label="Refresh telemetry feeds"
            disabled={loading}
            onClick={() => void refreshFeeds()}
          >
            <RefreshCw
              size={11}
              strokeWidth={2}
              className={cx("transition-transform", loading && "animate-spin text-accent")}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {/* Stream Control & Refresh Bar */}
      <div className="flex items-center justify-between rounded-lg border border-line bg-tint px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            {anyLiveActive && (
              <span
                className={cx(
                  "absolute inline-flex size-full animate-ping rounded-full opacity-75",
                  loading ? "bg-amber-400" : "bg-emerald-400"
                )}
              />
            )}
            <span
              className={cx(
                "relative inline-flex size-2 rounded-full",
                !anyLiveActive
                  ? "bg-ink-muted"
                  : loading
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              )}
            />
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-ink-muted">
            {loading
              ? "Streaming..."
              : anyLiveActive
                ? "Live WebGL Feeds"
                : "Feeds Paused"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={autoRefreshSeconds}
            onChange={(e) => setAutoRefresh(Number(e.target.value))}
            className="rounded border border-line bg-shell-2 px-1.5 py-0.5 font-mono text-[9.5px] text-ink focus:outline-none"
            title="Auto-refresh interval"
          >
            <option value={0}>Auto: Off</option>
            <option value={10}>Auto: 10s</option>
            <option value={30}>Auto: 30s</option>
            <option value={60}>Auto: 60s</option>
          </select>
        </div>
      </div>

      {/* Selected Target HUD Detail Box (if user clicked a feature) */}
      {selectedTarget && (
        <div className="relative overflow-hidden rounded-lg border border-accent/40 bg-accent-soft/15 p-2.5 text-xs backdrop-blur-sm">
          <button
            type="button"
            className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded text-ink-muted hover:bg-glass hover:text-ink"
            onClick={() => setSelectedTarget(null)}
            title="Close inspection"
          >
            <X size={12} strokeWidth={2} />
          </button>

          {selectedTarget.type === "flight" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-sky-500/20 px-1 py-0.5 font-mono text-[9px] font-semibold uppercase text-sky-400">
                  ADS-B Flight
                </span>
                <strong className="font-mono text-[11px] text-ink">
                  {selectedTarget.data.callsign || selectedTarget.data.icao24}
                </strong>
                <span className="truncate text-[10px] text-ink-muted">
                  ({selectedTarget.data.originCountry})
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 font-mono text-[9.5px]">
                <div className="flex flex-col rounded bg-surface/70 p-1">
                  <span className="text-[8px] text-ink-subtle">ALTITUDE</span>
                  <span className="font-semibold text-ink">
                    {Math.round(selectedTarget.data.altitudeMeters).toLocaleString()} m
                  </span>
                </div>
                <div className="flex flex-col rounded bg-surface/70 p-1">
                  <span className="text-[8px] text-ink-subtle">SPEED</span>
                  <span className="font-semibold text-ink">
                    {Math.round(selectedTarget.data.velocityMps * 3.6)} km/h
                  </span>
                </div>
                <div className="flex flex-col rounded bg-surface/70 p-1">
                  <span className="text-[8px] text-ink-subtle">HEADING</span>
                  <span className="font-semibold text-ink">
                    {Math.round(selectedTarget.data.headingDeg)}°
                  </span>
                </div>
              </div>
              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  onClick={() => handleFlyToTarget(selectedTarget)}
                  className={cx(PRIMARY_BUTTON, "h-[22px] px-2 text-[9.5px]")}
                >
                  <Navigation size={10} strokeWidth={2} />
                  <span>Fly to aircraft</span>
                </button>
              </div>
            </div>
          )}

          {selectedTarget.type === "earthquake" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  className={cx(
                    "rounded px-1 py-0.5 font-mono text-[9px] font-bold uppercase",
                    selectedTarget.data.magnitude >= 6.0
                      ? "bg-red-500/20 text-red-400"
                      : selectedTarget.data.magnitude >= 4.5
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-cyan-500/20 text-cyan-400"
                  )}
                >
                  M{selectedTarget.data.magnitude.toFixed(1)} Seismic
                </span>
                <span className="text-[10px] text-ink-muted">
                  {formatTimeAgo(selectedTarget.data.time)}
                </span>
              </div>
              <div className="truncate text-[10.5px] font-medium text-ink">
                {selectedTarget.data.place}
              </div>
              <div className="grid grid-cols-3 gap-1.5 font-mono text-[9.5px]">
                <div className="flex flex-col rounded bg-surface/70 p-1">
                  <span className="text-[8px] text-ink-subtle">DEPTH</span>
                  <span className="font-semibold text-ink">
                    {selectedTarget.data.depthKm.toFixed(1)} km
                  </span>
                </div>
                <div className="flex flex-col rounded bg-surface/70 p-1">
                  <span className="text-[8px] text-ink-subtle">SIGNIFICANCE</span>
                  <span className="font-semibold text-ink">
                    {selectedTarget.data.significance}
                  </span>
                </div>
                <div className="flex flex-col rounded bg-surface/70 p-1">
                  <span className="text-[8px] text-ink-subtle">TSUNAMI RISK</span>
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
              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  onClick={() => handleFlyToTarget(selectedTarget)}
                  className={cx(PRIMARY_BUTTON, "h-[22px] px-2 text-[9.5px]")}
                >
                  <Navigation size={10} strokeWidth={2} />
                  <span>Fly to epicenter</span>
                </button>
              </div>
            </div>
          )}

          {selectedTarget.type === "satellite" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-purple-500/20 px-1 py-0.5 font-mono text-[9px] font-semibold uppercase text-purple-400">
                  NORAD {selectedTarget.data.noradId}
                </span>
                <strong className="truncate text-[11px] font-semibold text-ink">
                  {selectedTarget.data.name}
                </strong>
              </div>
              <div className="grid grid-cols-3 gap-1.5 font-mono text-[9.5px]">
                <div className="flex flex-col rounded bg-surface/70 p-1">
                  <span className="text-[8px] text-ink-subtle">ALTITUDE</span>
                  <span className="font-semibold text-ink">
                    {(selectedTarget.data.altitudeKm ?? 0).toFixed(0)} km
                  </span>
                </div>
                <div className="flex flex-col rounded bg-surface/70 p-1">
                  <span className="text-[8px] text-ink-subtle">VELOCITY</span>
                  <span className="font-semibold text-ink">
                    {Math.round(selectedTarget.data.velocityKmh ?? 0).toLocaleString()} km/h
                  </span>
                </div>
                <div className="flex flex-col rounded bg-surface/70 p-1">
                  <span className="text-[8px] text-ink-subtle">SUB-SAT POS</span>
                  <span className="font-semibold text-ink">
                    {(selectedTarget.data.latitude ?? 0).toFixed(1)}°, {(selectedTarget.data.longitude ?? 0).toFixed(1)}°
                  </span>
                </div>
              </div>
              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  onClick={() => handleFlyToTarget(selectedTarget)}
                  className={cx(PRIMARY_BUTTON, "h-[22px] px-2 text-[9.5px]")}
                >
                  <Navigation size={10} strokeWidth={2} />
                  <span>Fly to sub-satellite point</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* The 3 Live Feed Cards */}
      <div className="flex flex-col gap-1.5">
        {/* Feed 1: Live Flights */}
        <div
          className={cx(
            "rounded-lg border transition-colors",
            flightsEnabled
              ? "border-line-strong bg-raised"
              : "border-line bg-tint opacity-80"
          )}
        >
          <div className="flex items-center gap-2 p-2">
            <button
              type="button"
              className={ICON_BUTTON}
              aria-label={expandedFeed === "flights" ? "Collapse flights" : "Expand flights"}
              onClick={() =>
                setExpandedFeed(expandedFeed === "flights" ? null : "flights")
              }
            >
              {expandedFeed === "flights" ? (
                <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
              ) : (
                <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
              )}
            </button>

            <span className="grid size-[26px] flex-none place-items-center rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-400">
              <Plane size={14} strokeWidth={1.8} aria-hidden="true" />
            </span>

            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <strong className="truncate text-[11px] font-semibold text-ink">
                Live Flights (ADS-B)
              </strong>
              <span className="truncate font-mono text-[9px] text-ink-muted">
                OpenSky Network · {formatCount(flights.length)} aircraft · Radar
              </span>
            </span>

            <Switch
              checked={flightsEnabled}
              label="Toggle live flights radar"
              onChange={() => toggleFeed("flights")}
            />
          </div>

          {expandedFeed === "flights" && (
            <div className="flex flex-col gap-2 border-t border-line p-2">
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1.5 size-3 text-ink-muted" />
                  <input
                    type="text"
                    placeholder="Search callsign or country..."
                    value={flightSearch}
                    onChange={(e) => setFlightSearch(e.target.value)}
                    className={cx(FIELD_INPUT, "h-[24px] pl-6 text-[10px]")}
                  />
                  {flightSearch && (
                    <button
                      type="button"
                      onClick={() => setFlightSearch("")}
                      className="absolute right-2 top-1.5 text-ink-subtle hover:text-ink"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  title="Snapshot current flights into workspace layers"
                  onClick={() => snapshotFeed("flights")}
                >
                  <Layers size={11} strokeWidth={2} />
                  <span>Snapshot</span>
                </button>
              </div>

              {/* Scrollable Flights Target List */}
              <div className="flex max-h-[180px] flex-col divide-y divide-line overflow-y-auto rounded border border-line bg-shell-2">
                {filteredFlights.length === 0 ? (
                  <div className="p-3 text-center text-[10px] text-ink-muted">
                    {flightsEnabled
                      ? "No aircraft matching search."
                      : "Flight radar feed is currently disabled."}
                  </div>
                ) : (
                  filteredFlights.map((flight) => (
                    <div
                      key={flight.icao24}
                      onClick={() => setSelectedTarget({ type: "flight", data: flight })}
                      className={cx(
                        "group flex items-center justify-between p-1.5 text-[10px] transition-colors hover:bg-tint cursor-pointer",
                        selectedTarget?.type === "flight" &&
                          selectedTarget.data.icao24 === flight.icao24 &&
                          "bg-accent-soft/20"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="grid size-5 flex-none place-items-center rounded bg-tint text-sky-400 group-hover:text-accent"
                          style={{
                            transform: `rotate(${flight.headingDeg}deg)`,
                            transition: "transform 0.2s ease-out",
                          }}
                          title={`Heading ${Math.round(flight.headingDeg)}°`}
                        >
                          <Plane size={11} strokeWidth={2} />
                        </span>
                        <div className="flex flex-col min-w-0">
                          <span className="font-mono font-semibold text-ink truncate">
                            {flight.callsign || flight.icao24}
                          </span>
                          <span className="truncate text-[8.5px] text-ink-muted">
                            {flight.originCountry}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 font-mono text-[9px]">
                        <div className="flex flex-col text-right">
                          <span className="text-ink">
                            {Math.round(flight.altitudeMeters).toLocaleString()}m
                          </span>
                          <span className="text-[8px] text-ink-subtle">
                            {Math.round(flight.velocityMps * 3.6)}km/h
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFlyToTarget({ type: "flight", data: flight });
                          }}
                          className="rounded p-0.5 text-ink-subtle hover:bg-tint hover:text-accent"
                          title="Fly to aircraft"
                        >
                          <ArrowUpRight size={11} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Feed 2: Global Earthquakes */}
        <div
          className={cx(
            "rounded-lg border transition-colors",
            earthquakesEnabled
              ? "border-line-strong bg-raised"
              : "border-line bg-tint opacity-80"
          )}
        >
          <div className="flex items-center gap-2 p-2">
            <button
              type="button"
              className={ICON_BUTTON}
              aria-label={
                expandedFeed === "earthquakes" ? "Collapse quakes" : "Expand quakes"
              }
              onClick={() =>
                setExpandedFeed(expandedFeed === "earthquakes" ? null : "earthquakes")
              }
            >
              {expandedFeed === "earthquakes" ? (
                <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
              ) : (
                <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
              )}
            </button>

            <span className="grid size-[26px] flex-none place-items-center rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-400">
              <Activity size={14} strokeWidth={1.8} aria-hidden="true" />
            </span>

            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <strong className="truncate text-[11px] font-semibold text-ink">
                Global Earthquakes (USGS)
              </strong>
              <span className="truncate font-mono text-[9px] text-ink-muted">
                USGS Real-time · {formatCount(earthquakes.length)} events · M{earthquakeMinMag}+
              </span>
            </span>

            <Switch
              checked={earthquakesEnabled}
              label="Toggle live earthquakes feed"
              onChange={() => toggleFeed("earthquakes")}
            />
          </div>

          {expandedFeed === "earthquakes" && (
            <div className="flex flex-col gap-2 border-t border-line p-2">
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1 font-mono text-[9px]">
                  <span className="text-ink-muted mr-0.5">Filter:</span>
                  {[1.0, 2.5, 4.5, 6.0].map((mag) => (
                    <button
                      key={mag}
                      type="button"
                      onClick={() => setEarthquakeMinMag(mag)}
                      className={cx(
                        "rounded px-1.5 py-0.5 border transition-colors",
                        earthquakeMinMag === mag
                          ? "border-accent bg-accent-soft text-accent font-semibold"
                          : "border-line bg-shell-2 text-ink-muted hover:text-ink"
                      )}
                    >
                      M{mag}+
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  title="Snapshot current earthquakes into workspace layers"
                  onClick={() => snapshotFeed("earthquakes")}
                >
                  <Layers size={11} strokeWidth={2} />
                  <span>Snapshot</span>
                </button>
              </div>

              {/* Scrollable Earthquakes Target List */}
              <div className="flex max-h-[180px] flex-col divide-y divide-line overflow-y-auto rounded border border-line bg-shell-2">
                {filteredEarthquakes.length === 0 ? (
                  <div className="p-3 text-center text-[10px] text-ink-muted">
                    {earthquakesEnabled
                      ? "No earthquakes matching magnitude filter."
                      : "Earthquake feed is currently disabled."}
                  </div>
                ) : (
                  filteredEarthquakes.map((eq) => (
                    <div
                      key={eq.id}
                      onClick={() => setSelectedTarget({ type: "earthquake", data: eq })}
                      className={cx(
                        "group flex items-center justify-between p-1.5 text-[10px] transition-colors hover:bg-tint cursor-pointer",
                        selectedTarget?.type === "earthquake" &&
                          selectedTarget.data.id === eq.id &&
                          "bg-accent-soft/20"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={cx(
                            "grid size-5 flex-none place-items-center rounded font-mono font-bold text-[9px]",
                            eq.magnitude >= 6.0
                              ? "bg-red-500/20 text-red-400"
                              : eq.magnitude >= 4.5
                                ? "bg-amber-500/20 text-amber-400"
                                : "bg-cyan-500/20 text-cyan-400"
                          )}
                        >
                          {eq.magnitude.toFixed(1)}
                        </span>
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium text-ink truncate max-w-[170px]">
                            {eq.place}
                          </span>
                          <span className="text-[8.5px] text-ink-muted">
                            {eq.depthKm.toFixed(1)} km · {formatTimeAgo(eq.time)}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFlyToTarget({ type: "earthquake", data: eq });
                        }}
                        className="rounded p-0.5 text-ink-subtle hover:bg-tint hover:text-accent"
                        title="Fly to epicenter"
                      >
                        <ArrowUpRight size={11} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Feed 3: Orbital Satellites */}
        <div
          className={cx(
            "rounded-lg border transition-colors",
            satellitesEnabled
              ? "border-line-strong bg-raised"
              : "border-line bg-tint opacity-80"
          )}
        >
          <div className="flex items-center gap-2 p-2">
            <button
              type="button"
              className={ICON_BUTTON}
              aria-label={
                expandedFeed === "satellites" ? "Collapse satellites" : "Expand satellites"
              }
              onClick={() =>
                setExpandedFeed(expandedFeed === "satellites" ? null : "satellites")
              }
            >
              {expandedFeed === "satellites" ? (
                <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
              ) : (
                <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
              )}
            </button>

            <span className="grid size-[26px] flex-none place-items-center rounded-md border border-purple-500/30 bg-purple-500/10 text-purple-400">
              <Satellite size={14} strokeWidth={1.8} aria-hidden="true" />
            </span>

            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <strong className="truncate text-[11px] font-semibold text-ink">
                Orbital Satellites (SGP4)
              </strong>
              <span className="truncate font-mono text-[9px] text-ink-muted">
                CelesTrak SGP4 · {formatCount(satellites.length)} objects · 90m orbits
              </span>
            </span>

            <Switch
              checked={satellitesEnabled}
              label="Toggle orbital satellites feed"
              onChange={() => toggleFeed("satellites")}
            />
          </div>

          {expandedFeed === "satellites" && (
            <div className="flex flex-col gap-2 border-t border-line p-2">
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1.5 size-3 text-ink-muted" />
                  <input
                    type="text"
                    placeholder="Search satellite name or NORAD..."
                    value={satelliteSearch}
                    onChange={(e) => setSatelliteSearch(e.target.value)}
                    className={cx(FIELD_INPUT, "h-[24px] pl-6 text-[10px]")}
                  />
                  {satelliteSearch && (
                    <button
                      type="button"
                      onClick={() => setSatelliteSearch("")}
                      className="absolute right-2 top-1.5 text-ink-subtle hover:text-ink"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  title="Snapshot current satellites into workspace layers"
                  onClick={() => snapshotFeed("satellites")}
                >
                  <Layers size={11} strokeWidth={2} />
                  <span>Snapshot</span>
                </button>
              </div>

              {/* Scrollable Satellites Target List */}
              <div className="flex max-h-[180px] flex-col divide-y divide-line overflow-y-auto rounded border border-line bg-shell-2">
                {filteredSatellites.length === 0 ? (
                  <div className="p-3 text-center text-[10px] text-ink-muted">
                    {satellitesEnabled
                      ? "No satellites matching search."
                      : "Satellite feed is currently disabled."}
                  </div>
                ) : (
                  filteredSatellites.map((sat) => (
                    <div
                      key={sat.id}
                      onClick={() => setSelectedTarget({ type: "satellite", data: sat })}
                      className={cx(
                        "group flex items-center justify-between p-1.5 text-[10px] transition-colors hover:bg-tint cursor-pointer",
                        selectedTarget?.type === "satellite" &&
                          selectedTarget.data.id === sat.id &&
                          "bg-accent-soft/20"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="grid size-5 flex-none place-items-center rounded bg-purple-500/10 text-purple-400">
                          <Satellite size={11} strokeWidth={2} />
                        </span>
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium text-ink truncate max-w-[170px]">
                            {sat.name}
                          </span>
                          <span className="font-mono text-[8.5px] text-ink-muted">
                            NORAD {sat.noradId} · {(sat.altitudeKm ?? 0).toFixed(0)} km
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 font-mono text-[9px]">
                        <span className="text-ink">
                          {Math.round(sat.velocityKmh ?? 0).toLocaleString()} km/h
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFlyToTarget({ type: "satellite", data: sat });
                          }}
                          className="rounded p-0.5 text-ink-subtle hover:bg-tint hover:text-accent"
                          title="Fly to satellite"
                        >
                          <ArrowUpRight size={11} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
