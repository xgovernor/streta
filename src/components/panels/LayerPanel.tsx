import { useEffect, useMemo, useState } from "react";
import {
  Crosshair,
  Download,
  Hexagon,
  Loader2,
  Palette,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { GEOGRAPHIC_CRS, crsInfo, listCrs, transformPosition } from "../../lib/gis/crs";
import {
  addFilter,
  facetValues,
  filterableFields,
  hasActiveFilters,
  removeFilter,
  visibleFeatures,
} from "../../lib/gis/filter";
import { PALETTE, createLayer, measureLayer, uniqueLayerName } from "../../lib/gis/layers";
import { createDataset, uniqueDatasetName } from "../../lib/gis/datasets";
import { computeH3Aggregation } from "../../lib/gis/tiledBackend";
import type { DatasetLayer, FeatureRecord } from "../../lib/gis/types";

const H3_RES_DESCRIPTIONS: Record<number, string> = {
  2: "~180 km",
  3: "~68 km",
  4: "~26 km",
  5: "~9.8 km",
  6: "~3.7 km",
  7: "~1.4 km",
  8: "~530 m",
  9: "~200 m",
  10: "~76 m",
};
import { zoomToLayer } from "../../map/mapController";
import {
  formatArea,
  formatCount,
  formatDistance,
  formatNumber,
  formatExtent,
} from "../../lib/format";
import { describeError, exportLayerAs } from "../../lib/projectFile";
import { useProjectStore } from "../../state/projectStore";
import { useUiStore } from "../../state/uiStore";
import { PanelShell } from "../PanelShell";
import { cx } from "../../lib/cx";
import {
  EmptyState,
  FIELD_INPUT,
  ICON_BUTTON,
  InfoNote,
  KeyValue,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SectionLabel,
} from "./shared";

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.08em] text-ink-muted">
      <span className="w-[66px] flex-none">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        className="opacity-range m-0 flex-1"
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <span className="min-w-10 text-right normal-case tracking-normal text-ink-soft">
        {formatNumber(value, step < 1 ? 1 : 0)}
        {suffix}
      </span>
    </label>
  );
}

