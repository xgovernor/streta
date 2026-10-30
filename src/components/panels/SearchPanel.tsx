import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Search, X } from "lucide-react";
import mgrs from "mgrs";
import { GEOGRAPHIC_CRS, transformPosition } from "../../lib/gis/crs";
import { visibleFeatures } from "../../lib/gis/filter";
import { displayValue, geometryCentroid, searchableText } from "../../lib/gis/geometry";
import { flyTo } from "../../map/mapController";
import { formatCount } from "../../lib/format";
import { useProjectStore } from "../../state/projectStore";
import { useUiStore } from "../../state/uiStore";
import { Kbd } from "../Kbd";
import { PanelShell } from "../PanelShell";
import { EmptyState, LayerSwatch, SectionLabel } from "./shared";

const RESULT_LIMIT = 80;

interface Result {
  layerId: string;
  layerName: string;
  color: string;
  featureId: string;
  label: string;
  detail: string;
  lon: number;
  lat: number;
}

function parseCoordinateQuery(query: string): { lon: number; lat: number } | null {
  const q = query.trim();
  if (!q) return null;

  // Try MGRS first (space or no-space)
  try {
    const result = (mgrs as any).inverse(q.replace(/\s+/g, ""));
    if (Array.isArray(result) && result.length === 2 && Number.isFinite(result[0]) && Number.isFinite(result[1])) {
      return { lon: result[0], lat: result[1] };
    }
    if (result && typeof result === "object" && Array.isArray((result as any))) {
      const arr = result as any;
      if (arr.length === 2) return { lon: arr[0], lat: arr[1] };
    }
    if (result && typeof result === "object" && "lon" in result && "lat" in result) {
      return { lon: (result as any).lon, lat: (result as any).lat };
    }
  } catch {
    // fall through
  }
  try {
    const result = (mgrs as any).inverse(q.toUpperCase());
    if (Array.isArray(result) && result.length === 2 && Number.isFinite(result[0]) && Number.isFinite(result[1])) {
      return { lon: result[0], lat: result[1] };
    }
    if (result && typeof result === "object" && "lon" in result && "lat" in result) {
      return { lon: (result as any).lon, lat: (result as any).lat };
    }
  } catch {
    // fall through
  }

  // Try decimal lat,lon or lon,lat
  const parts = q.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 2) {
    const a = parseFloat(parts[0]);
    const b = parseFloat(parts[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      // Assume lat,lon if |a| <= 90
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
        return { lat: a, lon: b };
      }
      // Assume lon,lat
      if (Math.abs(a) <= 180 && Math.abs(b) <= 90) {
        return { lon: a, lat: b };
      }
    }
  }

  return null;
}

