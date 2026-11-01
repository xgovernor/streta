import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Crosshair,
  Database,
  FileUp,
  Grid3x3,
  Table2,
  Trash2,
} from "lucide-react";
import { zoomToLayer } from "../../map/mapController";
import { BASEMAPS } from "../../lib/gis/data";
import { cx } from "../../lib/cx";
import { formatCount } from "../../lib/format";
import { GEOGRAPHIC_CRS } from "../../lib/gis/crs";
import { groupLayers } from "../../lib/gis/datasets";
import {
  LIBRARY,
  libraryProduct,
  loadLibraryProduct,
} from "../../lib/gis/library";
import type { LibraryProduct } from "../../lib/gis/library";
import {
  isTauriEnvironment,
  registerGeoJsonWithRust,
} from "../../lib/gis/tiledBackend";
import {
  describeError,
  exportLayerAs,
  importDatasetFiles,
  reloadRecentLayer,
} from "../../lib/projectFile";
import { useProjectStore } from "../../state/projectStore";
import { useTelemetryStore } from "../../state/telemetryStore";
import { useUiStore } from "../../state/uiStore";
import { PanelShell } from "../PanelShell";
import { LiveFeedsSection } from "./LiveFeedsSection";
import { RasterDatasetsSection } from "./RasterDatasetsSection";
import {
  EmptyState,
  ICON_BUTTON,
  LayerSwatch,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SectionLabel,
  Switch,
} from "./shared";

const DATASET_KIND_LABEL: Record<string, string> = {
  file: "file",
  library: "library",
  sample: "sample",
  join: "join",
};

const STEP_BUTTON =
  "grid h-[11px] w-4 place-items-center rounded-[2px] text-ink-muted transition-colors hover:bg-tint hover:text-ink disabled:opacity-30";

