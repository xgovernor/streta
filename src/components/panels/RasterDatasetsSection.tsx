import { useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  FolderOpen,
  Layers,
  Loader2,
  MapPin,
  Mountain,
} from "lucide-react";
import {
  flyToCoordinate,
  getActiveRasterBinding,
  getViewportBbox,
  mountRasterLayer,
  onRasterProbe,
  sampleDemGrid,
  setRasterContrast,
  setRasterFormula,
  setRasterOpacity,
  unmountRasterLayer,
} from "../../map/mapController";
import {
  type PixelProbeData,
  type RasterFormula,
  type RasterLayerConfig,
} from "../../map/rasterLayer";
import {
  generateContours,
  getCogPresetsFromRust,
  registerCogLayerWithRust,
  type CogPresetInfo,
} from "../../lib/gis/tiledBackend";
import { uniqueDatasetName } from "../../lib/gis/datasets";
import { uniqueLayerName } from "../../lib/gis/layers";
import { GEOGRAPHIC_CRS } from "../../lib/gis/crs";
import type { FeatureRecord } from "../../lib/gis/types";
import { useProjectStore } from "../../state/projectStore";
import { cx } from "../../lib/cx";
import { useUiStore } from "../../state/uiStore";
import {
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SectionLabel,
  Switch,
} from "./shared";


interface FormulaMeta {
  id: RasterFormula;
  name: string;
  math: string;
  description: string;
  gradient: string;
  ticks: { pos: string; label: string }[];
}

const FORMULAS: FormulaMeta[] = [
  {
    id: "NDVI",
    name: "NDVI",
    math: "(B08 - B04) / (B08 + B04 + 1e-6)",
    description: "Normalized Difference Vegetation Index. Monitors plant health and canopy density.",
    gradient: "linear-gradient(to right, #0c2c84 0%, #ffffcc 20%, #c2e699 40%, #78c679 60%, #31a354 80%, #006837 100%)",
    ticks: [
      { pos: "0%", label: "-0.2 Water" },
      { pos: "20%", label: "0.0 Rock" },
      { pos: "60%", label: "0.4 Shrub" },
      { pos: "100%", label: "0.8+ Canopy" },
    ],
  },
  {
    id: "NDWI",
    name: "NDWI",
    math: "(B03 - B08) / (B03 + B08 + 1e-6)",
    description: "Normalized Difference Water Index. Delineates open water bodies and surface moisture.",
    gradient: "linear-gradient(to right, #8c510a 0%, #dfc27d 25%, #f5f5f5 45%, #80cdc1 65%, #35978f 85%, #01665e 100%)",
    ticks: [
      { pos: "0%", label: "-0.5 Land" },
      { pos: "45%", label: "0.0 Coast" },
      { pos: "65%", label: "0.1 Shallow" },
      { pos: "100%", label: "0.6 Deep Water" },
    ],
  },
  {
    id: "NDBI",
    name: "NDBI",
    math: "(B11 - B08) / (B11 + B08 + 1e-6)",
    description: "Normalized Difference Built-up Index. Highlights urban density and impervious surfaces.",
    gradient: "linear-gradient(to right, #1a9850 0%, #91cf60 25%, #ffffbf 45%, #fee08b 60%, #fc8d59 80%, #d73027 100%)",
    ticks: [
      { pos: "0%", label: "-0.6 Vegetation" },
      { pos: "45%", label: "0.0 Soil" },
      { pos: "60%", label: "0.15 Suburban" },
      { pos: "100%", label: "0.6 Concrete" },
    ],
  },
  {
    id: "NBR",
    name: "NBR",
    math: "(B08 - B12) / (B08 + B12 + 1e-6)",
    description: "Normalized Burn Ratio. Assesses wildfire scars and post-fire burn severity.",
    gradient: "linear-gradient(to right, #49006a 0%, #ae017e 20%, #f768a1 40%, #fa9fb5 60%, #78c679 80%, #006837 100%)",
    ticks: [
      { pos: "0%", label: "-0.4 High Burn" },
      { pos: "20%", label: "-0.1 Mod Burn" },
      { pos: "40%", label: "0.1 Low Burn" },
      { pos: "100%", label: "0.7 Healthy" },
    ],
  },
  {
    id: "CIR",
    name: "CIR (False Color)",
    math: "R: B08 (NIR) | G: B04 (Red) | B: B03 (Green)",
    description: "Color Infrared composite. Photosynthetic vegetation reflects as vibrant red.",
    gradient: "linear-gradient(to right, #000000 0%, #1e3a8a 30%, #ef4444 70%, #b91c1c 100%)",
    ticks: [
      { pos: "0%", label: "Water" },
      { pos: "30%", label: "Urban" },
      { pos: "70%", label: "Vegetation" },
      { pos: "100%", label: "Dense Biomass" },
    ],
  },
  {
    id: "RGB",
    name: "Natural RGB",
    math: "R: B04 (Red) | G: B03 (Green) | B: B02 (Blue)",
    description: "Natural True Color RGB composite matching human visual perception.",
    gradient: "linear-gradient(to right, #1e3a8a 0%, #3b82f6 30%, #22c55e 60%, #eab308 85%, #ffffff 100%)",
    ticks: [
      { pos: "0%", label: "Water" },
      { pos: "60%", label: "Forest" },
      { pos: "85%", label: "Desert" },
      { pos: "100%", label: "Cloud" },
    ],
  },
  {
    id: "Elevation",
    name: "DEM Relief",
    math: "Single Band: Elevation in meters (MSL)",
    description: "30-meter global elevation model with hypsometric terrain relief coloring.",
    gradient: "linear-gradient(to right, #023858 0%, #045a8d 10%, #41b6c4 25%, #78c679 45%, #c2e699 65%, #fe9929 80%, #d95f0e 92%, #ffffff 100%)",
    ticks: [
      { pos: "0%", label: "Sea Level" },
      { pos: "25%", label: "100m" },
      { pos: "65%", label: "1000m" },
      { pos: "100%", label: "4000m Peak" },
    ],
  },
];

