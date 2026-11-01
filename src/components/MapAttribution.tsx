import { Fragment } from "react";
import { motion, type Variants } from "motion/react";
import { BASEMAPS } from "../lib/gis/data";
import { openExternal } from "../lib/openExternal";
import { useUiStore } from "../state/uiStore";
import { cx } from "../lib/cx";

/**
 * Credits the providers of the basemap on screen. The list follows the active
 * source, so switching from an OpenFreeMap style to Google imagery swaps the
 * credit rather than leaving the wrong one up.
 */
const attributionVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.75, delay: 0.3, ease: [0.16, 1, 0.3, 1] },
  },
};

export function MapAttribution() {
  const booted = useUiStore((state) => state.booted);
  const viewMode = useUiStore((state) => state.viewMode);
  const basemap = useUiStore((state) => state.basemap);
  const leftPanel = useUiStore((state) => state.leftPanel);
  const rightPanel = useUiStore((state) => state.rightPanel);
  const tableMaximized = useUiStore((state) => state.tableMaximized);
  const isTableOpen = leftPanel === "table" || rightPanel === "table";

  // One credit line per rendered canvas. In 3D the globe paints the selected
  // raster basemap, falling back to OSM for vector styles — credit must
  // follow what is actually on screen, not the hidden 2D layer stack.
  const displayedId =
    viewMode === "3d" &&
      BASEMAPS.find((item) => item.id === basemap)?.kind !== "raster"
      ? "openstreetmap"
      : basemap;
  const attribution =
    BASEMAPS.find((item) => item.id === displayedId)?.attribution ?? [];

  if (!attribution.length) {
    return null;
  }

  return (
    <motion.div
      initial="hidden"
      animate={
        booted
          ? isTableOpen && tableMaximized
            ? { opacity: 0, y: 14, transition: { duration: 0.2 } }
            : "visible"
          : "hidden"
      }
      variants={attributionVariants}
      className={cx(
        "pointer-events-auto absolute left-(--ribbon-w) z-[24] flex items-center gap-[3px] border-t border-r border-line bg-solid px-1.5 py-0.5 font-mono text-[9.5px] leading-[1.4] text-ink-muted shadow-float transition-[bottom] duration-200 ease-out",
        isTableOpen && tableMaximized && "pointer-events-none",
        isTableOpen
          ? "bottom-[calc(var(--footer-h)+var(--timeline-h)+var(--table-h,340px))]"
          : "bottom-[calc(var(--footer-h)+var(--timeline-h))]"
      )}
      role="note"
      aria-label="Map data attribution"
    >
      <span>©</span>
      {attribution.map((item, index) => (
        <Fragment key={item.href}>
          {index > 0 ? <span>·</span> : null}
          <a
            className="text-ink-soft no-underline hover:underline"
            href={item.href}
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              void openExternal(item.href);
            }}
          >
            {item.label}
          </a>
        </Fragment>
      ))}
    </motion.div>
  );
}
