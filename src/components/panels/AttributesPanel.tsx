import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Crosshair,
  Maximize2,
  Minimize2,
  Search,
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

const ROW_HEIGHT = 30;
const OVERSCAN = 8;
const MATCH_LIMIT = 400;

type SortState = { field: string; direction: "asc" | "desc" } | null;

export function AttributesPanel() {
  const openPanel = useUiStore((state) => state.openPanel);
  const tableMaximized = useUiStore((state) => state.tableMaximized);
  const setTableMaximized = useUiStore((state) => state.setTableMaximized);

  const layers = useProjectStore((state) => state.layers);
  const activeLayerId = useProjectStore((state) => state.activeLayerId);
  const setActiveLayer = useProjectStore((state) => state.setActiveLayer);
  const select = useProjectStore((state) => state.select);
  const selection = useProjectStore((state) => state.selection);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(360);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const handleClose = () => {
    const s = useUiStore.getState();
    if (s.leftPanel === "table") s.closePanel("left");
    if (s.rightPanel === "table") s.closePanel("right");
    s.setTableMaximized(false);
  };

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
  }, [layer?.id, tableMaximized]);

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
        title="Table"
        side="bottom"
        flush={true}
        onClose={handleClose}
      >
        <div className="flex h-full min-h-[170px] flex-col items-center justify-center p-8 text-center select-none">
          <p className="font-sans text-[14.5px] font-medium tracking-tight text-white/95">No layers on this map</p>
          <p className="mt-2 font-sans text-[12.5px] text-white/60">
            Open or import a dataset from the workspace toolbar to view attributes.
          </p>
          <button
            type="button"
            className="mt-5 rounded-[4px] border border-white/10 bg-white/[0.06] hover:bg-white/[0.1] px-4 py-1.5 font-sans text-[12px] font-medium text-white transition-colors"
            onClick={() => openPanel("data")}
          >
            Open datasets
          </button>
        </div>
      </PanelShell>
    );
  }

  return (
    <PanelShell
      title={`Table · ${layer.name}`}
      side="bottom"
      flush={true}
      bodyClassName="flex flex-col min-h-0 overflow-hidden"
      onClose={handleClose}
      headerControls={
        <>
          <select
            value={layer.id}
            aria-label="Table dataset"
            className="h-7 max-w-[210px] rounded-[3px] border border-white/10 bg-white/[0.05] px-2.5 text-[12px] font-sans font-medium text-white/90 outline-none transition-colors hover:border-white/20 focus:border-cyan-500/80 focus:bg-[#161b22]"
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
              <option key={item.id} value={item.id} className="bg-[#161b22] text-white">
                {item.name}
              </option>
            ))}
          </select>

          <div className="flex h-7 w-[230px] items-center gap-1.5 rounded-[3px] border border-white/10 bg-white/[0.04] px-2.5 transition-colors focus-within:border-cyan-500/70 focus-within:bg-white/[0.06]">
            <Search
              size={13}
              strokeWidth={2}
              aria-hidden="true"
              className="text-white/40"
            />
            <input
              value={query}
              type="search"
              placeholder="Filter rows"
              aria-label="Filter attribute rows"
              autoComplete="off"
              className="h-full flex-1 appearance-none border-0 bg-transparent text-[12px] font-sans text-white outline-none placeholder:text-white/40"
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setScrollTop(0);
              }}
            />
            {query ? (
              <button
                type="button"
                className="text-white/40 hover:text-white transition-colors"
                aria-label="Clear filter"
                onClick={() => setQuery("")}
              >
                <X size={13} strokeWidth={2} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <span className="font-sans text-[11px] font-medium text-white/50 tracking-normal">
            {layer.geometryKind}
            {hasActiveFilters(layer) ? " · filtered" : ""}
          </span>
        </>
      }
      headerTrailing={
        <>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-[3px] border border-white/10 bg-white/[0.04] px-2.5 text-[11.5px] font-sans font-medium text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:opacity-40 disabled:pointer-events-none"
            onClick={() => zoomToSelection()}
            disabled={!selection}
            title="Zoom map to selected feature"
          >
            <Crosshair size={13} strokeWidth={2} aria-hidden="true" />
            Zoom
          </button>
          <button
            type="button"
            className="grid size-7 place-items-center rounded-[3px] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            onClick={() => setTableMaximized(!tableMaximized)}
            aria-label={tableMaximized ? "Restore table height" : "Maximize table height"}
            title={tableMaximized ? "Restore table" : "Maximize table"}
          >
            {tableMaximized ? (
              <Minimize2 size={14} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <Maximize2 size={14} strokeWidth={1.8} aria-hidden="true" />
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
          <span className="text-[11px] text-white/45">
            Click cell to copy · Double-click row for details · Click header to sort
          </span>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
        <div
          ref={scrollerRef}
          className="panel-scroll min-h-0 flex-1 overflow-auto"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div className="min-w-full w-max">
            <div className="sticky top-0 z-10 flex items-stretch border-b border-white/10 bg-[#12161f]/95 backdrop-blur-md">
              <span className="w-12 flex-none px-2 py-2 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-white/40">
                #
              </span>
              {fieldNames.map((field) => {
                const sorted = sort?.field === field;

                return (
                  <button
                    key={field}
                    type="button"
                    className={cx(
                      "flex min-w-[130px] flex-1 items-center gap-1.5 truncate px-3 py-2 text-left font-sans text-[12px] font-medium tracking-tight transition-colors hover:bg-white/[0.03]",
                      sorted ? "text-cyan-400 font-semibold" : "text-white/70 hover:text-white",
                    )}
                    onClick={() => toggleSort(field)}
                  >
                    <span className="truncate">{field}</span>
                    {sorted ? (
                      sort.direction === "asc" ? (
                        <ArrowUp size={10} strokeWidth={2.4} aria-hidden="true" />
                      ) : (
                        <ArrowDown size={10} strokeWidth={2.4} aria-hidden="true" />
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
                          "flex items-stretch border-b border-white/[0.04] transition-colors",
                          selected
                            ? "bg-cyan-500/15 shadow-[inset_0_0_0_1px_rgba(6,182,212,0.35)]"
                            : "hover:bg-white/[0.04]",
                        )}
                        style={{ height: ROW_HEIGHT }}
                        onDoubleClick={() => openPanel("feature")}
                      >
                        <button
                          type="button"
                          className="w-12 flex-none truncate px-2 text-center font-mono text-[11px] text-white/40 hover:text-white/80"
                          onClick={() => zoomToRow(feature.id)}
                          title="Select and zoom"
                        >
                          {start + index + 1}
                        </button>
                        {fieldNames.map((field) => (
                          <button
                            key={field}
                            type="button"
                            className="min-w-[130px] flex-1 truncate px-3 text-left font-sans text-[12.5px] text-white/85 hover:text-white transition-colors"
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
                                  .catch(() => { });
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
              <div className="py-14 text-center font-sans text-[12.5px] text-white/45">
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
