import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "../lib/cx";

interface PanelShellProps {
  title: string;
  eyebrow: string;
  side?: "left" | "right" | "bottom";
  /** Wide panels are used for tabular content that needs columns. */
  wide?: boolean;
  className?: string;
  bodyClassName?: string;
  headerControls?: ReactNode;
  headerTrailing?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  onClose: () => void;
}

export function PanelShell({
  title,
  eyebrow,
  side = "left",
  wide = false,
  className,
  bodyClassName,
  headerControls,
  headerTrailing,
  footer,
  children,
  onClose,
}: PanelShellProps) {
  const titleId = useId();

  return (
    <section
      className={cx(
        "pointer-events-auto absolute z-30 flex flex-col overflow-hidden border border-line bg-solid",
        side === "bottom"
          ? "bottom-[calc(var(--footer-h)+var(--timeline-h)+6px)] left-2 right-2 h-[min(480px,46vh)] animate-panel-bottom"
          : side === "left"
            ? "bottom-[calc(var(--footer-h)+8px)] left-2 top-[calc(var(--commandbar-h)+6px)] animate-panel-left short:top-[calc(var(--commandbar-h)+4px)]"
            : "bottom-[calc(var(--footer-h)+8px)] right-2 top-[calc(var(--commandbar-h)+6px)] animate-panel-right",
        side === "bottom"
          ? ""
          : wide
            ? "w-[min(640px,calc(100vw-24px))]"
            : side === "left"
              ? "w-[min(296px,calc(100vw-24px))]"
              : "w-[min(300px,calc(100vw-24px))]",
        className,
      )}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
    >
      <header className="flex flex-none items-center justify-between gap-2.5 border-b border-line px-3 pb-2.5 pl-3.5 pt-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-[7.5px] uppercase tracking-[0.2em] text-ink-muted">
              {eyebrow}
            </span>
            <h2
              id={titleId}
              className="m-0 truncate font-mono text-[11px] font-semibold uppercase tracking-[0.08em]"
            >
              {title}
            </h2>
          </div>
          {headerControls ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {headerControls}
            </div>
          ) : null}
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {headerTrailing}
          <button
            type="button"
            className="grid size-6 flex-none place-items-center rounded-[2px] text-ink-muted transition-colors hover:bg-tint hover:text-ink"
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            <X size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        className={cx(
          "panel-scroll min-h-0 flex-1 px-3.5 pb-3.5 pt-3",
          bodyClassName ?? "overflow-y-auto",
        )}
      >
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
