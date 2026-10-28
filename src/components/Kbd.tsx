import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export function Kbd({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cx(
        "inline-flex h-4 min-w-4 items-center justify-center rounded border border-line border-b-line-strong bg-tint px-1 font-mono text-[8.5px] leading-none text-ink-soft",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
