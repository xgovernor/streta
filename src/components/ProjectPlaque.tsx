import { VIEW_CRS } from "../lib/gis/crs";
import { cx } from "../lib/cx";
import { formatCount } from "../lib/format";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";

export function ProjectPlaque() {
  const ready = useMapStore((state) => state.ready);
  const projectName = useProjectStore((state) => state.projectName);
  const dirty = useProjectStore((state) => state.dirty);
  const layers = useProjectStore((state) => state.layers);

  const featureCount = layers.reduce(
    (total, layer) => total + layer.features.length,
    0,
  );

  return (
    <header className="glass pointer-events-none absolute left-14 top-2.5 z-[22] flex items-center gap-3.5 rounded-[10px] border border-line py-[7px] pl-3 pr-2.5 shadow-float compact:hidden short:hidden">
      <div className="flex max-w-[280px] flex-col gap-px">
        <span className="truncate font-mono text-[8px] uppercase tracking-[0.16em] text-ink-muted">
          Strata · Workspace
        </span>
        <strong className="truncate text-[12.5px] font-semibold tracking-[-0.01em]">
          {projectName}
          {dirty ? <span className="text-accent"> ·</span> : null}
        </strong>
        <span className="font-mono text-[9px] text-ink-soft">
          {layers.length} layer{layers.length === 1 ? "" : "s"} ·{" "}
          {formatCount(featureCount)} feature
          {featureCount === 1 ? "" : "s"} · {VIEW_CRS}
        </span>
      </div>
      <span
        className={cx(
          "flex items-center gap-[5px] border-l border-line pl-3 font-mono text-[8px] uppercase tracking-[0.13em]",
          ready ? "text-ok" : "text-ink-muted",
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "size-[5px] shrink-0 rounded-full bg-ok shadow-[0_0_0_3px_rgba(95,214,164,0.14)]",
            ready && "animate-pulse-dot",
          )}
        />
        {ready ? "Live" : "Sync"}
      </span>
    </header>
  );
}
