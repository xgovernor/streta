import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useTelemetryStore } from "../../state/telemetryStore";
import { useUiStore } from "../../state/uiStore";

const WINDOW_MS = 15 * 60 * 1000;

function formatUtc(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19) + "Z";
}

function formatAge(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s back`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s back`;
  return `${Math.floor(min / 60)}h ${min % 60}m back`;
}

/**
 * Bottom-dock timeline. Scrubbing sets `asOf`: the map replays recorded ADS-B
 * and AIS fixes interpolated onto the scrubbed instant, and filters earthquake
 * / fire events by occurrence time. It never re-queries a feed — the past
 * shown here is exactly the history this client recorded.
 */
export function TimeDock() {
  const asOf = useTelemetryStore((state) => state.asOf);
  const setAsOf = useTelemetryStore((state) => state.setAsOf);
  const lastUpdated = useTelemetryStore((state) => state.lastUpdated);
  const displayedFlights = useTelemetryStore((state) => state.displayedFlights);
  const displayedVessels = useTelemetryStore((state) => state.displayedVessels);
  const flights = useTelemetryStore((state) => state.flights);
  const vessels = useTelemetryStore((state) => state.vessels);
  const setTimelineOpen = useUiStore((state) => state.setTimelineOpen);

  /** Window end stays fixed between mounts; `now` would run away under the thumb. */
  const [windowEnd, setWindowEnd] = useState<number>(() =>
    lastUpdated?.getTime() ?? Date.now(),
  );

  useEffect(() => {
    // The window grows when fresh data arrives, with the scrub position kept.
    setWindowEnd((prev) => Math.max(prev, lastUpdated?.getTime() ?? 0));
  }, [lastUpdated]);

  const windowStart = windowEnd - WINDOW_MS;
  const live = asOf === null;
  const value = asOf ?? windowEnd;

  const replayed = displayedFlights?.length ?? 0;
  const replayedVessels = displayedVessels?.length ?? 0;
  const liveCount = flights.length;
  const liveVesselCount = vessels.length;

  return (
    <section
      className="pointer-events-auto absolute inset-x-0 bottom-[var(--footer-h)] z-[26] flex h-[var(--timeline-h)] max-h-[38vh] flex-col gap-1 border-t border-line bg-solid px-3 pb-2 pt-1.5"
      aria-label="Timeline — signal replay"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-accent">
          Signal replay
        </span>
        <span className="min-w-0 truncate font-mono text-[10.5px] text-ink-soft">
          {live
            ? "Live telemetry (null as-of)"
            : `As of ${formatUtc(value)} · ${formatAge(windowEnd - value)}`}
        </span>

        <span className="flex-1" />

        <span className="font-mono text-[9.5px] text-ink-muted">
          {live
            ? `${liveCount} aircraft · ${liveVesselCount} vessels live`
            : `${replayed} aircraft · ${replayedVessels} vessels replayed`}
        </span>

        {live ? (
          <span
            className="grid h-[22px] place-items-center rounded-[2px] border border-line px-2 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ok"
            title="Scrub to replay recorded positions"
          >
            Live
          </span>
        ) : (
          <button
            type="button"
            className="h-[22px] rounded-[2px] border border-line bg-tint px-2 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
            onClick={() => setAsOf(null)}
            title="Return to live telemetry"
          >
            Return to live
          </button>
        )}

        <button
          type="button"
          className="grid h-[22px] w-[22px] place-items-center rounded-[2px] text-ink-muted transition-colors hover:bg-tint hover:text-ink"
          onClick={() => setTimelineOpen(false)}
          aria-label="Close timeline"
        >
          <X size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      <label className="mt-1 flex min-h-[30px] items-center gap-2">
        <span className="w-[72px] flex-none font-mono text-[9px] text-ink-muted">
          {formatUtc(windowStart)}
        </span>
        <input
          type="range"
          className="opacity-range w-full flex-1"
          min={windowStart}
          max={windowEnd}
          step={250}
          value={value}
          disabled={replayed === 0 && replayedVessels === 0 && liveCount === 0 && liveVesselCount === 0}
          onChange={(event) => {
            const next = Number(event.target.value);
            // Full-forward equals live.
            setAsOf(next >= windowEnd - 250 ? null : next);
          }}
          aria-label="Replay position as of"
          aria-valuetext={live ? "live" : formatUtc(value)}
        />
        <span className="w-[120px] flex-none text-right font-mono text-[9px] text-ink-muted">
          {formatUtc(windowEnd)} · now
        </span>
      </label>

      <span className="min-w-0 truncate text-[9.5px] text-ink-muted">
        Replay covers ADS-B and AIS positions this client recorded this session
        (15-minute window; AIS fixes are stamped at receipt, not by the
        transponder). Seismic and fire layers are filtered by event time;
        orbital tracks are propagated live and stay current.
      </span>
    </section>
  );
}
