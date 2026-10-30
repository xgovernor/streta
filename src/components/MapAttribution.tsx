import { Fragment } from "react";
import { BASEMAPS } from "../lib/gis/data";
import { openExternal } from "../lib/openExternal";
import { useUiStore } from "../state/uiStore";

/**
 * Credits the providers of the basemap on screen. The list follows the active
 * source, so switching from an OpenFreeMap style to Google imagery swaps the
 * credit rather than leaving the wrong one up.
 */
export function MapAttribution() {
  const basemap = useUiStore((state) => state.basemap);
  const attribution =
    BASEMAPS.find((item) => item.id === basemap)?.attribution ?? [];

  if (!attribution.length) {
    return null;
  }

  return (
    <div
      className="pointer-events-auto absolute bottom-[calc(var(--footer-h)+6px)] left-[calc(var(--ribbon-w)+12px)] z-[24] flex items-center gap-[3px] rounded-[2px] border border-line bg-solid px-1.5 py-0.5 font-mono text-[8px] leading-[1.4] text-ink-muted shadow-float"
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
    </div>
  );
}
