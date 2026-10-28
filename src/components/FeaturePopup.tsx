import { useEffect } from "react";
import { Crosshair, Frame, X } from "lucide-react";
import { displayValue } from "../lib/gis/geometry";
import { formatLat, formatLon } from "../lib/format";
import { screenPositionFor, zoomToSelection } from "../map/mapController";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";
import { useUiStore } from "../state/uiStore";
import { LayerSwatch, SECONDARY_BUTTON } from "./panels/shared";

const CARD_WIDTH = 272;
const EDGE = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Brief card for a feature the user is hovering. Clicking a feature takes it
 * out of hover preview and into a locked, clickable card plus a detail panel. */
export function FeaturePopup() {
  const popup = useMapStore((state) => state.popup);
  const setPopup = useMapStore((state) => state.setPopup);
  const activeFeature = useMapStore((state) => state.activeFeature);

  useMapStore((state) => state.camera);

  useEffect(() => {
    if (!popup) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) =>
      event.key === "Escape" ? setPopup(null) : undefined;

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [popup, setPopup]);

  const card =
    popup
      ? buildCard(popup.layerId, popup.featureId, popup.lon, popup.lat, "dialog")
      : buildCard(
          activeFeature?.layerId,
          activeFeature?.featureId,
          activeFeature?.lon,
          activeFeature?.lat,
          "tooltip",
        );

  if (!card) {
    return null;
  }

  return card;
}

function buildCard(
  layerId: string | undefined,
  featureId: string | undefined,
  lon: number | undefined,
  lat: number | undefined,
  role: "dialog" | "tooltip",
  isHover?: boolean,
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
  const cardIsHover = cardRole === "tooltip";

  const className =
    "pointer-events-auto absolute z-20 w-[272px] -translate-x-1/2 -translate-y-full overflow-hidden rounded-[10px] border border-line bg-raised shadow-[0_20px_48px_-16px_rgba(0,0,0,0.7)] transition-[box-shadow,border-color,opacity" +
    (cardIsHover
      ? ",transform,0.15s_ease-out] opacity-0 -translate-y-1"
      : "] border-tinted opacity-100");

  return (
    <div
      className={className}
      style={{ left, top }}
      role={cardRole}
      aria-label={cardRole === "dialog" ? `${layer.name} feature` : `Hovering ${layer.name} · ${resolved.label}`}
    >
      <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5">
        <LayerSwatch color={layer.style.color} />
        <span className="truncate font-mono text-[8px] uppercase tracking-[0.12em] text-ink-muted">{layer.name}</span>
        <button
          type="button"
          className={
            "ml-auto grid size-[18px] flex-none place-items-center rounded-[5px] text-ink-muted transition-colors hover:bg-tint hover:text-ink" +
            (isHover ? " opacity-0" : "")
          }
          aria-label={isHover ? undefined : "Close feature card"}
          onClick={() => useMapStore.getState().setPopup(null)}
        >
          <X size={11} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div className="px-2.5 pb-2 pt-1.5">
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
                <span className="truncate text-right text-ink-soft" title={String(displayValue(value))}>
                  {displayValue(value)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <span
          className="mt-1.5 block font-mono text-[8.5px] text-accent"
          title="Copy coordinates"
          onClick={() => {
            const text = `${formatLat(lat, useUiStore.getState().coordFormat)} · ${formatLon(lon, useUiStore.getState().coordFormat)}`;
            if (navigator.clipboard) {
              navigator.clipboard.writeText(text).catch(() => {});
            }
          }}
        >
          {(() => {
            const formattedLat = formatLat(lat, useUiStore.getState().coordFormat);
            const formattedLon = formatLon(lon, useUiStore.getState().coordFormat);
            return `${formattedLat} · ${formattedLon}`;
          })()}          </span>
      </div>

      <div
        className={
          "flex items-stretch gap-1.5 border-t border-line px-2.5 py-1.5 border-t-accent/40" +
          (isHover ? " filter-none hover:border-accent/40 hover:text-accent" : "")
        }
      >
        <button
          type="button"
          className={
            SECONDARY_BUTTON +
            " h-[24px] flex-1 px-1.5 text-[10px]" +
            (isHover ? " filter-none hover:border-accent/40 hover:text-accent" : "")
          }
          onClick={() => {
            if (cardIsHover) {
              useMapStore.getState().setPopup({ layerId: layerId ?? "", featureId: featureId ?? "", lon, lat });
              useProjectStore.getState().lockSelection({ layerId: layerId ?? "", featureId: featureId ?? "" });
              navigator.clipboard.writeText("locked");
            }
            useUiStore.getState().openPanel("feature");
          }}
        >
          <Crosshair size={11} strokeWidth={1.9} aria-hidden="true" />
          Details
        </button>
        <button
          type="button"
          className={
            SECONDARY_BUTTON +
            " h-[24px] flex-1 px-1.5 text-[10px]" +
            (isHover ? " filter-none hover:border-accent/40 hover:text-accent" : "")
          }
          onClick={() => {
            if (cardIsHover) {
              useMapStore
                .getState()
                .setPopup({ layerId: layerId ?? "", featureId: featureId ?? "", lon, lat });
            }
            useProjectStore.getState().lockSelection({ layerId: layerId ?? "", featureId: featureId ?? "" });
            zoomToSelection();
          }}
        >
          <Frame size={11} strokeWidth={1.9} aria-hidden="true" />
          Zoom
        </button>
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

