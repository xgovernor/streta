import { useCallback, useEffect, useState } from "react";
import {
  Camera,
  Check,
  Compass,
  Copy,
  ExternalLink,
  Eye,
  MapPin,
  RefreshCw,
  X,
  ZoomIn,
} from "lucide-react";
import { displayValue } from "../lib/gis/geometry";
import { formatLat, formatLon } from "../lib/format";
import { resolveSnapshotUrl } from "../lib/gis/cctv";
import { openExternal } from "../lib/openExternal";
import { flyTo, screenPositionFor, setPopupHovered } from "../map/mapController";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";
import { useUiStore } from "../state/uiStore";
import { LayerSwatch } from "./panels/shared";
import type { DatasetLayer, FeatureRecord } from "../lib/gis/types";

const CARD_WIDTH = 272;
const CAMERA_CARD_WIDTH = 300;
const EDGE = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toCompassHeading(deg: number): string {
  const directions = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  const index = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return directions[index];
}

function isCameraTarget(layer: DatasetLayer, feature: FeatureRecord): boolean {
  const geomType = feature.geometry.type;
  if (geomType !== "Point" && geomType !== "MultiPoint") {
    return false;
  }

  if (
    /camera|cctv/i.test(layer.name) ||
    (typeof layer.source === "string" && /cctv/i.test(layer.source))
  ) {
    return true;
  }
  const props = feature.properties;
  if (
    props.snapshot_url !== undefined ||
    props.mount_height_m !== undefined ||
    props.heading_deg !== undefined
  ) {
    return true;
  }
  return String(feature.id ?? "").startsWith("cctv-cam-");
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
  const activeTarget = useMapStore.getState().popup ?? useMapStore.getState().activeFeature;
  const feature =
    useProjectStore.getState().selectionFeatureById(
      layerId,
      resolvedFeatureId,
    ) ??
    (activeTarget?.properties ? {
      id: resolvedFeatureId ?? "",
      geometry: { type: "Point" as const, coordinates: [lon, lat] },
      properties: activeTarget.properties as Record<string, any>,
    } : null);

  if (!feature) {
    return null;
  }

  const point = screenPositionFor(lon, lat);
  if (!point) {
    return null;
  }

  const isCamera = isCameraTarget(layer, feature);
  const cardWidth = isCamera ? CAMERA_CARD_WIDTH : CARD_WIDTH;
  const left = clamp(
    point.x,
    cardWidth / 2 + EDGE,
    window.innerWidth - cardWidth / 2 - EDGE,
  );
  const top = Math.max(point.y - 14, 96);

  if (isCamera) {
    return (
      <CameraHoverWidget
        layer={layer}
        feature={feature}
        lon={lon}
        lat={lat}
        left={left}
        top={top}
        role={role}
      />
    );
  }

  const resolved = resolveFeature(layer, feature);

  const className =
    "pointer-events-auto absolute z-20 w-[272px] -translate-x-1/2 -translate-y-full overflow-hidden rounded-[10px] border border-line bg-raised shadow-[0_20px_48px_-16px_rgba(0,0,0,0.7)] border-tinted opacity-100 transition-[box-shadow,border-color,opacity,transform] duration-150 ease-out";

  return (
    <div
      className={className}
      style={{ left, top }}
      role={role}
      aria-label={role === "dialog" ? `${layer.name} feature` : `Hovering ${layer.name} · ${resolved.label}`}
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

function CameraHoverWidget({
  layer,
  feature,
  lon,
  lat,
  left,
  top,
  role,
}: {
  layer: DatasetLayer;
  feature: FeatureRecord;
  lon: number;
  lat: number;
  left: number;
  top: number;
  role: "dialog" | "tooltip";
}) {
  const props = feature.properties;
  const rawUrl = typeof props.snapshot_url === "string" ? props.snapshot_url : null;
  const [snapshotSrc, setSnapshotSrc] = useState<string | null>(() =>
    resolveSnapshotUrl(rawUrl, false),
  );
  const [hasError, setHasError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSnapshotSrc(resolveSnapshotUrl(rawUrl, false));
    setHasError(false);
  }, [rawUrl]);

  const refreshSnapshot = useCallback(() => {
    setRefreshing(true);
    setHasError(false);
    setSnapshotSrc(resolveSnapshotUrl(rawUrl, true));
    setTimeout(() => setRefreshing(false), 600);
  }, [rawUrl]);

  const name =
    typeof props.name === "string" && props.name.trim() ?
      props.name
    : feature.id;

  const city = typeof props.city === "string" ? props.city : null;
  const provider = typeof props.provider === "string" ? props.provider : null;

  const heading =
    typeof props.heading_deg === "number" && Number.isFinite(props.heading_deg) ?
      props.heading_deg
    : null;

  const mountHeight =
    typeof props.mount_height_m === "number" && Number.isFinite(props.mount_height_m) ?
      props.mount_height_m
    : null;

  const mountGround =
    typeof props.mount_ground_m === "number" && Number.isFinite(props.mount_ground_m) ?
      props.mount_ground_m
    : null;

  const totalElev =
    typeof props.total_elevation_m === "number" && Number.isFinite(props.total_elevation_m) ?
      props.total_elevation_m
    : null;

  const fov =
    typeof props.fov_deg === "number" && Number.isFinite(props.fov_deg) ?
      props.fov_deg
    : null;

  const range =
    typeof props.range_m === "number" && Number.isFinite(props.range_m) ?
      props.range_m
    : null;

  const handleZoom = (e: React.MouseEvent) => {
    e.stopPropagation();
    flyTo(lon, lat, 16);
  };

  const handleOpenDetails = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    useProjectStore.getState().select({
      layerId: layer.id,
      featureId: feature.id,
    });
    useUiStore.getState().openPanel("feature");
    useMapStore.getState().setPopup(null);
    useMapStore.getState().setActiveFeature(null);
  };

  const handleCopyCoords = (e: React.MouseEvent) => {
    e.stopPropagation();
    const coordFormat = useUiStore.getState().coordFormat;
    const text = `${formatLat(lat, coordFormat)} · ${formatLon(lon, coordFormat)}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const coordFormat = useUiStore.getState().coordFormat;
  const formattedLat = formatLat(lat, coordFormat);
  const formattedLon = formatLon(lon, coordFormat);

  return (
    <div
      className="pointer-events-auto absolute z-20 w-[300px] -translate-x-1/2 -translate-y-full overflow-hidden rounded-[10px] border border-tinted bg-raised shadow-[0_20px_48px_-16px_rgba(0,0,0,0.75)] opacity-100 transition-[box-shadow,border-color,opacity,transform] duration-150 ease-out"
      style={{ left, top }}
      role={role}
      aria-label={`${layer.name} · ${name}`}
      onMouseEnter={() => setPopupHovered(true)}
      onMouseLeave={() => setPopupHovered(false)}
    >
      {/* Header bar */}
      <div className="flex items-center gap-1.5 border-b border-line bg-tint/20 px-2.5 py-1.5">
        <LayerSwatch color={layer.style.color} />
        <span className="truncate font-mono text-[8px] uppercase tracking-[0.12em] text-ink-muted">
          CCTV Camera
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-[4px] border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[8px] font-semibold text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </span>
          <button
            type="button"
            className="grid size-[18px] flex-none place-items-center rounded-[5px] text-ink-muted transition-colors hover:bg-tint hover:text-ink"
            aria-label="Close camera popup"
            onClick={() => {
              useMapStore.getState().setPopup(null);
              useMapStore.getState().setActiveFeature(null);
            }}
          >
            <X size={11} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Camera identity */}
      <div
        className="px-2.5 pt-2 pb-1.5 cursor-pointer hover:bg-tint/30 transition-colors"
        onClick={() => handleOpenDetails()}
      >
        <strong className="block truncate text-[12px] font-semibold tracking-[-0.01em] text-ink" title={String(name)}>
          {name}
        </strong>
        {city || provider ? (
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-muted truncate">
            {city ? (
              <span className="inline-flex items-center gap-0.5 truncate">
                <MapPin size={9} strokeWidth={2} className="flex-none text-accent" />
                <span className="truncate">{city}</span>
              </span>
            ) : null}
            {city && provider ? <span className="text-ink-muted/50">·</span> : null}
            {provider ? <span className="truncate text-ink-soft">{provider}</span> : null}
          </div>
        ) : null}
      </div>

      {/* Snapshot Preview Feed */}
      {rawUrl ? (
        <div className="px-2.5 pb-2">
          {hasError ? (
            <div className="flex flex-col items-center justify-center gap-1.5 rounded-[6px] border border-line/60 bg-tint/30 py-3 text-center">
              <Camera size={16} strokeWidth={1.5} className="text-ink-muted" />
              <p className="m-0 text-[10px] text-ink-muted">Feed unavailable or blocked by CORS</p>
              <div className="flex items-center gap-2 mt-0.5">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[9.5px] font-mono text-accent hover:underline"
                  onClick={() => void openExternal(rawUrl)}
                >
                  <ExternalLink size={9} strokeWidth={2} />
                  Open source
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[9.5px] font-mono text-ink-soft hover:underline"
                  onClick={refreshSnapshot}
                >
                  <RefreshCw size={9} strokeWidth={2} />
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <div
              className="group relative aspect-video w-full overflow-hidden rounded-[6px] border border-line bg-black/90 cursor-pointer"
              title="Click to view feature details"
              onClick={() => handleOpenDetails()}
            >
              {snapshotSrc ? (
                <img
                  src={snapshotSrc}
                  alt={String(name)}
                  className="size-full object-cover transition-opacity duration-200"
                  onError={() => setHasError(true)}
                />
              ) : null}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <button
                type="button"
                className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded bg-black/75 text-ink-muted hover:text-white backdrop-blur-sm transition-all shadow"
                title="Refresh snapshot feed"
                onClick={(e) => {
                  e.stopPropagation();
                  refreshSnapshot();
                }}
              >
                <RefreshCw
                  size={10}
                  strokeWidth={2}
                  className={refreshing ? "animate-spin text-accent" : ""}
                />
              </button>
              <div className="pointer-events-none absolute bottom-1 left-1.5 flex items-center gap-1 font-mono text-[8px] text-white/80 drop-shadow">
                <Camera size={9} strokeWidth={2} />
                <span>{feature.id}</span>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Telemetry Grid */}
      <div className="px-2.5 pb-2">
        <div className="grid grid-cols-2 gap-1.5">
          {heading != null ? (
            <div className="flex items-center gap-1.5 rounded-[5px] border border-line/60 bg-tint/25 px-2 py-1 text-[9.5px]">
              <div
                className="grid size-4 flex-none place-items-center rounded bg-accent/15 text-accent"
                style={{ transform: `rotate(${heading}deg)` }}
                title={`Heading: ${heading}°`}
              >
                <Compass size={11} strokeWidth={2} />
              </div>
              <div className="flex flex-col truncate">
                <span className="font-mono text-[7.5px] uppercase tracking-wider text-ink-muted">Heading</span>
                <span className="font-mono font-medium text-ink truncate">
                  {heading}° {toCompassHeading(heading)}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-[5px] border border-line/60 bg-tint/25 px-2 py-1 text-[9.5px]">
              <Compass size={11} strokeWidth={2} className="text-ink-muted" />
              <div className="flex flex-col truncate">
                <span className="font-mono text-[7.5px] uppercase tracking-wider text-ink-muted">Heading</span>
                <span className="font-mono font-medium text-ink-muted">Omni / Static</span>
              </div>
            </div>
          )}

          {totalElev != null || mountHeight != null ? (
            <div className="flex items-center justify-between rounded-[5px] border border-line/60 bg-tint/25 px-2 py-1 text-[9.5px]">
              <div className="flex flex-col truncate">
                <span className="font-mono text-[7.5px] uppercase tracking-wider text-ink-muted">Elevation</span>
                <span className="font-mono font-medium text-ink truncate">
                  {totalElev != null ? `${totalElev}m ASL` : `${mountHeight}m H`}
                </span>
              </div>
              {mountHeight != null && totalElev != null ? (
                <span className="font-mono text-[8px] text-ink-muted" title={`Mount: ${mountHeight}m, Ground: ${mountGround ?? "?"}m`}>
                  +{mountHeight}m
                </span>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-[5px] border border-line/60 bg-tint/25 px-2 py-1 text-[9.5px]">
              <div className="flex flex-col truncate">
                <span className="font-mono text-[7.5px] uppercase tracking-wider text-ink-muted">Status</span>
                <span className="font-mono font-medium text-emerald-400 capitalize">
                  {String(props.status ?? "Active")}
                </span>
              </div>
            </div>
          )}

          {fov != null && range != null ? (
            <div className="col-span-2 flex items-center justify-between rounded-[5px] border border-line/60 bg-tint/25 px-2 py-1 text-[9.5px]">
              <span className="font-mono text-[7.5px] uppercase tracking-wider text-ink-muted">Viewshed Cone</span>
              <span className="font-mono text-[9px] text-ink-soft">
                {fov}° FOV · {range}m range
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-between gap-1.5 border-t border-line bg-tint/30 px-2.5 py-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-[5px] border border-line/70 bg-surface px-2 py-1 font-mono text-[9px] font-medium text-ink hover:border-accent hover:text-accent transition-colors shadow-sm"
            title="Zoom map to camera"
            onClick={handleZoom}
          >
            <ZoomIn size={10} strokeWidth={2} />
            Zoom
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-[5px] border border-line/70 bg-surface px-2 py-1 font-mono text-[9px] font-medium text-ink hover:border-accent hover:text-accent transition-colors shadow-sm"
            title="View complete attributes and camera telemetry"
            onClick={handleOpenDetails}
          >
            <Eye size={10} strokeWidth={2} />
            Details
          </button>
        </div>

        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 font-mono text-[8.5px] text-ink-muted hover:text-ink transition-colors cursor-pointer"
          title="Click to copy coordinates"
          onClick={handleCopyCoords}
        >
          {copied ? (
            <>
              <Check size={9} strokeWidth={2.5} className="text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy size={9} strokeWidth={2} />
              <span>{formattedLat} · {formattedLon}</span>
            </>
          )}
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