function NameField({ layer }: { layer: DatasetLayer }) {
  const renameLayer = useProjectStore((state) => state.renameLayer);
  const [draft, setDraft] = useState(layer.name);

  useEffect(() => {
    setDraft(layer.name);
  }, [layer.id, layer.name]);

  const commit = () => {
    if (draft.trim() && draft !== layer.name) {
      renameLayer(layer.id, draft);
    } else {
      setDraft(layer.name);
    }
  };

  return (
    <input
      value={draft}
      aria-label="Layer name"
      className={FIELD_INPUT}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

const FACET_LIMIT = 60;

function Facet({
  layer,
  field,
  values,
  onChange,
  onRemove,
}: {
  layer: DatasetLayer;
  field: string;
  values: string[];
  onChange: (values: string[]) => void;
  onRemove: () => void;
}) {
  const [query, setQuery] = useState("");
  const options = useMemo(
    () => facetValues(layer.features, field),
    [layer.features, field],
  );
  const normalized = query.trim().toLowerCase();
  const matching = normalized
    ? options.filter((option) =>
      option.value.toLowerCase().includes(normalized),
    )
    : options;
  const listed = matching.slice(0, FACET_LIMIT);

  return (
    <div className="rounded-[7px] border border-line bg-tint">
      <div className="flex items-center gap-1 py-1 pl-2 pr-1">
        <span className="truncate font-mono text-[8px] uppercase tracking-[0.1em] text-ink-muted">
          {field}
        </span>
        <span className="ml-auto flex-none font-mono text-[8px] text-ink-muted">
          {values.length ? `${values.length} of ${options.length}` : "all"}
        </span>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={`Remove the ${field} filter`}
          onClick={onRemove}
        >
          <X size={11} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {options.length > 8 ? (
        <input
          type="search"
          value={query}
          placeholder={`Search ${options.length} values`}
          aria-label={`Search ${field} values`}
          autoComplete="off"
          className="mx-1.5 mb-1 h-[22px] w-[calc(100%-12px)] rounded-[5px] border border-line bg-raised px-1.5 text-[10px] text-ink outline-none placeholder:text-ink-muted focus:border-accent-line"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      ) : null}

      <div className="panel-scroll max-h-[148px] overflow-auto px-1 pb-1">
        {listed.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-1.5 rounded-[5px] px-1 py-[2px] text-[10px] text-ink-soft hover:bg-raised"
          >
            <input
              type="checkbox"
              className="size-[10px] flex-none accent-[var(--accent)]"
              checked={values.includes(option.value)}
              onChange={() =>
                onChange(
                  values.includes(option.value) ?
                    values.filter((value) => value !== option.value)
                  : [...values, option.value],
                )
              }
            />
            <span className="truncate" title={option.value}>
              {option.value}
            </span>
            <span className="ml-auto flex-none font-mono text-[9px] text-ink-muted">
              {formatCount(option.count)}
            </span>
          </label>
        ))}
        {!listed.length ? (
          <p className="m-0 px-1 py-1.5 text-[10px] text-ink-muted">
            No value matches “{query}”.
          </p>
        ) : null}
      </div>

      {matching.length > listed.length ? (
        <p className="m-0 border-t border-line px-2 py-1 text-[9.5px] text-ink-muted">
          Showing {listed.length} of {formatCount(matching.length)} — search to
          narrow.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Attribute facets for one layer. A facet with nothing checked means "every
 * value", which is why adding one does not change the map until a value is
 * picked.
 */
function FilterSection({ layer }: { layer: DatasetLayer }) {
  const setLayerFilters = useProjectStore((state) => state.setLayerFilters);
  const fields = useMemo(() => filterableFields(layer), [layer]);
  const shown = visibleFeatures(layer);
  const taken = new Set(layer.filters.map((filter) => filter.field));
  const available = fields.filter((field) => !taken.has(field.field));
  const active = hasActiveFilters(layer);

  return (
    <>
      <SectionLabel
        trailing={
          active ?
            `${formatCount(shown.length)} of ${formatCount(layer.features.length)} shown`
          : null
        }
      >
        Filter
      </SectionLabel>

      {layer.filters.length ? (
        <div className="flex flex-col gap-1.5">
          {layer.filters.map((filter) => (
            <Facet
              key={filter.field}
              layer={layer}
              field={filter.field}
              values={filter.values}
              onChange={(values) =>
                setLayerFilters(
                  layer.id,
                  layer.filters.map((item) =>
                    item.field === filter.field ?
                      { field: item.field, values }
                    : item,
                  ),
                )
              }
              onRemove={() =>
                setLayerFilters(layer.id, removeFilter(layer.filters, filter.field))
              }
            />
          ))}
        </div>
      ) : null}

      {available.length ? (
        <select
          value=""
          aria-label="Add an attribute filter"
          className={cx(FIELD_INPUT, layer.filters.length ? "mt-1.5" : "")}
          onChange={(event) => {
            const field = event.currentTarget.value;

            if (field) {
              setLayerFilters(layer.id, addFilter(layer.filters, field));
            }
          }}
        >
          <option value="">Filter by field…</option>
          {available.map((field) => (
            <option key={field.field} value={field.field}>
              {field.field} · {formatCount(field.distinct)} value
              {field.distinct === 1 ? "" : "s"}
            </option>
          ))}
        </select>
      ) : null}

      {active ? (
        <button
          type="button"
          className="mt-1.5 text-[10px] font-semibold text-accent transition-opacity hover:underline"
          onClick={() => setLayerFilters(layer.id, [])}
        >
          Clear all filters
        </button>
      ) : null}
    </>
  );
}

export function LayerPanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const notify = useUiStore((state) => state.notify);
  const layers = useProjectStore((state) => state.layers);
  const datasets = useProjectStore((state) => state.datasets);
  const activeLayerId = useProjectStore((state) => state.activeLayerId);
  const selection = useProjectStore((state) => state.selection);
  const setLayerStyle = useProjectStore((state) => state.setLayerStyle);
  const setLayerCrs = useProjectStore((state) => state.setLayerCrs);
  const removeLayer = useProjectStore((state) => state.removeLayer);

  const layer =
    layers.find((item) => item.id === activeLayerId) ??
    layers.find((item) => item.id === selection?.layerId) ??
    layers.at(-1);

  // Totals describe what is on the map, so they follow the layer's filters.
  const shown = layer ? visibleFeatures(layer) : [];
  const measures = useMemo(
    () => (layer ? measureLayer({ ...layer, features: visibleFeatures(layer) }) : null),
    [layer],
  );

  const [h3Resolution, setH3Resolution] = useState<number>(7);
  const [h3Loading, setH3Loading] = useState(false);

  const isPointLayer =
    layer?.geometryKind === "point" ||
    Boolean(
      layer?.features.some(
        (f) => f.geometry.type === "Point" || f.geometry.type === "MultiPoint",
      ),
    );

  const handleH3Aggregation = async () => {
    if (!layer) return;
    setH3Loading(true);
    try {
      const isGeo = layer.crs === GEOGRAPHIC_CRS;
      const points: { lon: number; lat: number }[] = [];

      shown.forEach((f) => {
        if (f.geometry.type === "Point") {
          const [x, y] = f.geometry.coordinates as [number, number];
          if (isGeo) {
            points.push({ lon: x, lat: y });
          } else {
            const [lon, lat] = transformPosition([x, y], layer.crs, GEOGRAPHIC_CRS);
            points.push({ lon, lat });
          }
        } else if (f.geometry.type === "MultiPoint") {
          (f.geometry.coordinates as [number, number][]).forEach(([x, y]) => {
            if (isGeo) {
              points.push({ lon: x, lat: y });
            } else {
              const [lon, lat] = transformPosition([x, y], layer.crs, GEOGRAPHIC_CRS);
              points.push({ lon, lat });
            }
          });
        }
      });

      if (points.length === 0) {
        notify("No point coordinates available to aggregate");
        return;
      }

      const res = await computeH3Aggregation(points, h3Resolution);
      if (res && res.geojson?.features?.length > 0) {
        const projectStore = useProjectStore.getState();
        const existingDatasetNames = projectStore.datasets.map((d) => d.name);
        const datasetName = uniqueDatasetName(
          existingDatasetNames,
          `${layer.name} H3 (Res ${h3Resolution})`,
        );
        const dataset = createDataset({
          name: datasetName,
          kind: "file",
          order: projectStore.datasets.length,
        });

        const features: FeatureRecord[] = res.geojson.features.map(
          (f: any, idx: number) => ({
            id: f.id || `h3_${idx}`,
            geometry: f.geometry,
            properties: f.properties || {},
          }),
        );

        const existingLayerNames = projectStore.layers.map((l) => l.name);
        const layerName = uniqueLayerName(
          existingLayerNames,
          `${layer.name} H3 r${h3Resolution}`,
        );
        const newLayer = createLayer({
          datasetId: dataset.id,
          name: layerName,
          features,
          crs: GEOGRAPHIC_CRS,
          format: "geojson",
          source: "derived",
          order: 0,
          style: {
            color: "#8b5cf6",
            strokeWidth: 1.5,
            fillOpacity: 0.35,
            labelField: "count",
          },
        });

        projectStore.addDataset(dataset, [newLayer]);
        notify(
          `H3 Binning: aggregated ${res.total_points} points into ${res.cell_count} hexagons (Res ${h3Resolution})`,
        );
      } else {
        notify("H3 aggregation produced no hexagonal cells");
      }
    } catch (err) {
      notify(`H3 aggregation error: ${err}`);
    } finally {
      setH3Loading(false);
    }
  };

  if (!layer) {
    return (
      <PanelShell
        eyebrow="Layer"
        title="Properties"
        onClose={closePanel}
      >
        <EmptyState
          icon={<Palette size={22} strokeWidth={1.4} aria-hidden="true" />}
          title="No layer selected. Pick one from the Datasets panel."
        />
      </PanelShell>
    );
  }

  const info = crsInfo(layer.crs);
  const formatTotals = measures
    ? [
      measures.counts.line
        ? `${measures.counts.line} line${measures.counts.line === 1 ? "" : "s"} · ${formatDistance(measures.lengthMeters)}`
        : null,
      measures.counts.polygon
        ? `${measures.counts.polygon} area${measures.counts.polygon === 1 ? "" : "s"} · ${formatArea(measures.areaSquareMeters)}`
        : null,
    ].filter(Boolean)
    : [];

  return (
    <PanelShell
      eyebrow="Layer"
      title="Properties"
      onClose={closePanel}
      footer={
        <>
          <span>{layer.format.toUpperCase()}</span>
          <span className="truncate">{layer.source ?? "in memory"}</span>
        </>
      }
    >
      <NameField layer={layer} />

      <SectionLabel>Summary</SectionLabel>
      <div className="flex flex-col gap-[7px]">
        <KeyValue
          label="Dataset"
          value={
            datasets.find((dataset) => dataset.id === layer.datasetId)?.name ??
            "—"
          }
        />
        <KeyValue
          label="Features"
          value={
            hasActiveFilters(layer) ?
              `${formatCount(shown.length)} of ${formatCount(layer.features.length)}`
            : formatCount(layer.features.length)
          }
        />
        <KeyValue label="Geometry" value={layer.geometryKind} />
        <KeyValue label="Fields" value={`${layer.fields.length}`} />
        <KeyValue
          label="Extent"
          value={
            <code className="font-mono text-[9px]">
              {formatExtent(layer.extent, layer.crs)}
            </code>
          }
        />
        {formatTotals.length ? (
          <KeyValue label="Totals" value={formatTotals.join(" · ")} />
        ) : null}
      </div>

      <SectionLabel trailing={info?.units === "degree" ? "degrees" : "metres"}>
        Projection
      </SectionLabel>
      <select
        value={layer.crs}
        aria-label="Layer coordinate reference system"
        className={FIELD_INPUT}
        onChange={(event) => {
          const next = event.currentTarget.value;
          const dropped = setLayerCrs(layer.id, next);

          notify(
            dropped
              ? `Reprojected “${layer.name}” to ${next} · ${dropped} feature${dropped === 1 ? "" : "s"} fell outside the projection`
              : `Reprojected “${layer.name}” to ${next}`,
          );
        }}
      >
        <optgroup label="Common">
          {listCrs()
            .filter((definition) => definition.builtin && definition.code.length <= 10)
            .map((definition) => (
              <option key={definition.code} value={definition.code}>
                {definition.code} · {definition.name}
              </option>
            ))}
        </optgroup>
        <optgroup label="All registered">
          {listCrs().map((definition) => (
            <option key={definition.code} value={definition.code}>
              {definition.code} · {definition.name}
            </option>
          ))}
        </optgroup>
      </select>
      <p className="mb-0 mt-1.5 text-[9.5px] leading-[1.5] text-ink-muted">
        Changing the projection reprojects the stored coordinates and recomputes
        the extent; data outside the projection&apos;s domain is dropped and
        reported. The map stays in {`EPSG:3857`} because the basemaps are Web
        Mercator.
      </p>

      <FilterSection layer={layer} />

      <SectionLabel>Style</SectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Use ${color}`}
            aria-pressed={layer.style.color === color}
            className="size-[17px] rounded-[5px] border transition-transform active:scale-95"
            style={{
              backgroundColor: color,
              borderColor:
                layer.style.color === color ? "var(--text)" : "transparent",
            }}
            onClick={() => setLayerStyle(layer.id, { color })}
          />
        ))}
      </div>

      <div className="mt-2.5 flex flex-col gap-1.5">
        <Slider
          label="Stroke"
          value={layer.style.strokeWidth}
          min={0.5}
          max={8}
          step={0.1}
          suffix=" px"
          onChange={(strokeWidth) => setLayerStyle(layer.id, { strokeWidth })}
        />
        <Slider
          label="Point"
          value={layer.style.pointRadius}
          min={1}
          max={14}
          step={0.5}
          suffix=" px"
          onChange={(pointRadius) => setLayerStyle(layer.id, { pointRadius })}
        />
        <Slider
          label="Fill"
          value={Math.round(layer.style.fillOpacity * 100)}
          min={0}
          max={80}
          step={1}
          suffix="%"
          onChange={(value) => setLayerStyle(layer.id, { fillOpacity: value / 100 })}
        />
      </div>

      <label className="mt-2 flex flex-col gap-1">
        <span className="font-mono text-[8px] uppercase tracking-[0.08em] text-ink-muted">
          Label field
        </span>
        <select
          value={layer.style.labelField ?? ""}
          className={FIELD_INPUT}
          onChange={(event) =>
            setLayerStyle(layer.id, {
              labelField: event.currentTarget.value || null,
            })
          }
        >
          <option value="">No labels</option>
          {layer.fields.map((field) => (
            <option key={field.name} value={field.name}>
              {field.name}
            </option>
          ))}
        </select>
      </label>

      {isPointLayer && (
        <div className="mt-3.5 flex flex-col gap-2 rounded-lg border border-line bg-tint/40 p-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] font-semibold text-ink">
              H3 Hexagonal Binning
            </span>
            <span className="font-mono text-[9px] text-accent font-semibold">
              Res {h3Resolution} ({H3_RES_DESCRIPTIONS[h3Resolution] ?? ""})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={2}
              max={10}
              step={1}
              value={h3Resolution}
              onChange={(e) => setH3Resolution(parseInt(e.target.value, 10))}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-line accent-accent"
              aria-label="H3 resolution"
            />
            <span className="font-mono text-[10px] text-ink font-semibold w-5 text-right">
              {h3Resolution}
            </span>
          </div>
          <button
            type="button"
            className={cx(PRIMARY_BUTTON, "h-7 text-[10.5px] justify-center")}
            disabled={h3Loading}
            onClick={handleH3Aggregation}
          >
            {h3Loading ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Binning points...
              </>
            ) : (
              <>
                <Hexagon size={13} strokeWidth={1.9} />
                Aggregate into H3 Hexagons
              </>
            )}
          </button>
        </div>
      )}

      <div className="mt-3.5 grid grid-cols-[1fr_auto] gap-1.5">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          onClick={() => zoomToLayer(layer.id)}
        >
          <Crosshair size={13} strokeWidth={1.9} aria-hidden="true" />
          Zoom to layer
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          title="Reset styling"
          aria-label="Reset styling"
          onClick={() =>
            setLayerStyle(layer.id, {
              color: PALETTE[0],
              strokeWidth: 1.8,
              pointRadius: 4.5,
              fillOpacity: 0.22,
              labelField: null,
            })
          }
        >
          <RotateCcw size={13} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          className={SECONDARY_BUTTON}
          onClick={() =>
            void exportLayerAs(layer.id, "geojson")
              .then((saved) => saved && notify("GeoJSON exported"))
              .catch((error) => notify(describeError(error)))
          }
        >
          <Download size={13} strokeWidth={1.9} aria-hidden="true" />
          GeoJSON
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          onClick={() =>
            void exportLayerAs(layer.id, "csv")
              .then((saved) => saved && notify("CSV exported"))
              .catch((error) => notify(describeError(error)))
          }
        >
          <Download size={13} strokeWidth={1.9} aria-hidden="true" />
          CSV
        </button>
      </div>

      <button
        type="button"
        className={`${SECONDARY_BUTTON} mt-1.5 w-full hover:border-[var(--warn)] hover:text-[var(--warn)]`}
        onClick={() => {
          removeLayer(layer.id);
          closePanel();
          notify(`Removed “${layer.name}”`);
        }}
      >
        <Trash2 size={13} strokeWidth={1.9} aria-hidden="true" />
        Remove layer
      </button>

      <InfoNote>
        Exports write WGS 84 GeoJSON (RFC 7946) and CSV carrying the layer's own
        coordinates. Style, projection and filters travel with the layer in the
        project file. A filter narrows what the map and table show; it does not
        change the stored features or the files written by the export buttons.
      </InfoNote>
    </PanelShell>
  );
}
