import { useState } from "react";
import {
  Check,
  Layers,
  Loader2,
} from "lucide-react";
import {
  clearBufferOverlay,
  renderBooleanOverlay,
} from "../../map/mapController";
import { cx } from "../../lib/cx";
import {
  polygonBooleanOperation,
  type BooleanOpSummary,
} from "../../lib/gis/tiledBackend";
import { useProjectStore } from "../../state/projectStore";
import { useUiStore } from "../../state/uiStore";
import { uniqueDatasetName } from "../../lib/gis/datasets";
import { uniqueLayerName } from "../../lib/gis/layers";
import { GEOGRAPHIC_CRS } from "../../lib/gis/crs";
import type { FeatureRecord } from "../../lib/gis/types";
import { PanelShell } from "../PanelShell";
import {
  FIELD_INPUT,
  InfoNote,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SectionLabel,
} from "./shared";

export function BooleanPanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const notify = useUiStore((state) => state.notify);
  const layers = useProjectStore((state) => state.layers);

  // Boolean CAG state
  const [booleanOp, setBooleanOp] = useState<"intersection" | "union" | "difference" | "xor">("intersection");
  const [booleanLayerA, setBooleanLayerA] = useState<string>("");
  const [booleanLayerB, setBooleanLayerB] = useState<string>("");
  const [booleanLoading, setBooleanLoading] = useState(false);
  const [booleanResult, setBooleanResult] = useState<BooleanOpSummary | null>(null);

  const executeBooleanOp = async () => {
    if (!booleanLayerA || !booleanLayerB) {
      notify("Select two layers for Boolean operation");
      return;
    }
    if (booleanLayerA === booleanLayerB) {
      notify("Select two different layers");
      return;
    }

    const layerA = layers.find((l) => l.id === booleanLayerA);
    const layerB = layers.find((l) => l.id === booleanLayerB);
    if (!layerA || !layerB) {
      notify("Layer not found");
      return;
    }

    const polyA = layerA.features.filter((f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon");
    const polyB = layerB.features.filter((f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon");

    if (polyA.length === 0 || polyB.length === 0) {
      notify("Both layers must contain at least one Polygon or MultiPolygon");
      return;
    }

    setBooleanLoading(true);
    try {
      const geomA = polyA[0].geometry;
      const geomB = polyB[0].geometry;

      const res = await polygonBooleanOperation(booleanOp, geomA, geomB);
      if (res) {
        setBooleanResult(res);
        renderBooleanOverlay(res.geojson);
        notify(`Boolean ${booleanOp}: ${res.polygon_count} polygon(s) (${(res.total_area_sq_m / 1e6).toFixed(2)} km²)`);
      } else {
        notify("Boolean operation returned no result");
      }
    } catch (err) {
      notify(`Boolean operation error: ${err}`);
    } finally {
      setBooleanLoading(false);
    }
  };

  const saveBooleanResultAsLayer = () => {
    if (!booleanResult || !booleanResult.geojson) {
      notify("No Boolean result to save");
      return;
    }

    const projectStore = useProjectStore.getState();
    const existingDatasetNames = projectStore.datasets.map((d) => d.name);
    const datasetName = uniqueDatasetName(existingDatasetNames, `Boolean ${booleanOp.toUpperCase()}`);
    const features: FeatureRecord[] = (booleanResult.geojson.features || []).map((f: any, idx: number) => ({
      id: f.id || `bool_${idx}`,
      geometry: f.geometry,
      properties: f.properties || {},
    }));

    const existingLayerNames = projectStore.layers.map((l) => l.name);
    const layerName = uniqueLayerName(existingLayerNames, `${booleanOp.toUpperCase()} result`);

    projectStore.addDataset({
      name: datasetName,
      kind: "file",
      source: "derived:boolean",
      layers: [
        {
          id: `bool_${Date.now().toString(36)}`,
          name: layerName,
          features,
          crs: GEOGRAPHIC_CRS,
          format: "geojson",
          source: "derived:boolean",
        },
      ],
    });
    notify(`Saved new layer: "${layerName}" (${features.length} polygons)`);
  };

  const clearBoolean = () => {
    clearBufferOverlay();
    setBooleanResult(null);
    notify("Boolean operation overlay cleared");
  };

  return (
    <PanelShell
      eyebrow="Geoprocessing"
      title="Constructive Area Geometry"
      side="right"
      onClose={() => closePanel("right")}
      footer={
        <>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-accent" />
            WGS 84 Ellipsoidal
          </span>
          <span>Boolean Topology</span>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SectionLabel>Polygon Boolean Operations</SectionLabel>

        <div className="flex flex-col gap-2 rounded-[2px] border border-line bg-tint p-2.5">
          {/* Operation Type Buttons */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-ink-muted">Operation Type</label>
            <div className="grid grid-cols-4 gap-1">
              {(
                [
                  { id: "intersection", label: "Intersect" },
                  { id: "union", label: "Union" },
                  { id: "difference", label: "Diff (A-B)" },
                  { id: "xor", label: "XOR" },
                ] as const
              ).map((op) => (
                <button
                  key={op.id}
                  type="button"
                  className={cx(
                    "h-6 rounded-[2px] text-[10px] font-semibold transition-colors",
                    booleanOp === op.id
                      ? "bg-accent text-on-accent"
                      : "bg-solid text-ink-muted hover:text-ink border border-line",
                  )}
                  onClick={() => setBooleanOp(op.id)}
                >
                  {op.label}
                </button>
              ))}
            </div>
          </div>

          {/* Layer A Select */}
          <div className="flex flex-col gap-1 pt-1">
            <label className="text-[10px] font-medium text-ink-muted">Layer A (Base Polygon)</label>
            <select
              value={booleanLayerA}
              onChange={(e) => setBooleanLayerA(e.target.value)}
              className={FIELD_INPUT}
            >
              <option value="">Select Polygon Layer A...</option>
              {layers
                .filter((l) => l.geometryKind === "Polygon" || l.geometryKind === "MultiPolygon" || l.geometryKind === "Mixed")
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Layer B Select */}
          <div className="flex flex-col gap-1 pt-1">
            <label className="text-[10px] font-medium text-ink-muted">Layer B (Overlay Polygon)</label>
            <select
              value={booleanLayerB}
              onChange={(e) => setBooleanLayerB(e.target.value)}
              className={FIELD_INPUT}
            >
              <option value="">Select Polygon Layer B...</option>
              {layers
                .filter((l) => l.geometryKind === "Polygon" || l.geometryKind === "MultiPolygon" || l.geometryKind === "Mixed")
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 pt-1">
            <button
              type="button"
              disabled={!booleanLayerA || !booleanLayerB || booleanLoading}
              className={cx(PRIMARY_BUTTON, "flex-1")}
              onClick={executeBooleanOp}
            >
              {booleanLoading ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Computing Topology...
                </>
              ) : (
                <>
                  <Layers size={12} />
                  Execute {booleanOp}
                </>
              )}
            </button>
            {booleanResult && (
              <button type="button" className={SECONDARY_BUTTON} onClick={clearBoolean} title="Clear overlay">
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Results Plaque */}
        {booleanResult && (
          <div className="flex flex-col gap-2 rounded-[2px] border border-line bg-tint p-2.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-ink">
              <span className="capitalize">{booleanOp} Result</span>
              <span className="font-mono text-[10px] text-accent">
                {booleanResult.polygon_count} polygon(s)
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1 rounded-[2px] bg-solid p-2 font-mono text-[10px]">
              <div>
                <span className="text-[9px] text-ink-muted block uppercase">Total Area</span>
                <span className="font-semibold text-ink">
                  {(booleanResult.total_area_sq_m / 1e6).toFixed(3)} km²
                </span>
              </div>
              <div>
                <span className="text-[9px] text-ink-muted block uppercase">Hectares</span>
                <span className="font-semibold text-ink">
                  {(booleanResult.total_area_sq_m / 10000).toFixed(1)} ha
                </span>
              </div>
            </div>

            <button
              type="button"
              className={cx(PRIMARY_BUTTON, "w-full justify-center gap-1.5")}
              onClick={saveBooleanResultAsLayer}
            >
              <Check size={12} />
              Save Result as New Dataset Layer
            </button>
          </div>
        )}

        <InfoNote>
          Performs topological overlay analysis using the Martinez-Rueda-Feito polygon clipping algorithm. Computes union, intersection, difference, and symmetric difference without self-intersection or hole winding artifacts.
        </InfoNote>
      </div>
    </PanelShell>
  );
}
