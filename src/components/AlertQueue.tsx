import { useMemo } from "react";
import { BellRing, CheckCheck, Crosshair, X } from "lucide-react";
import { cx } from "../lib/cx";
import { flyTo } from "../map/mapController";
import { useTelemetryStore, type TelemetryAlert } from "../state/telemetryStore";
import { useUiStore } from "../state/uiStore";

function formatRaised(ms: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ${min % 60}m ago`;
}

/**
 * The acknowledgeable alert queue. Emergencies raised by live feeds stay on
 * this list until an operator acknowledges them — they cannot silently scroll
 * away in a feed card again.
 */
export function AlertQueue() {
  const alertsOpen = useUiStore((state) => state.alertsOpen);
  const setAlertsOpen = useUiStore((state) => state.setAlertsOpen);
  const openPanel = useUiStore((state) => state.openPanel);
  const rightPanel = useUiStore((state) => state.rightPanel);
  const flash = useUiStore((state) => state.flash);
  const alerts = useTelemetryStore((state) => state.alerts);
  const acknowledgeAlert = useTelemetryStore((state) => state.acknowledgeAlert);
  const acknowledgeAllAlerts = useTelemetryStore((state) => state.acknowledgeAllAlerts);

  const openCount = useMemo(
    () => alerts.filter((alert) => !alert.acknowledged).length,
    [alerts],
  );

  if (!alertsOpen) {
    return null;
  }

  const locate = (alert: TelemetryAlert) => {
    const { data, type } = alert.target;
    if (type === "flight") {
      flyTo(data.longitude, data.latitude, 9);
      useTelemetryStore.getState().setSelectedTarget(alert.target);
      openPanel("telemetry");
      return;
    }
    if (type === "fire") {
      flyTo(data.lon, data.lat, 9);
      useTelemetryStore.getState().setSelectedTarget(alert.target);
      openPanel("telemetry");
    }
  };

  return (
    <section
      className={cx(
        "pointer-events-auto absolute top-[calc(var(--commandbar-h)+6px)] z-[30] flex max-h-[46vh] w-[min(344px,calc(100vw-16px))] flex-col overflow-hidden border border-line bg-solid shadow-panel transition-[right] duration-200 ease-out",
        rightPanel ? "right-[calc(var(--ribbon-w)+300px+12px)]" : "right-[calc(var(--ribbon-w)+12px)]"
      )}
      style={{ bottom: "calc(var(--footer-h) + var(--timeline-h) + 8px)" }}
      aria-label="Alert queue"
    >        <header className="flex flex-none items-center gap-2 border-b border-line px-3 py-2">
        <BellRing size={13} strokeWidth={2} className="text-warn" aria-hidden="true" />
        <h2 className="m-0 flex-1 truncate text-sm font-semibold">Alerts</h2>
        <span
          className={cx(
            "rounded-[2px] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase",
            openCount > 0 ? "bg-warn-20 text-warn border border-warn/40" : "bg-tint text-ink-muted",
          )}
        >
          {openCount} open
        </span>
        {openCount > 0 && (
          <button
            type="button"
            className="grid h-[24px] w-[24px] place-items-center rounded-[2px] text-ink-muted transition-colors hover:bg-tint hover:text-ink"
            onClick={acknowledgeAllAlerts}
            title="Acknowledge all alerts"
            aria-label="Acknowledge all alerts"
          >
            <CheckCheck size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="grid h-[24px] w-[24px] place-items-center rounded-[2px] text-ink-muted transition-colors hover:bg-tint hover:text-ink"
          onClick={() => setAlertsOpen(false)}
          aria-label="Close alert queue"
        >
          <X size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </header>

      <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="px-3 py-8 text-center text-[11px] text-ink-muted">
            No alerts.
            <span className="mt-1 block text-[10px] text-ink-muted">
              Emergency transponders, tsunami-flagged and M6+ seismic events appear here.
            </span>
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className={cx(
                  "relative overflow-hidden border-b border-line p-2 transition-all duration-50 ease-out hover:border-l-4",
                  alert.acknowledged
                    ? "border-line bg-solid opacity-65"
                    : "border-line-strong bg-solid",
                )}
              >
                <div className="flex min-w-0 items-start gap-2">
                  <span
                    aria-hidden="true"
                    className={cx(
                      "flex-none rounded-[2px] px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em]",
                      alert.severity === "critical"
                        ? "bg-critical-20 text-critical border border-critical/40"
                        : "bg-warn-20 text-warn border border-warn/40",
                    )}
                  >
                    {alert.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-ink">
                        {alert.title}
                      </span>
                      <span className="flex-none font-mono text-[9px] text-ink-muted">
                        {formatRaised(alert.raisedAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 mb-2 truncate text-[10.5px] text-ink-soft">
                      {alert.detail}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="inline-flex h-[22px] items-center gap-1 rounded-[2px] border border-line bg-tint px-2 text-[10px] font-semibold text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
                        onClick={() => locate(alert)}
                      >
                        <Crosshair size={10} strokeWidth={2} aria-hidden="true" />
                        Locate
                      </button>
                      {alert.acknowledged ? (
                        <span className="font-mono text-[9px] text-ink-muted">Acknowledged</span>
                      ) : (
                        <button
                          type="button"
                          className="inline-flex h-[22px] items-center gap-1 rounded-[2px] border border-accent-soft bg-accent-soft px-2 text-[10px] font-semibold text-accent"
                          onClick={() => {
                            acknowledgeAlert(alert.id);
                            flash(`Alert acknowledged: ${alert.title}`);
                          }}
                        >
                          <CheckCheck size={10} strokeWidth={2} aria-hidden="true" />
                          Acknowledge
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
