import { useEffect, useState } from "react";
import { AlertTriangle, History, X } from "lucide-react";
import { crsName, GEOGRAPHIC_CRS, transformPosition, VIEW_CRS } from "../lib/gis/crs";
import { formatMGRS } from "../lib/gis/mgrs";
import { clearMeasurement } from "../map/mapController";
import { cx } from "../lib/cx";
import {
  formatArea,
  formatDistance,
  formatLat,
  formatLon,
  formatProjected,
  niceDistance,
} from "../lib/format";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";
import {
  FEED_LABELS,
  useTelemetryStore,
  type TelemetryFeedType,
} from "../state/telemetryStore";
import { useUiStore } from "../state/uiStore";

const ITEM = "flex h-full shrink-0 items-center gap-1.5 px-2.5";
const LABEL = "text-[8px] uppercase tracking-[0.12em] text-ink-muted";
const VALUE = "text-ink [font-variant-numeric:tabular-nums]";

const ALL_FEEDS: TelemetryFeedType[] = [
  "flights",
  "earthquakes",
  "satellites",
  "vessels",
  "fires",
];

const FEED_SHORT: Record<TelemetryFeedType, string> = {
  flights: "ADSB",
  earthquakes: "QAKE",
  satellites: "SAT",
  vessels: "AIS",
  fires: "FIRE",
};

