import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Crosshair, Search, Table2, X } from "lucide-react";
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
import { EmptyState, FIELD_INPUT, SectionLabel, SECONDARY_COPY } from "./shared";

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
  }, [layer?.id]);

  const fieldNames = useMemo(
    () => (layer ? layer.fields.map((field) => field.name) : []),
    [layer],
  );

  const rows = useMemo(() => {
    if (!layer) {
      return [];
    }

    const normalized = query.trim().toLowerCase();
    // The table lists what the map draws, so the layer's own facets apply here
    // too; the search box narrows that set further.
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
        side="right"
        wide
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
      side="right"
      wide
      onClose={closePanel}
      footer={
        <>
          <span>
            {formatCount(visible.length)} of {formatCount(rows.length)} rows
            {truncated ? " · first 400 shown" : ""}
            {hasActiveFilters(layer)
              ? ` · filtered from ${formatCount(layer.features.length)}`
              : ""}
          </span>
          <span>{layer.fields.length} fields</span>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <select
          value={layer.id}
          aria-label="Table dataset"
          className={cx(FIELD_INPUT, "max-w-[180px]")}
          onChange={(event) => {
            setActiveLayer(event.currentTarget.value);
            useUiStore.getState().notify(`Table switched to ${event.currentTarget.selectedOptions[0]?.textContent ?? "layer"}`);
          }}
        >
          {layers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        <div className="flex h-[26px] flex-1 items-center gap-1.5 rounded-[7px] border border-line bg-tint px-2 focus-within:border-accent-line">
          <Search size={12} strokeWidth={1.9} aria-hidden="true" className="text-ink-muted" />
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
      </div>

      <SectionLabel trailing="Click header to sort">
        {layer.geometryKind}
        {hasActiveFilters(layer) ? " · filtered" : ""}
      </SectionLabel>

      <div className="overflow-hidden rounded-lg border border-line">
        <div className="flex items-stretch gap-px border-b border-line bg-tint">
          <span className="w-9 flex-none px-1 py-1.5 font-mono text-[8px] uppercase tracking-[0.08em] text-ink-muted">
            #
          </span>
          {fieldNames.map((field) => {
            const sorted = sort?.field === field;

            return (
              <button
                key={field}
                type="button"
                className={cx(
                  "flex min-w-[92px] flex-1 items-center gap-1 truncate px-1.5 py-1.5 text-left font-mono text-[8px] uppercase tracking-[0.08em] transition-colors hover:text-ink",
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

        <div
          ref={scrollerRef}
          className="panel-scroll max-h-[min(46vh,420px)] min-h-[180px] overflow-auto"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div style={{ height: visible.length * ROW_HEIGHT, position: "relative" }}>
            <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
              {slice.map((feature, index) => {
                const selected =
                  selectedLayerId === layer.id &&
                  selectedFeatureId === feature.id;

                return (
                  <div
                    key={feature.id}
                    className={cx(
                      "flex items-stretch gap-px border-b border-line/60",
                      selected ? "bg-accent-soft" : "hover:bg-tint",
                    )}
                    style={{ height: ROW_HEIGHT }}
                    onDoubleClick={() => openPanel("feature")}
                  >
                    <button
                      type="button"
                      className="w-9 flex-none truncate px-1 text-left font-mono text-[9px] text-ink-muted"
                      onClick={() => zoomToRow(feature.id)}
                      title="Select and zoom"
                    >
                      {start + index + 1}
                    </button>
                    {fieldNames.map((field) => (
                      <button
                        key={field}
                        type="button"
                        className="min-w-[92px] flex-1 truncate px-1.5 text-left text-[10.5px] text-ink-soft"
                        onClick={() =>
                          select({ layerId: layer.id, featureId: feature.id })
                        }
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
        </div>
      </div>

      {!visible.length ? (
        <p className="mb-0 mt-3 text-[10.5px] text-ink-muted">
          {query.trim() ?
            <>No row matches “{query}”.</>
          : <>Every feature is hidden by this layer's filter.</>
          }
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-1.5">
        <button
          type="button"
          className="inline-flex h-[26px] items-center gap-1.5 rounded-[7px] border border-line bg-tint px-2 text-[10px] font-semibold text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
          onClick={() => zoomToSelection()}
          disabled={!selection}
        >
          <Crosshair size={12} strokeWidth={1.9} aria-hidden="true" />
          Zoom to selection
        </button>
        <span className="text-[10px] text-ink-muted">
          Click a cell to select, double-click to centre.            Click any value to copy it as text. Rows render as a window,
            so large tables stay responsive.
          </span>
      </div>
    </PanelShell>
  );
}
