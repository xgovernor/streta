import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Car,
  ChevronDown,
  ChevronRight,
  Flame,
  Layers,
  Navigation,
  Plane,
  RefreshCw,
  Satellite,
  Search,
  Ship,
  X,
} from "lucide-react";
import { cx } from "../../lib/cx";
import { formatCount } from "../../lib/format";
import { GEOGRAPHIC_CRS } from "../../lib/gis/crs";
import {
  earthquakeTargetsToFeatures,
  fetchAdsbTelemetryStatus,
  fireTargetsToFeatures,
  flightTargetsToFeatures,
  getApiProvidersStatus,
  satelliteTargetsToFeatures,
  vesselTargetsToFeatures,
  fetchFlightTrail,
  type AdsbTelemetryStatus,
  type ApiProvidersStatus,
} from "../../lib/gis/tiledBackend";
import { flyTo } from "../../map/mapController";
import { displayFlightTrail } from "../../map/webglTelemetry";
import {
  fetchAircraftExtendedDetails,
  fetchSatelliteExtendedDetails,
  resolveVesselFlag,
  type AircraftExtendedDetails,
  type SatelliteExtendedDetails,
} from "../../lib/gis/telemetryExtendedDb";
import { useProjectStore } from "../../state/projectStore";
import {
  FEED_PROVENANCE,
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

type ExpandedFeed =
  | "flights"
  | "earthquakes"
  | "satellites"
  | "fires"
  | "vessels"
  | null;

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

/**
 * Per-feed provenance and health: who publishes it, when it was last fetched
 * and whether the last fetch failed. This is the data-age truth the old
 * pulsing "live" dot hid.
 */
function FeedProvenance({ feed }: { feed: TelemetryFeedType }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const status = useTelemetryStore((state) => state.feedStatus[feed]);
  const provenance = FEED_PROVENANCE[feed];

  return (
    <>
      <span className="truncate font-mono text-[9px] text-ink-muted">
        {provenance.provider} · {provenance.organization} · {provenance.cadence}
      </span>
      <span
        className={cx(
          "flex items-center gap-1 truncate font-mono text-[9px]",
          status.lastError ? "text-critical" : "text-ink-muted",
        )}
        title={status.lastError ?? undefined}
      >
        {status.lastError ? (
          <>
            <AlertTriangle size={9} strokeWidth={2} aria-hidden="true" />
            <span className="truncate">Last fetch failed — shown data is stale</span>
          </>
        ) : (
          <>
            <span>
              Fetched {status.lastOk ? formatTimeAgo(status.lastOk) : "—"} ·{" "}
              {formatCount(status.count)} targets
            </span>
          </>
        )}
      </span>
    </>
  );
}

export function LiveFeedsSection() {
  const notify = useUiStore((state) => state.notify);
  const flash = useUiStore((state) => state.flash);
  const trafficFlow = useUiStore((state) => state.trafficFlow);
  const setTrafficFlow = useUiStore((state) => state.setTrafficFlow);

  const addDataset = useProjectStore((state) => state.addDataset);

  const [expandedFeed, setExpandedFeed] = useState<ExpandedFeed>(null);
  const [providerStatus, setProviderStatus] = useState<ApiProvidersStatus | null>(null);

  useEffect(() => {
    void getApiProvidersStatus().then(setProviderStatus).catch(() => { });
  }, []);

  const flightsEnabled = useTelemetryStore((state) => state.flightsEnabled);
  const earthquakesEnabled = useTelemetryStore((state) => state.earthquakesEnabled);
  const satellitesEnabled = useTelemetryStore((state) => state.satellitesEnabled);
  const firesEnabled = useTelemetryStore((state) => state.firesEnabled);
  const vesselsEnabled = useTelemetryStore((state) => state.vesselsEnabled);
  const autoRefreshSeconds = useTelemetryStore((state) => state.autoRefreshSeconds);
  const loading = useTelemetryStore((state) => state.loading);
  const lastUpdated = useTelemetryStore((state) => state.lastUpdated);
  const selectedTarget = useTelemetryStore((state) => state.selectedTarget);

  const flights = useTelemetryStore((state) => state.flights);
  const earthquakes = useTelemetryStore((state) => state.earthquakes);
  const satellites = useTelemetryStore((state) => state.satellites);
  const fires = useTelemetryStore((state) => state.fires);
  const vessels = useTelemetryStore((state) => state.vessels);

  const flightSearch = useTelemetryStore((state) => state.flightSearch);
  const earthquakeMinMag = useTelemetryStore((state) => state.earthquakeMinMag);
  const satelliteSearch = useTelemetryStore((state) => state.satelliteSearch);
  const fireMinConfidence = useTelemetryStore((state) => state.fireMinConfidence);
  const vesselSearch = useTelemetryStore((state) => state.vesselSearch);

  const toggleFeed = useTelemetryStore((state) => state.toggleFeed);
  const setAutoRefresh = useTelemetryStore((state) => state.setAutoRefresh);
  const setFlightSearch = useTelemetryStore((state) => state.setFlightSearch);
  const setEarthquakeMinMag = useTelemetryStore((state) => state.setEarthquakeMinMag);
  const setSatelliteSearch = useTelemetryStore((state) => state.setSatelliteSearch);
  const setFireMinConfidence = useTelemetryStore((state) => state.setFireMinConfidence);
  const setVesselSearch = useTelemetryStore((state) => state.setVesselSearch);
  const setSelectedTarget = useTelemetryStore((state) => state.setSelectedTarget);
  const refreshFeeds = useTelemetryStore((state) => state.refreshFeeds);

  const [adsbStatus, setAdsbStatus] = useState<AdsbTelemetryStatus | null>(null);
  const [extendedAircraft, setExtendedAircraft] = useState<AircraftExtendedDetails | null>(null);
  const [extendedSatellite, setExtendedSatellite] = useState<SatelliteExtendedDetails | null>(null);
  const [extendedLoading, setExtendedLoading] = useState(false);

  useEffect(() => {
    fetchAdsbTelemetryStatus().then(setAdsbStatus);
  }, [flights.length]);

  useEffect(() => {
    setExtendedAircraft(null);
    setExtendedSatellite(null);
    if (!selectedTarget) return;

    if (selectedTarget.type === "flight") {
      setExtendedLoading(true);
      fetchAircraftExtendedDetails(selectedTarget.data.icao24, selectedTarget.data.callsign)
        .then((details) => {
          setExtendedAircraft(details);
        })
        .finally(() => setExtendedLoading(false));
    } else if (selectedTarget.type === "satellite") {
      setExtendedLoading(true);
      fetchSatelliteExtendedDetails(selectedTarget.data.noradId)
        .then((details) => {
          setExtendedSatellite(details);
        })
        .finally(() => setExtendedLoading(false));
    }
  }, [selectedTarget]);

  // Filtered target lists
  const filteredFlights = useMemo(() => {
    const q = flightSearch.trim().toLowerCase();
    if (!q) return flights;
    return flights.filter(
      (f) =>
        f.callsign.toLowerCase().includes(q) ||
        f.icao24.toLowerCase().includes(q) ||
        f.originCountry.toLowerCase().includes(q) ||
        (f.squawk && f.squawk.includes(q)) ||
        (f.emergency && f.emergency.toLowerCase().includes(q)) ||
        (f.categoryLabel && f.categoryLabel.toLowerCase().includes(q))
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

  const filteredFires = useMemo(() => {
    return fires.filter((f) => {
      const num = parseInt(f.confidence, 10);
      if (!isNaN(num)) return num >= fireMinConfidence;
      if (f.confidence.toLowerCase() === "h" || f.confidence.toLowerCase() === "high") return true;
      if (f.confidence.toLowerCase() === "n" || f.confidence.toLowerCase() === "nominal") return fireMinConfidence <= 70;
      return true;
    });
  }, [fires, fireMinConfidence]);

  const filteredVessels = useMemo(() => {
    const q = vesselSearch.trim().toLowerCase();
    if (!q) return vessels;
    return vessels.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        String(v.mmsi).includes(q) ||
        v.callsign.toLowerCase().includes(q) ||
        v.shipType.toLowerCase().includes(q) ||
        v.destination.toLowerCase().includes(q)
    );
  }, [vessels, vesselSearch]);

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
    } else if (target.type === "fire") {
      flyTo(target.data.lon, target.data.lat, 10);
      flash(`Tracking Thermal Anomaly FRP: ${target.data.frpMw.toFixed(1)} MW`);
    } else if (target.type === "vessel") {
      flyTo(target.data.lon, target.data.lat, 10);
      flash(`Tracking Vessel ${target.data.name || target.data.mmsi}`);
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
    } else if (feed === "fires") {
      if (fires.length === 0) {
        notify("No wildfire targets available to snapshot.");
        return;
      }
      const features = fireTargetsToFeatures(fires);
      const layerId = `fires_${Date.now().toString(36)}`;
      addDataset({
        name: `NASA FIRMS Thermal Hotspots (${formatCount(features.length)})`,
        kind: "sample",
        source: "telemetry:firms",
        layers: [
          {
            id: layerId,
            name: "Thermal Hotspots",
            features,
            crs: GEOGRAPHIC_CRS,
            format: "geojson",
            source: "telemetry:firms",
          },
        ],
      });
      notify(`Snapshotted ${formatCount(features.length)} active fires into workspace`);
    } else if (feed === "vessels") {
      if (vessels.length === 0) {
        notify("No maritime vessel targets available to snapshot.");
        return;
      }
      const features = vesselTargetsToFeatures(vessels);
      const layerId = `vessels_${Date.now().toString(36)}`;
      addDataset({
        name: `AIS Maritime Vessels (${formatCount(features.length)})`,
        kind: "sample",
        source: "telemetry:ais",
        layers: [
          {
            id: layerId,
            name: "Vessel AIS Tracking",
            features,
            crs: GEOGRAPHIC_CRS,
            format: "geojson",
            source: "telemetry:ais",
          },
        ],
      });
      notify(`Snapshotted ${formatCount(features.length)} vessels into workspace`);
    }
  };

  const anyLiveActive =
    flightsEnabled ||
    earthquakesEnabled ||
    satellitesEnabled ||
    firesEnabled ||
    vesselsEnabled;

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
      <div className="flex items-center justify-between rounded-[2px] border border-line bg-tint px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            {anyLiveActive && (
              <span
                className={cx(
                  "absolute inline-flex size-full animate-ping rounded-full opacity-75",
                  loading ? "bg-warn" : "bg-ok"
                )}
              />
            )}
            <span
              className={cx(
                "relative inline-flex size-2 rounded-full",
                !anyLiveActive
                  ? "bg-ink-muted"
                  : loading
                    ? "bg-warn"
                    : "bg-ok"
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
            className="rounded-[2px] border border-line bg-shell-2 px-1.5 py-0.5 font-mono text-[9.5px] text-ink focus:outline-none"
            title="Auto-refresh interval"
          >
            <option value={0}>Auto: Off</option>
            <option value={10}>Auto: 10s</option>
            <option value={30}>Auto: 30s</option>
            <option value={60}>Auto: 60s</option>
          </select>
        </div>
      </div>


      {/* TomTom Real-Time Traffic Layer Toggle */}
      <div className="flex items-center justify-between rounded-[2px] border border-line bg-surface px-2.5 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="grid size-6 place-items-center rounded-[2px] bg-tint text-ink">
            <Car size={13} strokeWidth={2} />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="text-[11px] font-semibold text-ink">
              TomTom Live Traffic Flow
            </span>
            <span className="font-mono text-[9px] text-ink-muted">
              Real-time congestion overlay · {providerStatus?.tomtom_traffic ? "API Active" : "Key configured"}
            </span>
          </div>
        </div>
        <Switch
          checked={trafficFlow}
          label="Toggle TomTom live traffic flow layer"
          onChange={() => setTrafficFlow(!trafficFlow)}
        />
      </div>
      {selectedTarget && (
        <div className="relative overflow-hidden rounded-[2px] border border-accent bg-accent-soft p-2.5 text-xs">
          <button
            type="button"
            className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-[2px] text-ink-muted hover:bg-tint hover:text-ink"
            onClick={() => setSelectedTarget(null)}
            title="Close inspection"
          >
            <X size={12} strokeWidth={2} />
          </button>

          {selectedTarget.type === "flight" && (
            <div className="flex flex-col gap-1.5">
              {/* Emergency Transponder Alert Banner */}
              {selectedTarget.data.emergency && (
                <div className="flex items-center gap-1.5 border border-critical/50 bg-critical-20 rounded-[2px] px-2 py-1 text-[9.5px] font-bold text-critical">
                  <AlertTriangle size={12} className="flex-shrink-0" />
                  <span>
                    TRANSPONDER ALERT: {selectedTarget.data.emergency}
                    <span className="ml-1 font-normal text-ink-muted">
                      — acknowledge in the alert queue
                    </span>
                  </span>
                  <button
                    type="button"
                    className="ml-auto rounded-[2px] bg-critical-30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] hover:bg-critical-40"
                    onClick={() => useUiStore.getState().setAlertsOpen(true)}
                  >
                    Alert queue
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-[2px] bg-tint px-1 py-0.5 font-mono text-[9px] font-semibold uppercase text-ink-soft">
                  ADS-B Mode-S
                </span>
                <strong className="font-mono text-[11px] text-ink">
                  {selectedTarget.data.callsign || selectedTarget.data.icao24}
                </strong>
                <span className="font-mono text-[9px] text-ink-subtle">
                  [{selectedTarget.data.icao24.toUpperCase()}]
                </span>
                {selectedTarget.data.squawk && !selectedTarget.data.emergency && (
                  <span className="rounded-[2px] bg-shell-2 border border-line px-1 py-0.5 font-mono text-[8.5px] text-ink-muted">
                    SQK {selectedTarget.data.squawk}
                  </span>
                )}
                {selectedTarget.data.categoryLabel && selectedTarget.data.category !== 0 && (
                  <span className="rounded-[2px] bg-accent-15 px-1 py-0.5 font-mono text-[8.5px] font-medium text-accent">
                    {selectedTarget.data.categoryLabel}
                  </span>
                )}
                <span className="truncate text-[10px] text-ink-muted ml-auto">
                  {selectedTarget.data.originCountry}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 font-mono text-[9.5px]">
                <div className="flex flex-col rounded-[2px] bg-surface p-1">
                  <span className="text-[9.5px] text-ink-subtle">ALTITUDE</span>
                  <span className="font-semibold text-ink">
                    {Math.round(selectedTarget.data.altitudeMeters).toLocaleString()} m
                  </span>
                  <span className="text-[7.5px] text-ink-muted">
                    {Math.round(selectedTarget.data.altitudeMeters * 3.28084).toLocaleString()} ft
                  </span>
                </div>
                <div className="flex flex-col rounded-[2px] bg-surface p-1">
                  <span className="text-[9.5px] text-ink-subtle">GROUND SPEED</span>
                  <span className="font-semibold text-ink">
                    {Math.round(selectedTarget.data.velocityMps * 3.6)} km/h
                  </span>
                  <span className="text-[7.5px] text-ink-muted">
                    {Math.round(selectedTarget.data.velocityMps * 1.94384)} kts
                  </span>
                </div>
                <div className="flex flex-col rounded-[2px] bg-surface p-1">
                  <span className="text-[9.5px] text-ink-subtle">V-SPEED</span>
                  <span
                    className={cx(
                      "font-semibold",
                      (selectedTarget.data.verticalRateFpm ?? 0) > 60
                        ? "text-ok"
                        : (selectedTarget.data.verticalRateFpm ?? 0) < -60
                          ? "text-warn"
                          : "text-ink"
                    )}
                  >
                    {(selectedTarget.data.verticalRateFpm ?? 0) > 0 ? "+" : ""}
                    {selectedTarget.data.verticalRateFpm ?? Math.round(selectedTarget.data.verticalRateMps * 196.85)} fpm
                  </span>
                  <span className="text-[7.5px] text-ink-muted">
                    Track: {Math.round(selectedTarget.data.headingDeg)}°
                  </span>
                </div>
              </div>

              {selectedTarget.data.geoAltitudeMeters != null && (
                <div className="flex items-center justify-between px-1 text-[8.5px] font-mono text-ink-subtle">
                  <span>GNSS Geometric Alt: {Math.round(selectedTarget.data.geoAltitudeMeters).toLocaleString()}m</span>
                  <span>Source: {selectedTarget.data.positionSource === 0 ? "ADS-B" : selectedTarget.data.positionSource === 2 ? "MLAT" : "Direct"}</span>
                </div>
              )}

              {/* Extended Aircraft Particulars & Route (Online Registry) */}
              {extendedLoading && !extendedAircraft && (
                <div className="flex items-center justify-center gap-1.5 rounded-[2px] bg-surface py-2 text-[9px] font-mono text-ink-subtle">
                  <RefreshCw size={11} className="animate-spin text-ink-soft" />
                  <span>Querying HexDB online aircraft registry...</span>
                </div>
              )}

              {extendedAircraft && (
                <div className="flex flex-col gap-1.5 pt-0.5">
                  {/* Real Aircraft Photograph */}
                  {extendedAircraft.imageThumbnailUrl && (
                    <div className="relative overflow-hidden rounded-[2px] border border-line bg-surface h-24 w-full group">
                      <img
                        src={extendedAircraft.imageThumbnailUrl}
                        alt={extendedAircraft.type || "Aircraft photo"}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                      <div className="absolute bottom-1 right-1.5 rounded-[2px] bg-shell px-1 py-0.5 text-[9.5px] font-mono text-ink-soft">
                        {extendedAircraft.registration || selectedTarget.data.icao24}
                      </div>
                    </div>
                  )}

                  {/* Flight Route Banner */}
                  {extendedAircraft.route && (
                    <div className="flex items-center justify-between rounded-[2px] bg-surface p-2 border border-line">
                      <div className="flex flex-col">
                        <span className="font-mono text-xs font-bold text-ink">
                          {extendedAircraft.route.originAirport?.iata || extendedAircraft.route.originAirport?.icao || "ORIGIN"}
                        </span>
                        <span className="text-[9.5px] text-ink-muted truncate max-w-[90px]" title={extendedAircraft.route.originAirport?.name}>
                          {extendedAircraft.route.originAirport?.name || "Departure"}
                        </span>
                      </div>
                      <div className="flex flex-col items-center px-1 text-ink">
                        <Plane size={12} className="rotate-90" />
                        <span className="text-[7.5px] font-mono text-ink-subtle">SCHEDULED ROUTE</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="font-mono text-xs font-bold text-ink">
                          {extendedAircraft.route.destinationAirport?.iata || extendedAircraft.route.destinationAirport?.icao || "DEST"}
                        </span>
                        <span className="text-[9.5px] text-ink-muted truncate max-w-[90px] text-right" title={extendedAircraft.route.destinationAirport?.name}>
                          {extendedAircraft.route.destinationAirport?.name || "Arrival"}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Aircraft Specs Grid */}
                  <div className="rounded-[2px] bg-surface p-2 border border-line space-y-1 text-[9px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-ink-subtle">AIRFRAME:</span>
                      <span className="font-semibold text-ink truncate max-w-[170px]">
                        {extendedAircraft.manufacturer ? `${extendedAircraft.manufacturer} ` : ""}
                        {extendedAircraft.type || extendedAircraft.icaoTypeCode || "Commercial Airliner"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-subtle">TAIL REG:</span>
                      <span className="font-semibold text-ink">
                        {extendedAircraft.registration || "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-subtle">AIRLINE / OWNER:</span>
                      <span className="font-semibold text-ink truncate max-w-[170px]">
                        {extendedAircraft.registeredOwner || selectedTarget.data.originCountry || "—"}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={async () => {
                    const trail = await fetchFlightTrail(selectedTarget.data.icao24);
                    if (trail) {
                      displayFlightTrail(trail);
                    }
                  }}
                  className={cx(SECONDARY_BUTTON, "h-[22px] px-2 text-[9.5px]")}
                  title="Render historical 15-minute breadcrumb flight path"
                >
                  <Activity size={10} strokeWidth={2} className="text-ink-soft" />
                  <span>Show Trail</span>
                </button>
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
                    "rounded-[2px] px-1 py-0.5 font-mono text-[9px] font-bold uppercase",
                    selectedTarget.data.magnitude >= 6.0
                      ? "bg-critical-20 text-critical"
                      : selectedTarget.data.magnitude >= 4.5
                        ? "bg-warn-20 text-warn"
                        : "bg-tint text-ink"
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
                <div className="flex flex-col rounded-[2px] bg-surface p-1">
                  <span className="text-[9.5px] text-ink-subtle">DEPTH</span>
                  <span className="font-semibold text-ink">
                    {selectedTarget.data.depthKm.toFixed(1)} km
                  </span>
                </div>
                <div className="flex flex-col rounded-[2px] bg-surface p-1">
                  <span className="text-[9.5px] text-ink-subtle">SIGNIFICANCE</span>
                  <span className="font-semibold text-ink">
                    {selectedTarget.data.significance}
                  </span>
                </div>
                <div className="flex flex-col rounded-[2px] bg-surface p-1">
                  <span className="text-[9.5px] text-ink-subtle">TSUNAMI RISK</span>
                  <span
                    className={cx(
                      "font-semibold",
                      selectedTarget.data.tsunami ? "text-critical" : "text-ok"
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
                <span className="rounded-[2px] bg-tint px-1 py-0.5 font-mono text-[9px] font-semibold uppercase text-ink-soft">
                  NORAD {selectedTarget.data.noradId}
                </span>
                <strong className="truncate text-[11px] font-semibold text-ink">
                  {selectedTarget.data.name}
                </strong>
              </div>
              <div className="grid grid-cols-3 gap-1.5 font-mono text-[9.5px]">
                <div className="flex flex-col rounded-[2px] bg-surface p-1">
                  <span className="text-[9.5px] text-ink-subtle">ALTITUDE</span>
                  <span className="font-semibold text-ink">
                    {(selectedTarget.data.altitudeKm ?? 0).toFixed(0)} km
                  </span>
                </div>
                <div className="flex flex-col rounded-[2px] bg-surface p-1">
                  <span className="text-[9.5px] text-ink-subtle">VELOCITY</span>
                  <span className="font-semibold text-ink">
                    {Math.round(selectedTarget.data.velocityKmh ?? 0).toLocaleString()} km/h
                  </span>
                </div>
                <div className="flex flex-col rounded-[2px] bg-surface p-1">
                  <span className="text-[9.5px] text-ink-subtle">SUB-SAT POS</span>
                  <span className="font-semibold text-ink">
                    {(selectedTarget.data.latitude ?? 0).toFixed(1)}°, {(selectedTarget.data.longitude ?? 0).toFixed(1)}°
                  </span>
                </div>
              </div>

              {/* Extended Satellite CelesTrak Orbital Parameters */}
              {extendedLoading && !extendedSatellite && (
                <div className="flex items-center justify-center gap-1.5 rounded-[2px] bg-tint py-2 text-[9px] font-mono text-ink-soft">
                  <RefreshCw size={11} className="animate-spin text-ink-soft" />
                  <span>Querying CelesTrak orbital database...</span>
                </div>
              )}

              {extendedSatellite && (
                <div className="rounded-[2px] bg-tint border border-line p-2 space-y-1 text-[9px] font-mono text-ink-soft">
                  <div className="flex justify-between">
                    <span className="text-ink-muted">COSPAR ID:</span>
                    <span className="font-bold">{extendedSatellite.objectId || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">APOGEE / PERIGEE:</span>
                    <span>{extendedSatellite.apogeeKm} km / {extendedSatellite.perigeeKm} km</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">INCLINATION:</span>
                    <span>{extendedSatellite.inclinationDeg.toFixed(2)}°</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">ORBITAL PERIOD:</span>
                    <span>{extendedSatellite.periodMinutes} min</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">TOTAL REVOLUTIONS:</span>
                    <span>{extendedSatellite.revolutions.toLocaleString()} revs</span>
                  </div>
                </div>
              )}

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

          {selectedTarget.type === "fire" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <span className="rounded-[2px] bg-tint px-1 py-0.5 font-mono text-[9px] font-semibold uppercase text-warn">
                  NASA FIRMS ({selectedTarget.data.satellite})
                </span>
                <strong className="truncate text-[11px] font-semibold text-ink">
                  Thermal Hotspot · {selectedTarget.data.confidence}% Conf
                </strong>
              </div>
              <div className="grid grid-cols-3 gap-1.5 font-mono text-[9.5px]">
                <div className="flex flex-col rounded-[2px] bg-surface p-1">
                  <span className="text-[9.5px] text-ink-subtle">FRP POWER</span>
                  <span className="font-semibold text-warn">
                    {selectedTarget.data.frpMw.toFixed(1)} MW
                  </span>
                </div>
                <div className="flex flex-col rounded-[2px] bg-surface p-1">
                  <span className="text-[9.5px] text-ink-subtle">BRIGHTNESS</span>
                  <span className="font-semibold text-ink">
                    {selectedTarget.data.brightnessK.toFixed(1)} K
                  </span>
                </div>
                <div className="flex flex-col rounded-[2px] bg-surface p-1">
                  <span className="text-[9.5px] text-ink-subtle">ACQUISITION</span>
                  <span className="font-semibold text-ink">
                    {selectedTarget.data.acqDate} ({selectedTarget.data.dayNight === "D" ? "Day" : "Night"})
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
                  <span>Fly to hotspot</span>
                </button>
              </div>
            </div>
          )}

          {selectedTarget.type === "vessel" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <span className="rounded-[2px] bg-tint px-1 py-0.5 font-mono text-[9px] font-semibold uppercase text-ink-soft">
                  AIS Vessel
                </span>
                <strong className="truncate text-[11px] font-semibold text-ink">
                  {selectedTarget.data.name}
                </strong>
                <span className="text-[10px] text-ink-muted">
                  ({selectedTarget.data.callsign || selectedTarget.data.status})
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 font-mono text-[9.5px]">
                <div className="flex flex-col rounded-[2px] bg-surface p-1">
                  <span className="text-[9.5px] text-ink-subtle">SPEED</span>
                  <span className="font-semibold text-ink">
                    {selectedTarget.data.speedKnots.toFixed(1)} kts
                  </span>
                </div>
                <div className="flex flex-col rounded-[2px] bg-surface p-1">
                  <span className="text-[9.5px] text-ink-subtle">COURSE</span>
                  <span className="font-semibold text-ink">
                    {Math.round(selectedTarget.data.courseDeg)}°
                  </span>
                </div>
                <div className="flex flex-col rounded-[2px] bg-surface p-1">
                  <span className="text-[9.5px] text-ink-subtle">TYPE</span>
                  <span className="truncate font-semibold text-ink">
                    {selectedTarget.data.shipType}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between text-[9.5px] font-mono rounded-[2px] bg-surface px-2 py-1 border border-line">
                <span className="text-ink-subtle">FLAG STATE:</span>
                <span className="font-semibold text-ink">
                  {resolveVesselFlag(selectedTarget.data.mmsi)}
                </span>
              </div>

              <div className="flex items-center justify-between pt-0.5">
                <span className="truncate font-mono text-[9px] text-ink-muted">
                  MMSI: {selectedTarget.data.mmsi} · Dest: {selectedTarget.data.destination || "Open Sea"}
                </span>
                <button
                  type="button"
                  onClick={() => handleFlyToTarget(selectedTarget)}
                  className={cx(PRIMARY_BUTTON, "h-[22px] px-2 text-[9.5px]")}
                >
                  <Navigation size={10} strokeWidth={2} />
                  <span>Fly to vessel</span>
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
            "rounded-[2px] border transition-colors",
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

            <span className="grid size-[26px] flex-none place-items-center rounded-[2px] border border-line bg-tint text-ink">
              <Plane size={14} strokeWidth={1.8} aria-hidden="true" />
            </span>

            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <strong className="truncate text-[11px] font-semibold text-ink">
                Live Flights (ADS-B)
              </strong>
              <span className="truncate font-mono text-[9px] text-ink-muted">
                OpenSky Network · {formatCount(flights.length)} aircraft · Radar
              </span>
              <FeedProvenance feed="flights" />
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

              {/* OpenSky Adaptive Quota / OAuth Status Banner */}
              {adsbStatus && (
                <div className="flex items-center justify-between rounded-[2px] bg-tint px-2 py-1 font-mono text-[8.5px] text-ink-subtle border border-line">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cx(
                        "size-1.5 rounded-full",
                        adsbStatus.hasOauth ? "bg-ok" : "bg-ink-muted"
                      )}
                    />
                    <span>
                      {adsbStatus.hasOauth
                        ? `OpenSky OAuth · ${adsbStatus.cachedCredits != null ? `${adsbStatus.cachedCredits.toLocaleString()} credits left` : "4,000/day tier"}`
                        : "OpenSky Anonymous (400 credits/day)"}
                    </span>
                  </div>
                  <span>Rate: {(adsbStatus.currentTtlMs / 1000).toFixed(0)}s</span>
                </div>
              )}

              {/* Scrollable Flights Target List */}
              <div className="flex max-h-[180px] flex-col divide-y divide-line overflow-y-auto rounded-[2px] border border-line bg-shell-2">
                {filteredFlights.length === 0 ? (
                  <div className="p-3 text-center text-[10px] text-ink-muted">
                    {flightsEnabled
                      ? "No aircraft matching search."
                      : "Flight radar feed is currently disabled."}
                  </div>
                ) : (
                  filteredFlights.map((flight) => {
                    const isEmg = Boolean(flight.emergency);
                    return (
                      <div
                        key={flight.icao24}
                        onClick={() => setSelectedTarget({ type: "flight", data: flight })}
                        className={cx(
                          "group flex items-center justify-between p-1.5 text-[10px] transition-colors hover:bg-tint cursor-pointer",
                          isEmg && "border-l-2 border-critical/60 bg-critical-20",
                          selectedTarget?.type === "flight" &&
                          selectedTarget.data.icao24 === flight.icao24 &&
                          "bg-accent-soft"
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={cx(
                              "grid size-5 flex-none place-items-center rounded-[2px]",
                              isEmg
                                ? "bg-critical-20 text-critical animate-pulse"
                                : "bg-tint text-ink-soft group-hover:text-accent"
                            )}
                            style={{
                              transform: `rotate(${flight.headingDeg}deg)`,
                              transition: "transform 0.2s ease-out",
                            }}
                            title={`Heading ${Math.round(flight.headingDeg)}°`}
                          >
                            <Plane size={11} strokeWidth={2} />
                          </span>
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="font-mono font-semibold text-ink truncate">
                                {flight.callsign || flight.icao24}
                              </span>
                              {isEmg && (
                                <span className="rounded-[2px] bg-critical-20 px-1 py-0.2 font-mono text-[7.5px] font-bold text-critical">
                                  {flight.emergency}
                                </span>
                              )}
                              {flight.squawk && !isEmg && (
                                <span className="font-mono text-[7.5px] text-ink-subtle">
                                  {flight.squawk}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 text-[8.5px] text-ink-muted truncate">
                              <span className="truncate">{flight.originCountry}</span>
                              {flight.categoryLabel && flight.category !== 0 && (
                                <span className="text-[7.5px] text-ink-subtle">
                                  · {flight.categoryLabel.split(" ")[0]}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 font-mono text-[9px]">
                          <div className="flex flex-col text-right">
                            <span className={cx(isEmg ? "text-critical font-bold" : "text-ink")}>
                              {Math.round(flight.altitudeMeters).toLocaleString()}m
                            </span>
                            <span className="text-[9.5px] text-ink-subtle">
                              {Math.round(flight.velocityMps * 3.6)}km/h
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleFlyToTarget({ type: "flight", data: flight });
                            }}
                            className="rounded-[2px] p-0.5 text-ink-subtle hover:bg-tint hover:text-accent"
                            title="Fly to aircraft"
                          >
                            <ArrowUpRight size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Feed 2: Global Earthquakes */}
        <div
          className={cx(
            "rounded-[2px] border transition-colors",
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

            <span className="grid size-[26px] flex-none place-items-center rounded-[2px] border border-line bg-tint text-ink">
              <Activity size={14} strokeWidth={1.8} aria-hidden="true" />
            </span>

            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <strong className="truncate text-[11px] font-semibold text-ink">
                Global Earthquakes (USGS)
              </strong>
              <span className="truncate font-mono text-[9px] text-ink-muted">
                USGS Real-time · {formatCount(earthquakes.length)} events · M{earthquakeMinMag}+
              </span>
              <FeedProvenance feed="earthquakes" />
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
                        "rounded-[2px] px-1.5 py-0.5 border transition-colors",
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
              <div className="flex max-h-[180px] flex-col divide-y divide-line overflow-y-auto rounded-[2px] border border-line bg-shell-2">
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
                        "bg-accent-soft"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={cx(
                            "grid size-5 flex-none place-items-center rounded-[2px] font-mono font-bold text-[9px]",
                            eq.magnitude >= 6.0
                              ? "bg-critical-20 text-critical"
                              : eq.magnitude >= 4.5
                                ? "bg-warn-20 text-warn"
                                : "bg-tint text-ink"
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
                        className="rounded-[2px] p-0.5 text-ink-subtle hover:bg-tint hover:text-accent"
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
            "rounded-[2px] border transition-colors",
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

            <span className="grid size-[26px] flex-none place-items-center rounded-[2px] border border-line bg-tint text-ink-muted">
              <Satellite size={14} strokeWidth={1.8} aria-hidden="true" />
            </span>

            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <strong className="truncate text-[11px] font-semibold text-ink">
                Orbital Satellites (SGP4)
              </strong>
              <span className="truncate font-mono text-[9px] text-ink-muted">
                CelesTrak SGP4 · {formatCount(satellites.length)} objects · 90m orbits
              </span>
              <FeedProvenance feed="satellites" />
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
              <div className="flex max-h-[180px] flex-col divide-y divide-line overflow-y-auto rounded-[2px] border border-line bg-shell-2">
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
                        "bg-accent-soft"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="grid size-5 flex-none place-items-center rounded-[2px] bg-tint text-ink-muted">
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
                          className="rounded-[2px] p-0.5 text-ink-subtle hover:bg-tint hover:text-accent"
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

        {/* Feed 4: Active Wildfires (NASA FIRMS) */}
        <div
          className={cx(
            "rounded-[2px] border transition-colors",
            firesEnabled
              ? "border-line-strong bg-raised"
              : "border-line bg-tint opacity-80"
          )}
        >
          <div className="flex items-center gap-2 p-2">
            <button
              type="button"
              className={ICON_BUTTON}
              aria-label={
                expandedFeed === "fires" ? "Collapse fires" : "Expand fires"
              }
              onClick={() =>
                setExpandedFeed(expandedFeed === "fires" ? null : "fires")
              }
            >
              {expandedFeed === "fires" ? (
                <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
              ) : (
                <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
              )}
            </button>

            <span className="grid size-[26px] flex-none place-items-center rounded-[2px] border border-line bg-tint text-warn">
              <Flame size={14} strokeWidth={1.8} aria-hidden="true" />
            </span>

            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <strong className="truncate text-[11px] font-semibold text-ink">
                Active Wildfires (NASA FIRMS)
              </strong>
              <span className="truncate font-mono text-[9px] text-ink-muted">
                VIIRS/MODIS NRT · {formatCount(fires.length)} hotspots · Near Real-Time
              </span>
              <FeedProvenance feed="fires" />
            </span>

            <Switch
              checked={firesEnabled}
              label="Toggle active wildfires feed"
              onChange={() => toggleFeed("fires")}
            />
          </div>

          {expandedFeed === "fires" && (
            <div className="flex flex-col gap-2 border-t border-line p-2">
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-1.5 font-mono text-[9.5px] text-ink-muted">
                  <span className="text-[9px] uppercase tracking-wider text-ink-subtle">
                    Min Conf:
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={fireMinConfidence}
                    onChange={(e) => setFireMinConfidence(Number(e.target.value))}
                    className="h-1 flex-1 accent-warn"
                  />
                  <span className="w-8 text-right font-semibold text-warn">
                    {fireMinConfidence}%
                  </span>
                </div>

                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  title="Snapshot current thermal anomalies into workspace layers"
                  onClick={() => snapshotFeed("fires")}
                >
                  <Layers size={11} strokeWidth={2} />
                  <span>Snapshot</span>
                </button>
              </div>

              {/* Scrollable Wildfire Hotspots List */}
              <div className="flex max-h-[180px] flex-col divide-y divide-line overflow-y-auto rounded-[2px] border border-line bg-shell-2">
                {filteredFires.length === 0 ? (
                  <div className="p-3 text-center text-[10px] text-ink-muted">
                    {firesEnabled
                      ? "No thermal hotspots matching confidence threshold."
                      : "Wildfire feed is currently disabled."}
                  </div>
                ) : (
                  filteredFires.map((fire) => (
                    <div
                      key={fire.id}
                      onClick={() => setSelectedTarget({ type: "fire", data: fire })}
                      className={cx(
                        "group flex items-center justify-between p-1.5 text-[10px] transition-colors hover:bg-tint cursor-pointer",
                        selectedTarget?.type === "fire" &&
                        selectedTarget.data.id === fire.id &&
                        "bg-accent-soft"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="grid size-5 flex-none place-items-center rounded-[2px] bg-tint text-ink-soft">
                          <Flame size={11} strokeWidth={2} />
                        </span>
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium text-ink truncate max-w-[170px]">
                            Thermal Hotspot ({fire.satellite})
                          </span>
                          <span className="font-mono text-[8.5px] text-ink-muted">
                            FRP: {fire.frpMw.toFixed(1)} MW · {fire.confidence}% Conf · {fire.acqDate}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 font-mono text-[9px]">
                        <span className="text-warn font-semibold">
                          {fire.brightnessK.toFixed(0)} K
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFlyToTarget({ type: "fire", data: fire });
                          }}
                          className="rounded-[2px] p-0.5 text-ink-subtle hover:bg-tint hover:text-accent"
                          title="Fly to thermal hotspot"
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

        {/* Feed 5: Maritime Vessels (AIS) */}
        <div
          className={cx(
            "rounded-[2px] border transition-colors",
            vesselsEnabled
              ? "border-line-strong bg-raised"
              : "border-line bg-tint opacity-80"
          )}
        >
          <div className="flex items-center gap-2 p-2">
            <button
              type="button"
              className={ICON_BUTTON}
              aria-label={
                expandedFeed === "vessels" ? "Collapse vessels" : "Expand vessels"
              }
              onClick={() =>
                setExpandedFeed(expandedFeed === "vessels" ? null : "vessels")
              }
            >
              {expandedFeed === "vessels" ? (
                <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
              ) : (
                <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
              )}
            </button>

            <span className="grid size-[26px] flex-none place-items-center rounded-[2px] border border-line bg-tint text-ink">
              <Ship size={14} strokeWidth={1.8} aria-hidden="true" />
            </span>

            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <strong className="truncate text-[11px] font-semibold text-ink">
                Maritime Vessels (AIS)
              </strong>
              <span className="truncate font-mono text-[9px] text-ink-muted">
                AISStream Real-Time · {formatCount(vessels.length)} ships tracked
              </span>
              <FeedProvenance feed="vessels" />
            </span>

            <Switch
              checked={vesselsEnabled}
              label="Toggle maritime vessels feed"
              onChange={() => toggleFeed("vessels")}
            />
          </div>

          {expandedFeed === "vessels" && (
            <div className="flex flex-col gap-2 border-t border-line p-2">
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1.5 size-3 text-ink-muted" />
                  <input
                    type="text"
                    placeholder="Search vessel name, MMSI, type..."
                    value={vesselSearch}
                    onChange={(e) => setVesselSearch(e.target.value)}
                    className={cx(FIELD_INPUT, "h-[24px] pl-6 text-[10px]")}
                  />
                  {vesselSearch && (
                    <button
                      type="button"
                      onClick={() => setVesselSearch("")}
                      className="absolute right-2 top-1.5 text-ink-subtle hover:text-ink"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => snapshotFeed("vessels")}
                  className={SECONDARY_BUTTON}
                  title="Snapshot current vessels into workspace layers"
                >
                  <Layers size={11} strokeWidth={2} />
                  <span>Snapshot</span>
                </button>
              </div>

              {/* Scrollable Vessels Target List */}
              <div className="flex max-h-[180px] flex-col divide-y divide-line overflow-y-auto rounded-[2px] border border-line bg-shell-2">
                {filteredVessels.length === 0 ? (
                  <div className="p-3 text-center text-[10px] text-ink-muted">
                    {vesselsEnabled
                      ? "No vessels matching search query."
                      : "Maritime vessel feed is currently disabled."}
                  </div>
                ) : (
                  filteredVessels.map((vessel) => (
                    <div
                      key={vessel.mmsi}
                      onClick={() => setSelectedTarget({ type: "vessel", data: vessel })}
                      className={cx(
                        "group flex items-center justify-between p-1.5 text-[10px] transition-colors hover:bg-tint cursor-pointer",
                        selectedTarget?.type === "vessel" &&
                        selectedTarget.data.mmsi === vessel.mmsi &&
                        "bg-accent-soft"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="grid size-5 flex-none place-items-center rounded-[2px] bg-tint text-ink-soft">
                          <Ship size={11} strokeWidth={2} />
                        </span>
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium text-ink truncate max-w-[170px]">
                            {vessel.name} ({vessel.callsign || vessel.status})
                          </span>
                          <span className="font-mono text-[8.5px] text-ink-muted truncate max-w-[170px]">
                            {vessel.shipType} · MMSI {vessel.mmsi} · {vessel.destination}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 font-mono text-[9px]">
                        <span className="text-ink font-semibold">
                          {vessel.speedKnots.toFixed(1)} kts
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFlyToTarget({ type: "vessel", data: vessel });
                          }}
                          className="rounded-[2px] p-0.5 text-ink-subtle hover:bg-tint hover:text-accent"
                          title="Fly to vessel"
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
