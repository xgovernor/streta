import { GEOGRAPHIC_CRS, VIEW_CRS, crsName, transformPosition } from "../lib/gis/crs";
import { cx } from "../lib/cx";
import {
  formatArea,
  formatDistance,
  formatLat,
  formatLon,
  formatProjected,
  formatRotation,
  formatScaleDenominator,
  niceDistance,
} from "../lib/format";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";
import { useUiStore } from "../state/uiStore";

const ITEM = "flex h-full shrink-0 items-center gap-1.5 px-2.5";
const LABEL = "text-[7.5px] uppercase tracking-[0.12em] text-ink-muted";
const VALUE = "text-ink [font-variant-numeric:tabular-nums]";

export function StatusBar() {
  const camera = useMapStore((state) => state.camera);
  const pointer = useMapStore((state) => state.pointer);
  const pointerView = useMapStore((state) => state.pointerView);
  const hoverLabel = useMapStore((state) => state.hoverLabel);
  const ready = useMapStore((state) => state.ready);
  const coordFormat = useUiStore((state) => state.coordFormat);
  const measureMode = useProjectStore((state) => state.measureMode);
  const measureSummary = useProjectStore((state) => state.measureSummary);

  const lat = pointer?.lat ?? camera.lat;
  const lon = pointer?.lon ?? camera.lon;
  const viewPoint =
    pointerView ??
    (() => {
      const [x, y] = transformPosition([lon, lat], GEOGRAPHIC_CRS, VIEW_CRS);
      return { x, y };
    })();

  const metersPerPixel = camera.resolution * Math.cos((lat * Math.PI) / 180);
  const scaleDistance = niceDistance(metersPerPixel * 76);
  const scaleWidth = Math.min(128, Math.max(30, scaleDistance / metersPerPixel));

  return (
    <footer
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-[25] flex h-[var(--footer-h)] items-stretch overflow-hidden border-t border-line bg-solid font-mono text-[9.5px] tracking-[0.02em] text-ink-soft"
      aria-label="Map status"
    >
      <span
        className={cx(ITEM, "gap-2")}
        title={pointer ? "Cursor position" : "Map center"}
      >
        <span className={LABEL}>{pointer ? "Cursor" : "Center"}</span>
        {coordFormat === "projected" ? (
          <>
            <span className={VALUE}>
              X {formatProjected(viewPoint.x)}
            </span>
            <span className={VALUE}>
              Y {formatProjected(viewPoint.y)}
            </span>
            <span className="text-ink-muted">m</span>
          </>
        ) : (
          <>
            <span className={VALUE}>{formatLat(lat, coordFormat)}</span>
            <span className={VALUE}>{formatLon(lon, coordFormat)}</span>
          </>
        )}
      </span>

      {hoverLabel ? (
        <span
          className={cx(ITEM, "gap-2 wide:hidden")}
          title="Feature under the cursor"
        >
          <span className={LABEL}>Under cursor</span>
          <span className="max-w-[220px] truncate text-ink">{hoverLabel}</span>
        </span>
      ) : null}

      {measureMode !== "off" && measureSummary ? (
        <span
          className={cx(ITEM, "gap-2 text-accent")}
          title="Current measurement"
        >
          <span className={LABEL}>Measure</span>
          {measureSummary.mode === "area" ? (
            <span className="[font-variant-numeric:tabular-nums]">
              {formatArea(measureSummary.area)}
            </span>
          ) : null}
          <span className="[font-variant-numeric:tabular-nums]">
            {formatDistance(measureSummary.distance)}
          </span>
          <span className="text-ink-muted">
            {measureSummary.vertices} pt
          </span>
        </span>
      ) : null}

      <span className={cx(ITEM, "mid:hidden")}>
        <span className={LABEL}>Zoom</span>
        <span className="text-ink-soft [font-variant-numeric:tabular-nums]">
          {camera.zoom.toFixed(2)}
        </span>
      </span>

      <span className={cx(ITEM, "wide:hidden")}>
        <span className={LABEL}>Rot</span>
        <span className="text-ink-soft [font-variant-numeric:tabular-nums]">
          {formatRotation(camera.rotation)}
        </span>
      </span>

      <span className="flex-1" />

      <span
        className={cx(ITEM, "gap-[7px]")}
        title={`Scale denominator ${formatScaleDenominator(metersPerPixel)}`}
      >
        <span
          className="block h-[7px] shrink-0 border-b border-l border-r border-ink-muted opacity-80"
          style={{ width: `${scaleWidth}px` }}
        />
        <span className="text-[8.5px] text-ink-soft compact:hidden">
          {formatDistance(scaleDistance)}
        </span>
      </span>

      <span className={cx(ITEM, "wide:hidden")}>
        <span className="text-ink-soft [font-variant-numeric:tabular-nums]">
          {formatScaleDenominator(metersPerPixel)}
        </span>
      </span>

      <span className={cx(ITEM, "mid:hidden")} title={crsName(VIEW_CRS)}>
        <span className="text-ink-soft">{VIEW_CRS}</span>
      </span>

      <span
        className={cx(
          ITEM,
          "gap-[5px] pr-3 text-[7.5px] uppercase tracking-[0.1em]",
          ready ? "text-ok" : "text-ink-muted",
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "size-1 shrink-0 rounded-full bg-ok shadow-[0_0_0_3px_rgba(95,214,164,0.14)]",
            ready && "animate-pulse-dot",
          )}
        />
        {ready ? "Live" : "Sync"}
      </span>
    </footer>
  );
}
