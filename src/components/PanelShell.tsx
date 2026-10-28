import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "../lib/cx";

interface PanelShellProps {
  title: string;
  eyebrow: string;
  side?: "left" | "right";
  /** Wide panels are used for tabular content that needs columns. */
  wide?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  onClose: () => void;
}

export function PanelShell({
  title,
  eyebrow,
  side = "left",
  wide = false,
  footer,
  children,
  onClose,
}: PanelShellProps) {
  const titleId = useId();

  return (
    <section
      className={cx(
        "glass pointer-events-auto absolute z-30 flex flex-col overflow-hidden rounded-xl border border-line shadow-panel",
        side === "left"
          ? "bottom-[calc(var(--footer-h)+8px)] left-14 top-16 animate-panel-left compact:top-2.5 short:top-2.5"
          : "bottom-[calc(var(--footer-h)+8px)] right-14 top-2.5 animate-panel-right",
        wide
          ? "w-[min(560px,calc(100vw-112px))]"
          : side === "left"
            ? "w-[296px] compact:w-[calc(100vw-112px)]"
            : "w-[300px] compact:w-[calc(100vw-112px)]",
      )}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
    >
      <header className="flex flex-none items-center justify-between gap-2.5 border-b border-line px-3 pb-2.5 pl-3.5 pt-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-accent">
            {eyebrow}
          </span>
          <h2
            id={titleId}
            className="m-0 text-sm font-semibold tracking-[-0.015em]"
          >
            {title}
          </h2>
        </div>
        <button
          type="button"
          className="grid size-6 flex-none place-items-center rounded-md text-ink-muted transition-colors hover:bg-tint hover:text-ink"
          onClick={onClose}
          aria-label={`Close ${title}`}
        >
          <X size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </header>

      <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-3.5 pb-3.5 pt-3">
        {children}
      </div>

      {footer ? (
        <footer className="flex flex-none items-center justify-between gap-2.5 border-t border-line px-3.5 py-2 font-mono text-[8.5px] uppercase tracking-[0.06em] text-ink-muted">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