export function StatusBar() {
  const camera = useMapStore((state) => state.camera);
  const pointer = useMapStore((state) => state.pointer);
  const hoverLabel = useMapStore((state) => state.hoverLabel);
  const coordFormat = useUiStore((state) => state.coordFormat);
  const setAlertsOpen = useUiStore((state) => state.setAlertsOpen);
  const toggleTimeline = useUiStore((state) => state.toggleTimeline);
  const measureMode = useProjectStore((state) => state.measureMode);
  const measureSummary = useProjectStore((state) => state.measureSummary);
  const selection = useProjectStore((state) => state.selection);

  const autoRefreshSeconds = useTelemetryStore((state) => state.autoRefreshSeconds);
  const loading = useTelemetryStore((state) => state.loading);
  const asOf = useTelemetryStore((state) => state.asOf);
  const feedStatus = useTelemetryStore((state) => state.feedStatus);
  const openAlerts = useTelemetryStore((state) => state.openAlerts);
  const anyFeedEnabled = useTelemetryStore(
    (state) =>
      state.flightsEnabled ||
      state.earthquakesEnabled ||
      state.satellitesEnabled ||
      state.firesEnabled ||
      state.vesselsEnabled,
  );

  /** One 1s tick drives the UTC clock and the data-age readouts. */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const lat = pointer?.lat ?? camera.lat;
  const lon = pointer?.lon ?? camera.lon;
  const [viewX, viewY] = transformPosition([lon, lat], GEOGRAPHIC_CRS, VIEW_CRS);

  const metersPerPixel = Math.abs(camera.resolution) || 1;
  const scaleDistance = niceDistance(metersPerPixel * 76);
  const scaleWidth = Math.min(128, Math.max(30, scaleDistance / metersPerPixel));
  const grid = lat > -80 && lat < 84 ? formatMGRS(lon, lat, 2) : null;

  const maxAgeMs = Math.max(autoRefreshSeconds * 1500, 45_000);

  return (
    <footer
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-[25] flex h-[var(--footer-h)] items-stretch overflow-hidden border-t border-line bg-solid font-mono text-[9.5px] tracking-[0.02em] text-ink-soft"
      aria-label="Map status"
    >
      {/* Truthful clock: mission time is UTC, always. */}
      {/* <span className={cx(ITEM, "gap-2")} title="Current UTC time">
        <span className="text-ink [font-variant-numeric:tabular-nums]">
          {new Date(nowMs).toISOString().slice(11, 19)}Z
        </span>
      </span> */}

      {/* Grid reference of the cursor (or center when pointer off-map). */}
      {grid ? (
        <span
          className={cx(ITEM, "gap-2")}
          title={`MGRS (2-digit precision) at ${pointer ? "cursor" : "map center"}`}
        >
          <span className={LABEL}>MGRS</span>
          <span className={VALUE}>{grid}</span>
        </span>
      ) : null}

      <span
        className={cx(ITEM, "gap-2")}
        title={`${pointer ? "Cursor" : "Map center"} in ${coordFormat} coordinates`}
      >
        <span className={LABEL}>{pointer ? "Cursor" : "Center"}</span>
        {coordFormat === "projected" ? (
          <>
            <span className={VALUE}>
              X {formatProjected(viewX)}
            </span>
            <span className={VALUE}>
              Y {formatProjected(viewY)}
            </span>
            <span className="text-ink-muted">m</span>
          </>
        ) : (
          <>
            <span className={VALUE}>{formatLat(lat, coordFormat)}</span>
            <span className={VALUE}>{formatLon(lon, coordFormat)}</span>
          </>
        )}
      </span>

      {selection ? (
        <span className={cx(ITEM, "gap-2")} title="Selected feature">
          <span className={LABEL}>Sel</span>
          <span className={VALUE}>1</span>
        </span>
      ) : null}

      {hoverLabel ? (
        <span className={cx(ITEM, "gap-2 wide:hidden")} title="Feature under the cursor">
          <span className={LABEL}>Under cursor</span>
          <span className="max-w-[220px] truncate text-ink">{hoverLabel}</span>
        </span>
      ) : null}

      {measureSummary || measureMode !== "off" ? (
        <span
          className={cx(
            ITEM,
            "gap-2",
            measureMode !== "off" ? "text-accent" : "text-ink-soft",
          )}
          title={
            measureMode !== "off"
              ? measureMode === "area"
                ? "Polygon area tool active — click map to plot ring, double-click to close"
                : "Distance tool active — click map to measure, right-click line for options"
              : "Measurements on map — click M / A to add more, right-click shape for options"
          }
        >
          <span className={LABEL}>
            {measureSummary?.mode === "area" || measureMode === "area" ? "Area" : "Measure"}
            {measureSummary?.lineCount && measureSummary.lineCount > 1
              ? ` (${measureSummary.lineCount} ${measureSummary.mode === "area" ? "polygons" : "lines"})`
              : ""}
          </span>
          {measureSummary ? (
            <>
              {measureSummary.mode === "area" ? (
                <>
                  <span className="[font-variant-numeric:tabular-nums] font-semibold">
                    {formatArea(measureSummary.area)}
                  </span>
                  <span className="text-ink-muted text-[10px]">
                    (Perim: {formatDistance(measureSummary.distance)})
                  </span>
                </>
              ) : (
                <span className="[font-variant-numeric:tabular-nums]">
                  {formatDistance(measureSummary.distance)}
                </span>
              )}
              <button
                type="button"
                className="ml-0.5 inline-flex size-3.5 items-center justify-center rounded-[2px] text-ink-muted hover:bg-tint hover:text-ink transition-colors cursor-pointer"
                title="Clear all measurements"
                onClick={(e) => {
                  e.stopPropagation();
                  clearMeasurement();
                }}
              >
                <X size={10} strokeWidth={2.2} />
              </button>
            </>
          ) : (
            <span className="text-accent/80 animate-pulse text-[10.5px]">
              {measureMode === "area"
                ? "Click map to plot polygon (double-click to close)"
                : "Click map to measure"}
            </span>
          )}
        </span>
      ) : null}

      {/* Replay mode badge: scrubbed picture, not live. */}
      {asOf !== null && (
        <button
          type="button"
          className={cx(ITEM, "gap-1.5 bg-accent-soft text-accent")}
          title="Map is replaying recorded positions — open the timeline"
          onClick={toggleTimeline}
        >
          <History size={11} strokeWidth={2} aria-hidden="true" />
          <span className="font-bold uppercase tracking-[0.08em]">
            Replay {new Date(asOf).toISOString().slice(11, 19)}Z
          </span>
        </button>
      )}

      <span className="flex-1" />

      {/* Per-feed data age — the truth the old pulsing "Live" dot hid. */}
      {anyFeedEnabled ? (
        <span
          className={cx(ITEM, "gap-[7px]")}
          title="Time since each enabled feed last returned data"
        >
          <span className={LABEL}>Feed age</span>
          {ALL_FEEDS.filter((feed) => feedStatus[feed].lastOk !== null).map(
            (feed) => {
              const status = feedStatus[feed];
              const lastOk = status.lastOk;
              const ageMs = lastOk !== null ? nowMs - lastOk : null;
              const ageSec = ageMs !== null ? Math.max(0, Math.round(ageMs / 1000)) : null;
              const stale = ageMs !== null && ageMs > maxAgeMs;
              const ageText = ageMs !== null ? formatAgeText(ageMs) : "—";
              return (
                <span
                  key={feed}
                  className={cx(
                    feedAgeClass(stale),
                    status.lastError && "underline decoration-critical underline-offset-2",
                  )}
                  title={`${FEED_LABELS[feed]} (${FEED_SHORT[feed]}) — ${status.lastError
                      ? `last fetch failed: ${status.lastError}`
                      : ageSec !== null
                        ? `age ${ageSec}s · ${status.count} targets`
                        : "no data yet"
                    }`}
                >
                  {FEED_SHORT[feed]}{" "}
                  <span className="[font-variant-numeric:tabular-nums]">
                    {ageText}
                  </span>
                </span>
              );
            },
          )}
          {loading && <span className="text-warn">syncing…</span>}
        </span>
      ) : (
        <span className={cx(ITEM)} title="No telemetry feeds enabled">
          <span className="text-ink-muted">feeds paused</span>
        </span>
      )}

      {/* Alert count — opens the queue. Non-zero means an operator decision is waiting. */}
      <button
        type="button"
        className={cx(
          ITEM,
          "gap-1.5 pr-3",
          openAlerts > 0 ? "text-warn hover:text-ink" : "text-ink-muted",
        )}
        title={openAlerts ? `${openAlerts} open alert${openAlerts === 1 ? "" : "s"} — open queue` : "No open alerts"}
        onClick={() => setAlertsOpen(true)}
      >
        {openAlerts > 0 && <AlertTriangle size={11} strokeWidth={2} aria-hidden="true" />}
        <span className="font-bold uppercase tracking-[0.08em]">
          Alerts {openAlerts}
        </span>
      </button>

      {/* Scale bar kept; zoom/rotation/scale-denominator/EPSG moved out of the
          constant strip because GIS internals answer no operator question. */}
      <span
        className={cx(ITEM, "gap-[7px]")}
        title={`${crsName(VIEW_CRS)} · scale ${scaleDistance}`}
      >
        <span
          className="block h-[7px] shrink-0 border-b border-l border-r border-ink-muted opacity-80"
          style={{ width: `${scaleWidth}px` }}
        />
        <span className="text-[8.5px] text-ink-soft compact:hidden">
          {formatDistance(scaleDistance)}
        </span>
      </span>
    </footer>
  );
}

function feedAgeClass(stale: boolean): string {
  return stale ? "text-warn" : "text-ink-soft";
}

function formatAgeText(ageMs: number): string {
  const sec = Math.max(0, Math.round(ageMs / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 100) return `${min}m`;
  return "—";
}
