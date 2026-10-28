import { cx } from "../lib/cx";

export type StatusTone = "online" | "degraded" | "offline";
export type FeatureStatus = StatusTone | "active" | "planned";

const TONES: Record<StatusTone, string> = {
  online: "bg-accent shadow-[0_0_0_3px_var(--accent-soft)]",
  degraded: "bg-warn shadow-[0_0_0_3px_rgba(255,200,87,0.12)]",
  offline: "bg-off opacity-65",
};

export function dotTone(status: FeatureStatus): StatusTone {
  if (status === "active") {
    return "online";
  }

  if (status === "planned") {
    return "degraded";
  }

  return status;
}

export function StatusDot({
  tone,
  className,
}: {
  tone: StatusTone;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "size-[5px] shrink-0 rounded-full",
        TONES[tone],
        className,
      )}
    />
  );
}
