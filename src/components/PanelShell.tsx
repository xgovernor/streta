import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "../lib/cx";
import { useUiStore } from "../state/uiStore";

interface PanelShellProps {
  title: string;
  eyebrow?: string;
  side?: "left" | "right" | "bottom";
  /** Wide panels are used for tabular content that needs columns. */
  wide?: boolean;
  /** Fit panel height dynamically to contents up to max available viewport height */
  autoHeight?: boolean;
  /** Zero-padding body for flush Carbon-style layouts */
  flush?: boolean;
  /** Smooth expandable panel width for detailed dossier / edit views */
  expanded?: boolean;
  className?: string;
  bodyClassName?: string;
  headerLeading?: ReactNode;
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
  autoHeight = false,
  flush = false,
  expanded = false,
  className,
  bodyClassName,
  headerLeading,
  headerControls,
  headerTrailing,
  footer,
  children,
  onClose,
}: PanelShellProps) {
  const titleId = useId();
  const leftPanel = useUiStore((state) => state.leftPanel);
  const rightPanel = useUiStore((state) => state.rightPanel);
  const tableMaximized = useUiStore((state) => state.tableMaximized);

  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startHeight = useUiStore.getState().tableHeight;
    const footerH = 26;
    const timelineH = useUiStore.getState().timelineOpen ? 128 : 0;
    const commandbarH = 40;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const minH = 140;
      const maxH = window.innerHeight - commandbarH - footerH - timelineH - 20;
      const nextHeight = Math.max(minH, Math.min(maxH, Math.round(startHeight + deltaY)));
      document.documentElement.style.setProperty("--table-h", `${nextHeight}px`);
      useUiStore.getState().setTableHeight(nextHeight);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };

    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  return (
    <section
      className={cx(
        "pointer-events-auto absolute z-30 flex flex-col overflow-hidden bg-solid",
        side === "bottom"
          ? cx(
              "felt-frosted-glass text-white border border-line rounded-[2px] shadow-panel",
              "bottom-[calc(var(--footer-h)+var(--timeline-h)+6px)] animate-panel-bottom transition-[left,right] duration-200 ease-out",
              tableMaximized
                ? "!top-[calc(var(--commandbar-h)+6px)] !h-auto"
                : "h-[var(--table-h,340px)]",
              leftPanel && leftPanel !== "table"
                ? "left-[calc(var(--ribbon-w)+312px+12px)]"
                : "left-[calc(var(--ribbon-w)+6px)]",
              rightPanel && rightPanel !== "table"
                ? "right-[calc(var(--ribbon-w)+312px+12px)]"
                : "right-[calc(var(--ribbon-w)+6px)]",
            )
          : cx(
              autoHeight && side !== "left"
                ? cx(
                    "top-[calc(var(--commandbar-h)+6px)] max-h-[calc(100vh-var(--commandbar-h)-var(--footer-h)-16px)] h-fit border border-line rounded-[2px] shadow-panel",
                    side === "right" ? "right-[calc(var(--ribbon-w)+6px)] animate-panel-right" : "",
                  )
                : side === "left"
                  ? "top-[calc(var(--commandbar-h)+6px)] bottom-[calc(var(--footer-h)+var(--timeline-h)+6px)] left-[calc(var(--ribbon-w)+6px)] border border-line rounded-[2px] shadow-panel animate-panel-left"
                  : "top-[calc(var(--commandbar-h)+6px)] bottom-[calc(var(--footer-h)+var(--timeline-h)+6px)] right-[calc(var(--ribbon-w)+6px)] border border-line rounded-[2px] shadow-panel animate-panel-right",
              wide
                ? "w-[min(640px,calc(100vw-var(--ribbon-w)-24px))]"
                : expanded
                  ? "w-[min(440px,calc(100vw-var(--ribbon-w)-24px))] transition-[width] duration-200 ease-out"
                  : side === "left"
                    ? "w-[min(312px,calc(100vw-var(--ribbon-w)-24px))] transition-[width] duration-200 ease-out"
                    : "w-[min(312px,calc(100vw-var(--ribbon-w)-24px))]",
            ),
        className,
      )}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
    >
      {/* Top drag handle for bottom panel height resize */}
      {side === "bottom" && !tableMaximized ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize table height"
          className="group absolute -top-1.5 left-0 right-0 z-50 flex h-3 cursor-ns-resize items-center justify-center select-none"
          onPointerDown={handleResizeStart}
          onDoubleClick={() => useUiStore.getState().setTableMaximized(true)}
          title="Drag to adjust height · Double click to maximize"
        >
          <div className="h-1 w-12 rounded-full bg-white/20 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-active:opacity-100 group-active:bg-cyan-400" />
        </div>
      ) : null}

      <header
        className={cx(
          "flex flex-none items-center justify-between gap-2.5 border-b px-3 pb-2 pl-3 pt-2",
          side === "bottom" ? "border-white/[0.08] bg-transparent" : "border-line",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {headerLeading ? (
            <div className="flex flex-none items-center">
              {headerLeading}
            </div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-0.5">
            {eyebrow && (
              <span className="font-mono text-[7.5px] uppercase tracking-[0.2em] text-ink-muted">
                {eyebrow}
              </span>
            )}
            <h2
              id={titleId}
              className={cx(
                "m-0 truncate",
                side === "bottom"
                  ? "font-sans text-[13.5px] font-semibold tracking-tight text-white/95"
                  : "font-mono text-[11px] font-semibold uppercase tracking-[0.08em]",
              )}
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
            className={cx(
              "grid size-6 flex-none place-items-center rounded-[2px] transition-colors focus-visible:outline-2",
              side === "bottom"
                ? "text-white/60 hover:bg-white/10 hover:text-white"
                : "text-ink-muted hover:bg-tint hover:text-ink",
            )}
            onClick={() => onClose()}
            aria-label={`Close ${title}`}
          >
            <X size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        className={cx(
          "panel-scroll min-h-0 flex-1",
          flush ? "p-0" : "px-3.5 pb-3.5 pt-3",
          bodyClassName ?? "overflow-y-auto",
        )}
      >
        {children}
      </div>

      {footer ? (
        <footer
          className={cx(
            "flex flex-none items-center justify-between gap-2.5 border-t px-3.5 py-2",
            side === "bottom"
              ? "border-white/[0.08] bg-transparent font-sans text-[10.5px] text-white/50 tracking-normal"
              : "border-line font-mono text-[8.5px] uppercase tracking-[0.06em] text-ink-muted",
          )}
        >
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