export function SearchPanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const select = useProjectStore((state) => state.select);
  const layers = useProjectStore((state) => state.layers);

  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const coordGoto = useMemo(() => parseCoordinateQuery(query), [query]);

  /** A lowercase copy of every feature's attributes, rebuilt only when data changes. */
  const index = useMemo(
    () =>
      layers.map((layer) => {
        const fields = layer.fields.map((field) => field.name);
        const labelField = layer.style.labelField ?? fields[0] ?? null;

        return {
          layer,
          labelField,
          // Searching follows the map: a feature hidden by a layer filter is not
          // offered, because selecting it would highlight nothing.
          entries: visibleFeatures(layer).map((feature) => ({
            feature,
            text: searchableText(feature.properties, fields).slice(0, 240),
          })),
        };
      }),
    [layers],
  );

  const total = index.reduce((count, entry) => count + entry.entries.length, 0);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const collected: Result[] = [];

    for (const entry of index) {
      if (!entry.entries.length) {
        continue;
      }

      for (const item of entry.entries) {
        if (normalized && !item.text.includes(normalized)) {
          continue;
        }

        const centroid = geometryCentroid(item.feature.geometry);

        if (!centroid) {
          continue;
        }

        const [lon, lat] = transformPosition(centroid, entry.layer.crs, GEOGRAPHIC_CRS);
        const label =
          (entry.labelField
            ? displayValue(item.feature.properties[entry.labelField])
            : null) ?? item.feature.id;

        collected.push({
          layerId: entry.layer.id,
          layerName: entry.layer.name,
          color: entry.layer.style.color,
          featureId: item.feature.id,
          label: label === "—" ? item.feature.id : label,
          detail: `${entry.layer.name} · ${item.feature.geometry.type}`,
          lon,
          lat,
        });

        if (collected.length >= RESULT_LIMIT) {
          return collected;
        }
      }
    }

    return collected;
  }, [index, query]);

  const choose = (result: Result) => {
    select({ layerId: result.layerId, featureId: result.featureId });
    flyTo(result.lon, result.lat, 14);
  };

  return (
    <PanelShell
      eyebrow="Feature index"
      title="Search"
      onClose={closePanel}
      footer={
        <>
          <span>{formatCount(total)} indexed features</span>
          <span className="text-ink-muted">Enter opens first</span>
        </>
      }
    >
      <form
        className="mb-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (coordGoto) {
            flyTo(coordGoto.lon, coordGoto.lat, 14);
            return;
          }
          if (results[0]) {
            choose(results[0]);
          }
        }}
      >
        <div className="flex h-[34px] items-center gap-2 rounded-[2px] border border-line bg-tint px-2.5 text-ink-muted transition-colors focus-within:border-accent-line focus-within:bg-raised">
          <Search size={15} strokeWidth={1.8} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search features or go to lat,lon / MGRS"
            aria-label="Search features or coordinates"
            autoComplete="off"
            spellCheck={false}
            className="h-full flex-1 appearance-none border-0 bg-transparent text-xs text-ink outline-none placeholder:text-ink-muted"
          />
          {query ? (
            <button
              type="button"
              className="grid size-5 flex-none place-items-center rounded-[2px] text-ink-muted transition-colors hover:bg-tint hover:text-ink"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              <X size={13} strokeWidth={1.8} aria-hidden="true" />
            </button>
          ) : (
            <Kbd className="flex-none">/</Kbd>
          )}
        </div>
      </form>

      {coordGoto ? (
        <>
          <SectionLabel>Go to location</SectionLabel>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-[2px] px-1.5 py-[7px] text-left transition-colors hover:bg-tint"
            onClick={() => {
              flyTo(coordGoto.lon, coordGoto.lat, 14);
            }}
          >
            <MapPin size={14} strokeWidth={1.8} className="text-accent" aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <strong className="truncate text-[11.5px] font-semibold">Fly to coordinates</strong>
              <span className="truncate font-mono text-[9.5px] text-ink-muted">
                {coordGoto.lat.toFixed(5)}, {coordGoto.lon.toFixed(5)}
              </span>
            </span>
            <span className="flex-none text-[9px] text-ink-muted">Enter</span>
          </button>
        </>
      ) : (
        <>
          <SectionLabel trailing={query ? `${results.length} shown` : "All features"}>
            Matches
          </SectionLabel>

          {results.length ? (
            <div className="flex flex-col gap-px">
              {results.map((result) => (
                <button
                  key={`${result.layerId}:${result.featureId}`}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-[2px] px-1.5 py-[7px] text-left transition-colors hover:bg-tint"
                  onClick={() => choose(result)}
                >
                  <LayerSwatch color={result.color} />
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <strong className="truncate text-[11.5px] font-semibold">
                      {result.label}
                    </strong>
                    <span className="truncate text-[9.5px] text-ink-muted">
                      {result.detail}
                    </span>
                  </span>
                  <span className="flex-none font-mono text-[9px] text-ink-soft">
                    {result.lat.toFixed(2)}, {result.lon.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Search size={20} strokeWidth={1.4} aria-hidden="true" />}
              title={
                total
                  ? `Nothing matches “${query}”.`
                  : "Load a dataset to search its features."
              }
            >
              {query ? (
                <button
                  type="button"
                  className="text-[10px] font-semibold tracking-[0.02em] text-accent hover:underline"
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                >
                  Clear search
                </button>
              ) : null}
            </EmptyState>
          )}
        </>
      )}
    </PanelShell>
  );
}
