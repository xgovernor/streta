import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Kbd } from "./Kbd";

interface RailButtonProps {
  label: string;
  side: "left" | "right";
  active?: boolean;
  shortcut?: string;
  onClick: () => void;
  children: ReactNode;
}

export function RailButton({
  label,
  side,
  active,
  shortcut,
  onClick,
  children,
}: RailButtonProps) {
  const isRight = side === "right";

  return (
    <button
      type="button"
      className={cx(
        "group relative grid size-[30px] place-items-center rounded-lg text-ink-soft transition-[background-color,color,transform] duration-150 hover:bg-tint hover:text-ink active:scale-[0.94]",
        active && "bg-accent-soft text-accent",
      )}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {active ? (
        <span
          aria-hidden="true"
          className={cx(
            "absolute h-3.5 w-0.5 rounded-full bg-accent",
            isRight ? "-right-2" : "-left-2",
          )}
        />
      ) : null}

      {children}

      <span
        aria-hidden="true"
        className={cx(
          "pointer-events-none invisible absolute top-1/2 z-50 flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-raised px-2 py-1.5 text-[11px] font-medium text-ink opacity-0 shadow-float transition-[opacity,transform,visibility] duration-150 group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100",
          isRight
            ? "right-[calc(100%+12px)] translate-x-0.5 group-hover:translate-x-0 group-focus-visible:translate-x-0"
            : "left-[calc(100%+12px)] -translate-x-0.5 group-hover:translate-x-0 group-focus-visible:translate-x-0",
        )}
      >
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </span>
    </button>
  );
}
