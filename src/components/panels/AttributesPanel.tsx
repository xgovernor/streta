import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Crosshair,
  Maximize2,
  Minimize2,
  Search,
  Table2,
  X,
} from "lucide-react";
import { hasActiveFilters, visibleFeatures } from "../../lib/gis/filter";
import { displayValue, searchableText } from "../../lib/gis/geometry";
import { transformPosition, GEOGRAPHIC_CRS } from "../../lib/gis/crs";
import { geometryCentroid } from "../../lib/gis/geometry";
import { flyTo, zoomToSelection } from "../../map/mapController";
import { cx } from "../../lib/cx";
import { formatCount } from "../../lib/format";
import { useProjectStore } from "../../state/projectStore";
import { useUiStore } from "../../state/uiStore";
import { PanelShell } from "../PanelShell";
import { EmptyState, FIELD_INPUT, SECONDARY_COPY } from "./shared";

const ROW_HEIGHT = 24;
const OVERSCAN = 8;
const MATCH_LIMIT = 400;

type SortState = { field: string; direction: "asc" | "desc" } | null;

export function AttributesPanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const openPanel = useUiStore((state) => state.openPanel);

  const layers = useProjectStore((state) => state.layers);
  const activeLayerId = useProjectStore((state) => state.activeLayerId);
  const setActiveLayer = useProjectStore((state) => state.setActiveLayer);
  const select = useProjectStore((state) => state.select);
  const selection = useProjectStore((state) => state.selection);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(360);
  const [maximized, setMaximized] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const layer =
    layers.find((item) => item.id === activeLayerId) ?? layers.at(-1) ?? null;

  useEffect(() => {
    setSort(null);
    setScrollTop(0);
    setQuery("");
  }, [layer?.id]);

  useEffect(() => {
    const element = scrollerRef.current;

    if (!element) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setViewport(element.clientHeight);
    });

    observer.observe(element);
    setViewport(element.clientHeight);

    return () => observer.disconnect();
  }, [layer?.id, maximized]);

  const fieldNames = useMemo(
    () => (layer ? layer.fields.map((field) => field.name) : []),
    [layer],
  );

  const rows = useMemo(() => {
    if (!layer) {
      return [];
    }

    const normalized = query.trim().toLowerCase();
    let matching = visibleFeatures(layer);

    if (normalized) {
      matching = matching.filter((feature) =>
        searchableText(feature.properties, fieldNames).includes(normalized),
      );
    }

    if (sort) {
      const { field, direction } = sort;
      const factor = direction === "asc" ? 1 : -1;

      matching = [...matching].sort((a, b) => {
        const left = a.properties[field];
        const right = b.properties[field];

        if (typeof left === "number" && typeof right === "number") {
          return (left - right) * factor;
        }

        return displayValue(left).localeCompare(displayValue(right)) * factor;
      });
    }

    return matching;
  }, [layer, fieldNames, query, sort]);

  const selectedLayerId = selection?.layerId ?? null;
  const selectedFeatureId = selection?.featureId ?? null;

  const truncated = rows.length > MATCH_LIMIT;
  const visible = truncated ? rows.slice(0, MATCH_LIMIT) : rows;

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    visible.length,
    start + Math.ceil(viewport / ROW_HEIGHT) + OVERSCAN * 2,
  );
  const slice = visible.slice(start, end);

  const toggleSort = (field: string) => {
    setSort((current) => {
      if (!current || current.field !== field) {
        return { field, direction: "asc" };
      }

      if (current.direction === "asc") {
        return { field, direction: "desc" };
      }

      return null;
    });
  };

  const zoomToRow = (featureId: string) => {
    if (!layer) {
      return;
    }

    select({ layerId: layer.id, featureId });
    zoomToSelection();
  };

  const flyToRow = (featureId: string) => {
    if (!layer) {
      return;
    }

    const feature = layer.features.find((item) => item.id === featureId);

    if (!feature) {
      return;
    }

    const centroid = geometryCentroid(feature.geometry);

    if (!centroid) {
      return;
    }

    const [lon, lat] = transformPosition(centroid, layer.crs, GEOGRAPHIC_CRS);
    flyTo(lon, lat, 14);
  };

  if (!layer) {
    return (
      <PanelShell
        eyebrow="Attributes"
        title="Attribute table"
        side="bottom"
        onClose={closePanel}
      >
        <EmptyState
          icon={<Table2 size={22} strokeWidth={1.4} aria-hidden="true" />}
          title="No dataset is loaded yet. Open one to browse its attributes."
        >
          <button
            type="button"
            className="text-[10px] font-semibold tracking-[0.02em] text-accent hover:underline"
            onClick={() => openPanel("data")}
          >
            Open datasets
          </button>
        </EmptyState>
      </PanelShell>
    );
  }

  return (
    <PanelShell
      eyebrow="Attributes"
      title={layer.name}
      side="bottom"
      className={maximized ? "!top-2.5 !h-auto" : ""}
      bodyClassName="flex flex-col min-h-0 overflow-hidden"
      onClose={closePanel}
      headerControls={
        <>
          <select
            value={layer.id}
            aria-label="Table dataset"
            className={cx(FIELD_INPUT, "max-w-[190px]")}
            onChange={(event) => {
              setActiveLayer(event.currentTarget.value);
              useUiStore
                .getState()
                .notify(
                  `Table switched to ${event.currentTarget.selectedOptions[0]?.textContent ?? "layer"}`,
                );
            }}
          >
            {layers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>

          <div className="flex h-[26px] w-[210px] items-center gap-1.5 rounded-[7px] border border-line bg-tint px-2 focus-within:border-accent-line">
            <Search
              size={12}
              strokeWidth={1.9}
              aria-hidden="true"
              className="text-ink-muted"
            />
            <input
              value={query}
              type="search"
              placeholder="Filter rows"
              aria-label="Filter attribute rows"
              autoComplete="off"
              className="h-full flex-1 appearance-none border-0 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-muted"
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setScrollTop(0);
              }}
            />
            {query ? (
              <button
                type="button"
                className={SECONDARY_COPY}
                aria-label="Clear filter"
                onClick={() => setQuery("")}
              >
                <X size={12} strokeWidth={1.9} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-muted">
            {layer.geometryKind}
            {hasActiveFilters(layer) ? " · filtered" : ""}
          </span>
        </>
      }
      headerTrailing={
        <>
          <button
            type="button"
            className="inline-flex h-[24px] items-center gap-1.5 rounded-[6px] border border-line bg-tint px-2 text-[10px] font-semibold text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
            onClick={() => zoomToSelection()}
            disabled={!selection}
            title="Zoom map to selected feature"
          >
            <Crosshair size={12} strokeWidth={1.9} aria-hidden="true" />
            Zoom
          </button>
          <button
            type="button"
            className="grid size-6 place-items-center rounded-md text-ink-muted transition-colors hover:bg-tint hover:text-ink"
            onClick={() => setMaximized((prev) => !prev)}
            aria-label={
              maximized ? "Restore table height" : "Maximize table height"
            }
            title={maximized ? "Restore table" : "Maximize table"}
          >
            {maximized ? (
              <Minimize2 size={13} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <Maximize2 size={13} strokeWidth={1.8} aria-hidden="true" />
            )}
          </button>
        </>
      }
      footer={
        <>
          <div className="flex items-center gap-2">
            <span>
              {formatCount(visible.length)} of {formatCount(rows.length)} rows
              {truncated ? " · first 400 shown" : ""}
              {hasActiveFilters(layer)
                ? ` · filtered from ${formatCount(layer.features.length)}`
                : ""}
            </span>
            <span>·</span>
            <span>{layer.fields.length} fields</span>
          </div>
          <span className="text-[8.5px] text-ink-muted">
            Click cell to copy · Double-click row for details · Click header to sort
          </span>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-shell/40">
        <div
          ref={scrollerRef}
          className="panel-scroll min-h-0 flex-1 overflow-auto"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div className="min-w-full w-max">
            <div className="sticky top-0 z-10 flex items-stretch gap-px border-b border-line bg-solid">
              <span className="w-10 flex-none px-1.5 py-1.5 font-mono text-[8px] uppercase tracking-[0.08em] text-ink-muted">
                #
              </span>
              {fieldNames.map((field) => {
                const sorted = sort?.field === field;

                return (
                  <button
                    key={field}
                    type="button"
                    className={cx(
                      "flex min-w-[110px] flex-1 items-center gap-1 truncate px-2 py-1.5 text-left font-mono text-[8.5px] uppercase tracking-[0.08em] transition-colors hover:text-ink",
                      sorted ? "text-accent" : "text-ink-muted",
                    )}
                    onClick={() => toggleSort(field)}
                  >
                    <span className="truncate">{field}</span>
                    {sorted ? (
                      sort.direction === "asc" ? (
                        <ArrowUp size={9} strokeWidth={2.4} aria-hidden="true" />
                      ) : (
                        <ArrowDown size={9} strokeWidth={2.4} aria-hidden="true" />
                      )
                    ) : null}
                  </button>
                );
              })}
            </div>

            {visible.length > 0 ? (
              <div
                style={{
                  height: visible.length * ROW_HEIGHT,
                  position: "relative",
                }}
              >
                <div
                  style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}
                >
                  {slice.map((feature, index) => {
                    const selected =
                      selectedLayerId === layer.id &&
                      selectedFeatureId === feature.id;

                    return (
                      <div
                        key={feature.id}
                        className={cx(
                          "flex items-stretch gap-px border-b border-line/60 transition-colors",
                          selected ? "bg-accent-soft" : "hover:bg-tint",
                        )}
                        style={{ height: ROW_HEIGHT }}
                        onDoubleClick={() => openPanel("feature")}
                      >
                        <button
                          type="button"
                          className="w-10 flex-none truncate px-1.5 text-left font-mono text-[9px] text-ink-muted"
                          onClick={() => zoomToRow(feature.id)}
                          title="Select and zoom"
                        >
                          {start + index + 1}
                        </button>
                        {fieldNames.map((field) => (
                          <button
                            key={field}
                            type="button"
                            className="min-w-[110px] flex-1 truncate px-2 text-left text-[11px] text-ink-soft hover:text-ink"
                            onClick={() => {
                              select({
                                layerId: layer.id,
                                featureId: feature.id,
                              });
                              const text = displayValue(
                                feature.properties[field],
                              );
                              if (text && text !== "—") {
                                navigator.clipboard
                                  ?.writeText(text)
                                  .catch(() => {});
                              }
                            }}
                            onDoubleClick={() => void flyToRow(feature.id)}
                            title={displayValue(feature.properties[field])}
                          >
                            {displayValue(feature.properties[field])}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-[10.5px] text-ink-muted">
                {query.trim() ? (
                  <>No row matches “{query}”.</>
                ) : (
                  <>Every feature is hidden by this layer's filter.</>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </PanelShell>
  );
}