export function RasterDatasetsSection() {
  const notify = useUiStore((state) => state.notify);
  const [presets, setPresets] = useState<CogPresetInfo[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeFormula, setActiveFormula] = useState<RasterFormula>("NDVI");
  const [opacity, setOpacity] = useState<number>(0.92);
  const [contrastScale, setContrastScale] = useState<number>(1.0 / 3000.0);
  const [probeData, setProbeData] = useState<PixelProbeData | null>(null);

  useEffect(() => {
    getCogPresetsFromRust()
      .then((p) => {
        setPresets(p);
      })
      .catch((err) => {
        console.warn("Failed to fetch COG presets from Rust:", err);
      });

    const active = getActiveRasterBinding();
    if (active) {
      setActiveLayerId(active.config.layerId);
      setExpandedId(active.config.layerId);
      setActiveFormula(active.formula);
    }

    onRasterProbe((probe) => {
      setProbeData(probe);
    });

    return () => {
      onRasterProbe(null);
    };
  }, []);

  const togglePresetLayer = (preset: CogPresetInfo) => {
    if (activeLayerId === preset.id) {
      unmountRasterLayer();
      setActiveLayerId(null);
      setProbeData(null);
      notify(`Unmounted ${preset.name}`);
      return;
    }

    // Strict strata://cog routing
    const bands: Record<string, string> = {};
    for (const b of preset.bands) {
      bands[b] = `strata://cog/${preset.id}/${b}`;
    }

    const defaultFormula: RasterFormula =
      preset.kind === "multispectral" ? "NDVI" : "Elevation";

    const config: RasterLayerConfig = {
      layerId: preset.id,
      name: preset.name,
      kind: preset.kind,
      bands,
      initialFormula: defaultFormula,
      opacity,
      contrastScale,
    };

    try {
      mountRasterLayer(config);
      setActiveLayerId(preset.id);
      setExpandedId(preset.id);
      setActiveFormula(defaultFormula);
      flyToCoordinate(preset.center[0], preset.center[1], preset.zoom);
      notify(`Mounted ${preset.name} via strata://cog`);
    } catch (err: any) {
      notify(`Error mounting raster: ${err.message}`);
    }
  };

  const handleFormulaSelect = (formula: RasterFormula) => {
    setActiveFormula(formula);
    setRasterFormula(formula);
  };

  const handleOpacitySlider = (val: number) => {
    setOpacity(val);
    setRasterOpacity(val);
  };

  const handleContrastSlider = (val: number) => {
    setContrastScale(val);
    setRasterContrast(val);
  };

  const handleOpenLocalCog = async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: "Cloud-Optimized GeoTIFF", extensions: ["tif", "tiff"] }],
      });

      if (!selected || typeof selected !== "string") return;

      const layerId = `local_cog_${Date.now()}`;
      const name = selected.split(/[\\/]/).pop() || "Local GeoTIFF";

      // Register file with Rust backend over strata://cog
      const res = await registerCogLayerWithRust(layerId, name, {
        elevation: selected,
        B01: selected,
      });

      if (res.success) {
        const customPreset: CogPresetInfo = {
          id: layerId,
          name,
          description: `Local GeoTIFF: ${selected}`,
          kind: "elevation",
          bands: ["elevation"],
          default_formula: "Elevation",
          center: [0, 0],
          zoom: 12,
        };

        setPresets((prev) => [customPreset, ...prev]);

        const config: RasterLayerConfig = {
          layerId,
          name,
          kind: "elevation",
          bands: res.bands,
          initialFormula: "Elevation",
          opacity,
        };

        mountRasterLayer(config);
        setActiveLayerId(layerId);
        setExpandedId(layerId);
        setActiveFormula("Elevation");
        notify(`Registered & mounted ${name} over strata://cog`);
      }
    } catch (err: any) {
      notify(`Failed to open local COG: ${err.message}`);
    }
  };

  const [contourInterval, setContourInterval] = useState<number>(100);
  const [isGeneratingContours, setIsGeneratingContours] = useState<boolean>(false);

  const handleGenerateContours = async (preset: CogPresetInfo) => {
    setIsGeneratingContours(true);
    try {
      const viewBbox = getViewportBbox();
      const bbox: [number, number, number, number] =
        viewBbox &&
        preset.center[0] >= viewBbox[0] &&
        preset.center[0] <= viewBbox[2] &&
        preset.center[1] >= viewBbox[1] &&
        preset.center[1] <= viewBbox[3]
          ? viewBbox
          : [
              preset.center[0] - 0.15,
              preset.center[1] - 0.12,
              preset.center[0] + 0.15,
              preset.center[1] + 0.12,
            ];

      const width = 36;
      const height = 36;
      const values = sampleDemGrid(bbox, width, height);

      const result = await generateContours({
        values,
        width,
        height,
        bbox,
        interval: contourInterval,
        smooth: true,
      });

      if (result && result.geojson?.features?.length > 0) {
        const projectStore = useProjectStore.getState();
        const existingDatasetNames = projectStore.datasets.map((d) => d.name);
        const datasetName = uniqueDatasetName(
          existingDatasetNames,
          `${preset.name} Contours (${contourInterval}m)`,
        );
        const features: FeatureRecord[] = result.geojson.features.map(
          (f: any, idx: number) => ({
            id: f.id || `contour_${idx}`,
            geometry: f.geometry,
            properties: f.properties || {},
          }),
        );

        const existingLayerNames = projectStore.layers.map((l) => l.name);
        const layerName = uniqueLayerName(
          existingLayerNames,
          `Contours ${contourInterval}m`,
        );

        projectStore.addDataset({
          name: datasetName,
          kind: "file",
          source: "derived:contour",
          layers: [
            {
              id: `contour_${Date.now().toString(36)}`,
              name: layerName,
              features,
              crs: GEOGRAPHIC_CRS,
              format: "geojson",
              source: "derived:contour",
            },
          ],
        });
        notify(
          `Generated ${result.feature_count} contour isolines at ${contourInterval}m intervals`,
        );
      } else {
        notify("Contour generation returned no isolines for this area");
      }
    } catch (err: any) {
      notify(`Contour generation error: ${err.message || err}`);
    } finally {
      setIsGeneratingContours(false);
    }
  };

  const activeMeta = FORMULAS.find((f) => f.id === activeFormula) || FORMULAS[0];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <SectionLabel trailing="strata://cog gateway">
          Satellite imagery & terrain
        </SectionLabel>
        <button
          type="button"
          className="flex items-center gap-1 text-[10px] font-semibold text-accent hover:underline"
          onClick={handleOpenLocalCog}
        >
          <FolderOpen size={11} />
          Open .tif
        </button>
      </div>

      {/* Gateway Security Badge */}
      <div className="flex items-center justify-between rounded-lg border border-cyan-500/20 bg-cyan-950/20 px-2.5 py-1 text-[10px]">
        <div className="flex items-center gap-1.5 font-medium text-cyan-300">
          <CheckCircle2 size={12} className="text-cyan-400" />
          Strict <code className="font-mono text-cyan-200">strata://cog</code> Gateway
        </div>
        <span className="font-mono text-[8.5px] text-cyan-400">Zero Direct HTTPS</span>
      </div>

      {/* Presets List */}
      <div className="flex flex-col gap-1.5">
        {presets.map((preset) => {
          const isMounted = activeLayerId === preset.id;
          const isExpanded = expandedId === preset.id;
          const isMulti = preset.kind === "multispectral";

          return (
            <div
              key={preset.id}
              className={cx(
                "flex flex-col rounded-lg border transition-colors",
                isMounted
                  ? "border-accent/40 bg-accent/5"
                  : "border-line bg-tint/60 hover:border-line-hover",
              )}
            >
              {/* Header row */}
              <div className="flex items-center justify-between gap-2 p-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => setExpandedId(isExpanded ? null : preset.id)}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded bg-solid text-accent">
                    {isMulti ? <Layers size={13} /> : <Mountain size={13} />}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-1.5">
                      <strong className="truncate text-[11px] font-semibold text-ink">
                        {preset.name}
                      </strong>
                    </div>
                    <span className="truncate text-[9.5px] text-ink-muted">
                      {isMulti ? "6-Band Multispectral Sentinel-2 L2A" : "30m Digital Elevation Model"}
                    </span>
                  </div>
                </button>

                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={isMounted}
                    label={`Toggle ${preset.name}`}
                    onChange={() => togglePresetLayer(preset)}
                  />
                  <button
                    type="button"
                    className="text-ink-muted hover:text-ink p-0.5"
                    aria-label={isExpanded ? "Collapse" : "Expand"}
                    onClick={() => setExpandedId(isExpanded ? null : preset.id)}
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                </div>
              </div>

              {/* Expanded details & controls */}
              {isExpanded && (
                <div className="flex flex-col gap-2.5 border-t border-line/60 p-2.5 bg-tint/40 text-[10px]">
                  <p className="text-[9.5px] leading-relaxed text-ink-muted">
                    {preset.description}
                  </p>

                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[9px] text-ink-muted">
                      {preset.bands.join(", ")}
                    </span>
                    <button
                      type="button"
                      className={cx(SECONDARY_BUTTON, "h-6 px-2 text-[10px]")}
                      onClick={() => flyToCoordinate(preset.center[0], preset.center[1], preset.zoom)}
                    >
                      <MapPin size={11} />
                      Fly to Scene
                    </button>
                  </div>

                  {isMounted && (
                    <>
                      {/* Formula Selector */}
                      {isMulti && (
                        <div className="flex flex-col gap-1.5">
                          <span className="font-semibold text-ink text-[10px]">
                            Shader Index Formula:
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {FORMULAS.filter((f) => f.id !== "Elevation").map((f) => {
                              const isActive = activeFormula === f.id;
                              return (
                                <button
                                  key={f.id}
                                  type="button"
                                  className={cx(
                                    "rounded px-2 py-0.5 text-[9.5px] font-semibold transition-all border",
                                    isActive
                                      ? "border-accent bg-accent text-white shadow-sm"
                                      : "border-line bg-solid text-ink-muted hover:text-ink",
                                  )}
                                  onClick={() => handleFormulaSelect(f.id)}
                                >
                                  {f.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Active Formula Explanation & Gradient Ramp */}
                      <div className="flex flex-col gap-1 rounded border border-line bg-solid/80 p-2">
                        <div className="flex items-center justify-between font-mono text-[9px]">
                          <span className="font-bold text-ink">{activeMeta.name}</span>
                          <span className="text-accent">{activeMeta.math}</span>
                        </div>
                        <div
                          className="h-2 w-full rounded border border-line"
                          style={{ background: activeMeta.gradient }}
                        />
                        <div className="flex justify-between text-[8px] font-mono text-ink-muted">
                          {activeMeta.ticks.map((t, idx) => (
                            <span key={idx}>{t.label}</span>
                          ))}
                        </div>
                      </div>

                      {/* Elevation Contour Isolines Action */}
                      {!isMulti && (
                        <div className="flex flex-col gap-2 rounded border border-line bg-solid/80 p-2 text-[10px]">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-ink flex items-center gap-1.5">
                              <Mountain size={12} className="text-amber-500" />
                              Contour Isolines (Marching Squares)
                            </span>
                            <span className="font-mono text-[8.5px] text-ink-muted">Vector Derivation</span>
                          </div>

                          <div className="flex items-center justify-between text-[9.5px]">
                            <span className="text-ink-muted">Isoline Interval</span>
                            <div className="flex items-center gap-1">
                              {[25, 50, 100, 200, 500].map((step) => (
                                <button
                                  key={step}
                                  type="button"
                                  className={cx(
                                    "rounded px-1.5 py-0.5 font-mono text-[9px] border transition-all",
                                    contourInterval === step
                                      ? "border-amber-500 bg-amber-500/20 text-amber-300 font-bold"
                                      : "border-line bg-tint/60 text-ink-muted hover:text-ink",
                                  )}
                                  onClick={() => setContourInterval(step)}
                                >
                                  {step}m
                                </button>
                              ))}
                            </div>
                          </div>

                          <button
                            type="button"
                            className={cx(PRIMARY_BUTTON, "h-7 text-[10.5px] justify-center w-full mt-0.5")}
                            disabled={isGeneratingContours}
                            onClick={() => handleGenerateContours(preset)}
                          >
                            {isGeneratingContours ? (
                              <>
                                <Loader2 size={12} className="animate-spin" />
                                Computing {contourInterval}m contours...
                              </>
                            ) : (
                              <>
                                <Mountain size={12} />
                                Generate {contourInterval}m Contours
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      {/* Live Pixel Probe HUD */}
                      <div className="flex flex-col gap-1 rounded border border-line bg-solid/80 p-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[10px] text-ink">
                            Cursor Pixel Probe
                          </span>
                          <span className="flex items-center gap-1 font-mono text-[8.5px] text-emerald-400">
                            <Activity size={9} className="animate-pulse" />
                            Synchronous GPU
                          </span>
                        </div>

                        {probeData ? (
                          <div className="flex flex-col gap-1 pt-1 font-mono text-[9px]">
                            <div className="flex items-center justify-between">
                              <span className="text-ink-muted">
                                {probeData.coordinate[1].toFixed(4)}°N, {probeData.coordinate[0].toFixed(4)}°E
                              </span>
                              <span className="font-bold text-accent">
                                {probeData.activeFormula}: {probeData.formattedValue}
                              </span>
                            </div>
                            <div className="text-[9px] text-ink font-sans">
                              {probeData.interpretation}
                            </div>
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[8.5px] text-ink-muted pt-0.5">
                              {Object.entries(probeData.rawBands).map(([b, v]) => (
                                <span key={b}>{b}: {v.toFixed(0)}</span>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5 py-2 text-ink-muted text-[9px]">
                            <Cpu size={12} />
                            Hover map to probe raw band reflectance
                          </div>
                        )}
                      </div>

                      {/* Layer Opacity */}
                      <div className="flex flex-col gap-1 pt-1">
                        <div className="flex items-center justify-between text-[9.5px]">
                          <span className="text-ink-muted">Opacity</span>
                          <span className="font-mono text-ink">{Math.round(opacity * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={opacity}
                          onChange={(e) => handleOpacitySlider(parseFloat(e.target.value))}
                          className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-line accent-accent"
                        />
                      </div>

                      {/* Contrast Stretch */}
                      {isMulti && (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[9.5px]">
                            <span className="text-ink-muted">Contrast Stretch</span>
                            <span className="font-mono text-ink">{(contrastScale * 3000).toFixed(1)}x</span>
                          </div>
                          <input
                            type="range"
                            min="0.0001"
                            max="0.001"
                            step="0.00005"
                            value={contrastScale}
                            onChange={(e) => handleContrastSlider(parseFloat(e.target.value))}
                            className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-line accent-accent"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
