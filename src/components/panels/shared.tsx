import type { ReactNode } from "react";

export const PRIMARY_BUTTON =
  "inline-flex h-[30px] items-center justify-center gap-1.5 rounded-[7px] border border-accent bg-accent text-[10.5px] font-semibold text-on-accent transition-[background-color,border-color,transform] hover:border-accent-strong hover:bg-accent-strong active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45";

export const SECONDARY_BUTTON =
  "inline-flex h-[30px] items-center justify-center gap-1.5 rounded-[7px] border border-line bg-tint px-2.5 text-[10.5px] font-semibold text-ink-soft transition-[border-color,color,transform] hover:border-line-strong hover:text-ink active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45";

export const ICON_BUTTON =
  "grid size-[22px] flex-none place-items-center rounded-[6px] text-ink-muted transition-colors hover:bg-tint hover:text-ink";

export const FIELD_INPUT =
  "h-[26px] w-full rounded-[7px] border border-line bg-tint px-2 text-[11px] text-ink outline-none transition-colors focus:border-accent-line focus:bg-raised";

export const SECONDARY_COPY =
  "inline-flex h-[22px] items-center justify-center gap-1 rounded-[6px] text-[10px] font-semibold text-ink-soft transition-colors hover:bg-tint hover:text-ink";

interface InfoNoteProps {
  icon?: ReactNode;
  title?: ReactNode;
  body?: ReactNode;
  children?: ReactNode;
}

export function InfoNote({ icon, title, body, children }: InfoNoteProps) {
  const noteTitle =
    title ?? (typeof children === "string" ? children : null);
  const noteBody =
    typeof title === "string"
      ? body
      : title;

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-ink-muted/40 bg-tint px-2.5 py-2">
      {icon ? (
        <span className="mt-0.5 shrink-0 text-ink-muted">{icon}</span>
      ) : null}
      <div className="min-w-0">
        {noteTitle ? (
          <span className="block text-[10.5px] font-semibold text-ink">
            {noteTitle}
          </span>
        ) : null}
        {noteBody ? (
          <span className="block text-[10px] text-ink-muted">{noteBody}</span>
        ) : null}
      </div>
    </div>
  );
}

interface SectionLabelProps {
  children: ReactNode;
  trailing?: ReactNode;
}

export function SectionLabel({ children, trailing }: SectionLabelProps) {
  return (
    <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-ink-muted">
      {children}
      {trailing ? <span className="ml-2">{trailing}</span> : null}
    </span>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  children?: ReactNode;
}

export function EmptyState({ icon, title, body, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      {icon ? (
        <span className="text-ink-muted">{icon}</span>
      ) : null}
      <span className="text-[11px] font-semibold text-ink">{title}</span>
      {body ? <span className="text-[10.5px] text-ink-muted">{body}</span> : null}
      {children ? (
        <span className="max-w-[220px] text-[10px] leading-normal text-ink-muted">
          {children}
        </span>
      ) : null}
    </div>
  );
}

export function KeyValue({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[10.5px]">
      <span className="text-ink-muted">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}

export function LayerSwatch({
  color,
  size = 10,
}: {
  color: string;
  size?: number;
}) {
  return (
    <span
      className="shrink-0 rounded"
      style={{
        backgroundColor: color,
        width: size,
        height: size,
        display: "inline-block",
      }}
      aria-hidden="true"
    />
  );
}
