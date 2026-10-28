import { useEffect } from "react";
import { X } from "lucide-react";
import { displayValue } from "../lib/gis/geometry";
import { formatLat, formatLon } from "../lib/format";
import { screenPositionFor, setPopupHovered } from "../map/mapController";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";
import { useUiStore } from "../state/uiStore";
import { LayerSwatch } from "./panels/shared";

const CARD_WIDTH = 272;
const EDGE = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Brief card for a feature the user is hovering. Clicking a feature takes it
 * directly to the feature detail panel. */
export function FeaturePopup() {
  const popup = useMapStore((state) => state.popup);
  const setPopup = useMapStore((state) => state.setPopup);
  const activeFeature = useMapStore((state) => state.activeFeature);

  useMapStore((state) => state.camera);

  useEffect(() => {
    if (!popup && !activeFeature) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPopup(null);
        useMapStore.getState().setActiveFeature(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [popup, activeFeature, setPopup]);

  const target = popup ?? activeFeature;
  const role = popup ? "dialog" : "tooltip";

  if (!target) {
    return null;
  }

  return buildCard(
    target.layerId,
    target.featureId,
    target.lon,
    target.lat,
    role,
  );
}

function buildCard(
  layerId: string | undefined,
  featureId: string | undefined,
  lon: number | undefined,
  lat: number | undefined,
  role: "dialog" | "tooltip",
): React.ReactElement | null {
  if (!layerId || lon == null || lat == null) {
    return null;
  }

  const layer = useProjectStore.getState().layers.find((item) => item.id === layerId);
  if (!layer) {
    return null;
  }

  const resolvedFeatureId =
    featureId ?? useProjectStore.getState().selection?.featureId;
  const feature = useProjectStore.getState().selectionFeatureById(
    layerId,
    resolvedFeatureId,
  );

  if (!feature) {
    return null;
  }

  const point = screenPositionFor(lon, lat);
  if (!point) {
    return null;
  }

  const resolved = resolveFeature(layer, feature);
  const left = clamp(
    point.x,
    CARD_WIDTH / 2 + EDGE,
    window.innerWidth - CARD_WIDTH / 2 - EDGE,
  );
  const top = Math.max(point.y - 14, 96);

  const cardRole = role;

  const className =
    "pointer-events-auto absolute z-20 w-[272px] -translate-x-1/2 -translate-y-full overflow-hidden rounded-[10px] border border-line bg-raised shadow-[0_20px_48px_-16px_rgba(0,0,0,0.7)] border-tinted opacity-100 transition-[box-shadow,border-color,opacity,transform] duration-150 ease-out";

  return (
    <div
      className={className}
      style={{ left, top }}
      role={cardRole}
      aria-label={cardRole === "dialog" ? `${layer.name} feature` : `Hovering ${layer.name} · ${resolved.label}`}
      onMouseEnter={() => setPopupHovered(true)}
      onMouseLeave={() => setPopupHovered(false)}
    >
      <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5">
        <LayerSwatch color={layer.style.color} />
        <span className="truncate font-mono text-[8px] uppercase tracking-[0.12em] text-ink-muted">
          {layer.name}
        </span>
        <button
          type="button"
          className="ml-auto grid size-[18px] flex-none place-items-center rounded-[5px] text-ink-muted transition-colors hover:bg-tint hover:text-ink"
          aria-label="Close feature card"
          onClick={() => {
            useMapStore.getState().setPopup(null);
            useMapStore.getState().setActiveFeature(null);
          }}
        >
          <X size={11} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div
        className="cursor-pointer px-2.5 pb-2.5 pt-1.5 transition-colors hover:bg-tint/40"
        title="Click to view details"
        onClick={() => {
          useProjectStore.getState().select({
            layerId: layerId ?? "",
            featureId: featureId ?? "",
          });
          useUiStore.getState().openPanel("feature");
          useMapStore.getState().setPopup(null);
          useMapStore.getState().setActiveFeature(null);
        }}
      >
        <strong className="block truncate text-[12px] font-semibold tracking-[-0.01em]">
          {resolved.label}
        </strong>

        {resolved.rows.length ? (
          <div className="mt-1 flex flex-col gap-[3px]">
            {resolved.rows.map(([name, value]) => (
              <div
                key={name}
                className="flex items-baseline justify-between gap-2 text-[10px]"
              >
                <span className="flex-none text-ink-muted">{name}</span>
                <span
                  className="truncate text-right text-ink-soft"
                  title={String(displayValue(value))}
                >
                  {displayValue(value)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <span
          className="mt-1.5 block cursor-pointer font-mono text-[8.5px] text-accent hover:underline"
          title="Copy coordinates"
          onClick={(event) => {
            event.stopPropagation();
            const coordFormat = useUiStore.getState().coordFormat;
            const text = `${formatLat(lat, coordFormat)} · ${formatLon(lon, coordFormat)}`;
            if (navigator.clipboard) {
              navigator.clipboard.writeText(text).catch(() => {});
            }
          }}
        >
          {(() => {
            const coordFormat = useUiStore.getState().coordFormat;
            const formattedLat = formatLat(lat, coordFormat);
            const formattedLon = formatLon(lon, coordFormat);
            return `${formattedLat} · ${formattedLon}`;
          })()}
        </span>
      </div>
    </div>
  );
}

function resolveFeature(
  layer: {
    name: string;
    style: { color: string; labelField: string | null };
    fields: { name: string }[];
  },
  feature: { properties: Record<string, unknown> },
): { label: string; rows: [string, unknown][]; labelField: string | null } {
  const labelField = layer.style.labelField ?? layer.fields[0]?.name ?? null;
  const label =
    labelField ? displayValue(feature.properties[labelField]) : layer.name;
  const rows = Object.entries(feature.properties)
    .filter(
      ([name, value]) =>
        name !== labelField &&
        value !== null &&
        value !== "" &&
        value !== undefined,
    )
    .slice(0, 4);

  return { label, rows, labelField };
}