/** The dataset name edits in place, like a layer's does in its properties. */
function DatasetNameField({ id, name }: { id: string; name: string }) {
  const renameDataset = useProjectStore((state) => state.renameDataset);
  const [draft, setDraft] = useState(name);

  useEffect(() => {
    setDraft(name);
  }, [id, name]);

  const commit = () => {
    if (draft.trim() && draft !== name) {
      renameDataset(id, draft);
    } else {
      setDraft(name);
    }
  };

  return (
    <input
      value={draft}
      aria-label="Dataset name"
      className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-[11.5px] font-semibold text-ink outline-none placeholder:text-ink-muted focus:underline"
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

/**
 * One panel for the workspace: the catalogue of what can be loaded, the
 * datasets that are loaded, and the stack each one owns. Composition and
 * loading were two tabs over the same object, which meant looking in two
 * places to answer one question.
 */
export function DatasetsPanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const openPanel = useUiStore((state) => state.openPanel);
  const notify = useUiStore((state) => state.notify);
  const basemapId = useUiStore((state) => state.basemap);
  const graticule = useUiStore((state) => state.graticule);
  const setGraticule = useUiStore((state) => state.setGraticule);

  const datasets = useProjectStore((state) => state.datasets);
  const layers = useProjectStore((state) => state.layers);
  const recent = useProjectStore((state) => state.recent);
  const activeLayerId = useProjectStore((state) => state.activeLayerId);
  const setActiveLayer = useProjectStore((state) => state.setActiveLayer);
  const addDataset = useProjectStore((state) => state.addDataset);
  const removeDataset = useProjectStore((state) => state.removeDataset);
  const removeLayer = useProjectStore((state) => state.removeLayer);
  const forgetRecent = useProjectStore((state) => state.forgetRecent);
  const moveDataset = useProjectStore((state) => state.moveDataset);
  const moveLayer = useProjectStore((state) => state.moveLayer);
  const setDatasetVisible = useProjectStore((state) => state.setDatasetVisible);
  const setLayerVisible = useProjectStore((state) => state.setLayerVisible);
  const setLayerOpacity = useProjectStore((state) => state.setLayerOpacity);
  const toggleDataset = useProjectStore((state) => state.toggleDataset);
  const [busy, setBusy] = useState(false);

  const basemap = BASEMAPS.find((item) => item.id === basemapId);
  const featureCount = layers.reduce(
    (total, layer) => total + layer.features.length,
    0,
  );
  const flightsCount = useTelemetryStore((state) => state.flightsEnabled ? state.flights.length : 0);
  const earthquakesCount = useTelemetryStore((state) => state.earthquakesEnabled ? state.earthquakes.length : 0);
  const satellitesCount = useTelemetryStore((state) => state.satellitesEnabled ? state.satellites.length : 0);
  const activeLiveCount = flightsCount + earthquakesCount + satellitesCount;
  // Top of the stack first, as the map composites it.
  const groups = groupLayers(datasets, layers).reverse();

  const importFile = async () => {
    setBusy(true);

    try {
      const summary = await importDatasetFiles();

      if (!summary) {
        return;
      }

      const features = summary.outcomes.reduce(
        (total, outcome) => total + outcome.featureCount,
        0,
      );
      const imported = new Set(
        summary.outcomes.map((outcome) => outcome.dataset.id),
      );

      notify(
        `Imported ${formatCount(features)} features into ${imported.size} dataset${imported.size === 1 ? "" : "s"}`,
      );

      // The toast shows one line; the console keeps the rest.
      const messages = [
        ...summary.outcomes.flatMap((outcome) => outcome.warnings),
        ...summary.failures,
      ];

      if (messages.length) {
        console.warn("Import warnings", messages);
        notify(messages[0]);
      }
    } catch (error) {
      notify(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const addFromLibrary = async (product: LibraryProduct) => {
    setBusy(true);

    try {
      const results = await loadLibraryProduct(product);
      const isTauri = isTauriEnvironment();

      const layerInputs = await Promise.all(
        results.map(async (result, idx) => {
          const layerId = `${product.id}_${idx}_${Date.now().toString(36)}`;
          let tileUrl: string | undefined = undefined;
          let format = result.format ?? "geojson";

          if (isTauri) {
            const registered = await registerGeoJsonWithRust(
              layerId,
              result.features,
            );
            if (registered?.success) {
              tileUrl = registered.tileUrl;
              format = "mvt";
            }
          }

          return {
            id: layerId,
            name: result.name ?? product.name,
            features: result.features,
            crs: result.crs ?? GEOGRAPHIC_CRS,
            format,
            tileUrl,
            source: `${product.id}:${result.name ?? "layer"}`,
          };
        }),
      );

      const { dataset, layers: created } = addDataset({
        name: product.name,
        kind: "library",
        layers: layerInputs,
      });

      const isMvt = created.some((l) => l.format === "mvt");
      notify(
        created.length === 1 ?
          `Added “${dataset.name}” · ${formatCount(created[0].features.length)} features${isMvt ? " (Vector Tiles)" : ""}`
          : `Added “${dataset.name}” · ${created.length} layers${isMvt ? " (Vector Tiles)" : ""}`,
      );
    } catch (error) {
      notify(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const reload = async (source: string, name: string) => {
    // A library product is fetched again rather than re-read from a path.
    if (source.startsWith("library:")) {
      const product = libraryProduct(source.slice("library:".length));

      if (product) {
        await addFromLibrary(product);
        return;
      }
    }

    setBusy(true);

    try {
      const outcome = await reloadRecentLayer(source, name);

      if (outcome) {
        notify(`Reloaded “${name}”`);
        return;
      }

      notify(`Re-select ${name} to load it again`);
      await importFile();
    } catch (error) {
      notify(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const exportAs = async (
    id: string,
    name: string,
    format: "geojson" | "csv",
  ) => {
    try {
      const saved = await exportLayerAs(id, format);
      if (saved) {
        notify(`Exported “${name}” as ${format.toUpperCase()}`);
      }
    } catch (error) {
      notify(describeError(error));
    }
  };

  return (
    <PanelShell
      eyebrow="Workspace"
      title="Datasets"
      onClose={closePanel}
      footer={
        <>
          <span>
            Basemap · {basemap?.name ?? "—"}{" "}
            <button
              type="button"
              className="text-[10px] font-semibold tracking-[0.02em] text-accent hover:underline"
              onClick={() => openPanel("basemaps")}
            >
              Change
            </button>
          </span>
          <span>
            {groups.length} dataset{groups.length === 1 ? "" : "s"} ·{" "}
            {layers.length} layer{layers.length === 1 ? "" : "s"} ·{" "}
            {formatCount(featureCount + activeLiveCount)} features
            {activeLiveCount > 0 ? ` (${formatCount(activeLiveCount)} live)` : ""}
          </span>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_auto] gap-1.5">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          disabled={busy}
          onClick={() => void importFile()}
        >
          <FileUp size={13} strokeWidth={1.9} aria-hidden="true" />
          Open datasets
        </button>
      </div>

      <LiveFeedsSection />

      <RasterDatasetsSection />

      <SectionLabel trailing="Loaded on demand">Dataset library</SectionLabel>
      <div className="flex flex-col gap-1.5">
        {LIBRARY.map((product) => (
          <div
            key={product.id}
            className="flex items-center gap-2 rounded-[2px] border border-line bg-tint p-2"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <strong className="truncate text-[11px] font-semibold">
                {product.name}
              </strong>
              <span className="truncate text-[9.5px] text-ink-muted">
                {product.detail}
                {product.layers.length > 1 ?
                  ` · ${product.layers.length} layers`
                  : ""}
              </span>
              <span className="truncate font-mono text-[8.5px] uppercase tracking-[0.06em] text-ink-muted">
                {product.credit}
              </span>
            </span>
            <button
              type="button"
              className={SECONDARY_BUTTON}
              disabled={busy}
              onClick={() => void addFromLibrary(product)}
            >
              Add
            </button>
          </div>
        ))}
      </div>

      {groups.length ? (
        <>
          <SectionLabel trailing="Top draws last">Datasets and layers</SectionLabel>
          <div className="flex flex-col gap-2">
            {groups.map((group, groupIndex) => {
              const shown = group.layers.filter((layer) => layer.visible).length;
              const total = group.layers.reduce(
                (sum, layer) => sum + layer.features.length,
                0,
              );
              const atTop = groupIndex === 0;
              const atBottom = groupIndex === groups.length - 1;

              return (
                <div
                  key={group.dataset.id}
                  className="rounded-[2px] border border-line-strong bg-raised p-2"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="flex flex-none flex-col">
                      <button
                        type="button"
                        className={STEP_BUTTON}
                        title="Move dataset up"
                        aria-label={`Move ${group.dataset.name} up`}
                        disabled={atTop}
                        onClick={() => moveDataset(group.dataset.id, 1)}
                      >
                        <ChevronUp size={11} strokeWidth={2.2} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={STEP_BUTTON}
                        title="Move dataset down"
                        aria-label={`Move ${group.dataset.name} down`}
                        disabled={atBottom}
                        onClick={() => moveDataset(group.dataset.id, -1)}
                      >
                        <ChevronDown
                          size={11}
                          strokeWidth={2.2}
                          aria-hidden="true"
                        />
                      </button>
                    </span>

                    <button
                      type="button"
                      className="grid size-5 flex-none place-items-center rounded-[2px] text-ink-muted transition-colors hover:bg-tint hover:text-ink"
                      aria-expanded={!group.dataset.collapsed}
                      aria-label={`${group.dataset.collapsed ? "Expand" : "Collapse"} ${group.dataset.name}`}
                      onClick={() => toggleDataset(group.dataset.id)}
                    >
                      {group.dataset.collapsed ?
                        <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
                        : <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />}
                    </button>

                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <DatasetNameField
                        id={group.dataset.id}
                        name={group.dataset.name}
                      />
                      <span className="truncate font-mono text-[9px] text-ink-muted">
                        {DATASET_KIND_LABEL[group.dataset.kind] ?? "data"} ·{" "}
                        {group.layers.length} layer
                        {group.layers.length === 1 ? "" : "s"} ·{" "}
                        {formatCount(total)} features · {shown}/
                        {group.layers.length} shown
                      </span>
                    </span>

                    <button
                      type="button"
                      className={ICON_BUTTON}
                      title="Remove dataset"
                      aria-label={`Remove ${group.dataset.name} and its layers`}
                      onClick={() => {
                        removeDataset(group.dataset.id);
                        notify(`Removed “${group.dataset.name}”`);
                      }}
                    >
                      <Trash2 size={12} strokeWidth={1.9} aria-hidden="true" />
                    </button>

                    <Switch
                      checked={group.layers.some((layer) => layer.visible)}
                      label={`Toggle every layer in ${group.dataset.name}`}
                      onChange={() =>
                        setDatasetVisible(
                          group.dataset.id,
                          !group.layers.some((layer) => layer.visible),
                        )
                      }
                    />
                  </div>

                  {group.dataset.collapsed ? null : (
                    <div className="mt-2 flex flex-col gap-1.5 border-t border-line pt-2">
                      {[...group.layers].reverse().map((layer, index) => {
                        const active = layer.id === activeLayerId;
                        const layerAtTop = index === 0;
                        const layerAtBottom =
                          index === group.layers.length - 1;

                        return (
                          <div
                            key={layer.id}
                            className={cx(
                              "rounded-[2px] border p-1.5 transition-colors",
                              layer.visible ?
                                "border-line bg-tint"
                                : "border-transparent bg-shell-2 opacity-70",
                              active && "border-accent-line",
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span className="flex flex-none flex-col">
                                <button
                                  type="button"
                                  className={STEP_BUTTON}
                                  title="Move up"
                                  aria-label={`Move ${layer.name} up`}
                                  disabled={layerAtTop}
                                  onClick={() => moveLayer(layer.id, 1)}
                                >
                                  <ChevronUp
                                    size={11}
                                    strokeWidth={2.2}
                                    aria-hidden="true"
                                  />
                                </button>
                                <button
                                  type="button"
                                  className={STEP_BUTTON}
                                  title="Move down"
                                  aria-label={`Move ${layer.name} down`}
                                  disabled={layerAtBottom}
                                  onClick={() => moveLayer(layer.id, -1)}
                                >
                                  <ChevronDown
                                    size={11}
                                    strokeWidth={2.2}
                                    aria-hidden="true"
                                  />
                                </button>
                              </span>

                              <LayerSwatch color={layer.style.color} />

                              <button
                                type="button"
                                className="flex min-w-0 flex-1 flex-col gap-px text-left"
                                onClick={() => {
                                  setActiveLayer(layer.id);
                                  openPanel("layer");
                                }}
                              >
                                <strong className="truncate text-[11px] font-semibold">
                                  {layer.name}
                                </strong>
                                <span className="truncate font-mono text-[8.5px] text-ink-muted">
                                  {formatCount(layer.features.length)} feature
                                  {layer.features.length === 1 ? "" : "s"} ·{" "}
                                  {layer.crs} · {layer.geometryKind}
                                </span>
                              </button>

                              <Switch
                                checked={layer.visible}
                                label={`Toggle ${layer.name}`}
                                onChange={() =>
                                  setLayerVisible(layer.id, !layer.visible)
                                }
                              />
                            </div>

                            {layer.visible ? (
                              <div className="mt-1.5 flex items-center gap-2 border-t border-line pt-1.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-muted">
                                <span>Opacity</span>
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  step="1"
                                  value={Math.round(layer.opacity * 100)}
                                  aria-label={`${layer.name} opacity`}
                                  className="opacity-range m-0 flex-1"
                                  onChange={(event) =>
                                    setLayerOpacity(
                                      layer.id,
                                      Number(event.currentTarget.value) / 100,
                                    )
                                  }
                                />
                                <span className="min-w-7 text-right text-ink-soft">
                                  {Math.round(layer.opacity * 100)}%
                                </span>
                              </div>
                            ) : null}

                            <div className="mt-1 flex items-center gap-1">
                              <button
                                type="button"
                                className={ICON_BUTTON}
                                title="Zoom to layer"
                                aria-label={`Zoom to ${layer.name}`}
                                onClick={() => {
                                  setActiveLayer(layer.id);
                                  zoomToLayer(layer.id);
                                }}
                              >
                                <Crosshair
                                  size={12}
                                  strokeWidth={1.9}
                                  aria-hidden="true"
                                />
                              </button>
                              <button
                                type="button"
                                className={ICON_BUTTON}
                                title="Attribute table"
                                aria-label={`Open the attribute table for ${layer.name}`}
                                onClick={() => {
                                  setActiveLayer(layer.id);
                                  openPanel("table");
                                }}
                              >
                                <Table2
                                  size={12}
                                  strokeWidth={1.9}
                                  aria-hidden="true"
                                />
                              </button>

                              <span className="flex-1" />

                              <button
                                type="button"
                                className="px-1 text-[9.5px] font-semibold text-ink-muted transition-colors hover:text-ink"
                                onClick={() =>
                                  void exportAs(layer.id, layer.name, "geojson")
                                }
                              >
                                GeoJSON
                              </button>
                              <button
                                type="button"
                                className="px-1 text-[9.5px] font-semibold text-ink-muted transition-colors hover:text-ink"
                                onClick={() =>
                                  void exportAs(layer.id, layer.name, "csv")
                                }
                              >
                                CSV
                              </button>
                              <button
                                type="button"
                                className={ICON_BUTTON}
                                title="Remove layer"
                                aria-label={`Remove ${layer.name}`}
                                onClick={() => {
                                  removeLayer(layer.id);
                                  notify(`Removed “${layer.name}”`);
                                }}
                              >
                                <Trash2
                                  size={12}
                                  strokeWidth={1.9}
                                  aria-hidden="true"
                                />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <EmptyState
          icon={<Database size={22} strokeWidth={1.4} aria-hidden="true" />}
          title="No datasets loaded. Open a file, add one from the library, or start from the bundled sample."
        />
      )}        {recent.length ? (
        <>
          <SectionLabel trailing="Too large to keep">Previous session</SectionLabel>
          <div className="flex flex-col gap-px">
            {recent.map((entry) => (
              <div
                key={`${entry.name}-${entry.featureCount}`}
                className="flex items-center gap-2 rounded-[2px] px-1.5 py-[7px]"
              >
                <LayerSwatch color={entry.color} />
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <strong className="truncate text-[11px] font-semibold">
                    {entry.name}
                  </strong>
                  <span className="truncate font-mono text-[9px] text-ink-muted">
                    {formatCount(entry.featureCount)} features · {entry.crs}
                  </span>
                </span>
                <button
                  type="button"
                  className="px-1 text-[9.5px] font-semibold text-accent transition-opacity hover:opacity-80"
                  onClick={() => void reload(entry.source, entry.name)}
                >
                  Reload
                </button>
                <button
                  type="button"
                  className={ICON_BUTTON}
                  title="Forget"
                  aria-label={`Forget ${entry.name}`}
                  onClick={() => forgetRecent(entry.name)}
                >
                  <Trash2 size={12} strokeWidth={1.9} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <SectionLabel>Reference</SectionLabel>
      <div className="flex items-center gap-2 rounded-[2px] border border-line bg-tint p-2">
        <span className="grid size-[26px] flex-none place-items-center rounded-[2px] bg-tint text-ink-muted">
          <Grid3x3 size={15} strokeWidth={1.7} aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <strong className="text-[11.5px] font-semibold">Graticule</strong>
          <span className="text-[9.5px] text-ink-muted">
            30° reference grid · EPSG:4326
          </span>
        </span>
        <Switch
          checked={graticule}
          label="Toggle graticule"
          onChange={() => setGraticule(!graticule)}
        />
      </div>
    </PanelShell>
  );
}
