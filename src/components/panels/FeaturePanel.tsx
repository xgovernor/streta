import { useEffect, useState } from "react";
import { Copy, Crosshair, ExternalLink, Frame, RefreshCw } from "lucide-react";
import { GEOGRAPHIC_CRS, transformGeometry, transformPosition } from "../../lib/gis/crs";
import {
  displayValue,
  eachPosition,
  geometryArea,
  geometryCentroid,
  geometryLength,
} from "../../lib/gis/geometry";
import type { Attributes, Position } from "../../lib/gis/types";
import {
  type OsmContext,
  type PlaceContext,
  type WikiContext,
  osmContext,
  parseOsmRef,
  placeAt,
  wikiContext,
  wikipediaTarget,
} from "../../lib/online/context";
import { openExternal } from "../../lib/openExternal";
import { zoomToSelection } from "../../map/mapController";
import { formatArea, formatDistance, formatLat, formatLon } from "../../lib/format";
import { useProjectStore } from "../../state/projectStore";
import { useUiStore } from "../../state/uiStore";
import { PanelShell } from "../PanelShell";
import {
  EmptyState,
  KeyValue,
  PRIMARY_BUTTON,    SECONDARY_BUTTON,
  SectionLabel,
} from "./shared";

function firstPosition(coordinates: unknown): Position | null {
  let found: Position | null = null;

  const walk = (value: unknown) => {
    if (found || !Array.isArray(value)) {
      return;
    }

    if (value.length > 0 && typeof value[0] === "number") {
      found = value as Position;
      return;
    }

    value.find((child) => {
      walk(child);
      return Boolean(found);
    });
  };

  walk(coordinates);
  return found;
}

type Loaded<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: T | null };

/** Overpass waits for a click, so only its result may stay idle. */
type OsmLoaded = Exclude<Loaded<OsmContext>, { status: "idle" }>;

function loadedValue<T>(loaded: Loaded<T>): T | null {
  return loaded.status === "ready" ? loaded.value : null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent hover:underline"
      onClick={onClick}
    >
      <RefreshCw size={10} strokeWidth={2} aria-hidden="true" />
      Retry
    </button>
  );
}

/**
 * What the public services know about a feature: the place around its centre,
 * its Wikipedia article, and — on request — the OSM tags the pack did not keep.
 * The place and article load themselves; Overpass is a shared, slow resource, so
 * it waits for a click.
 */
function OnlineContext({
  properties,
  lon,
  lat,
}: {
  properties: Attributes;
  lon: number;
  lat: number;
}) {
  const [attempt, setAttempt] = useState(0);
  const [place, setPlace] = useState<Loaded<PlaceContext>>({ status: "loading" });
  const [wiki, setWiki] = useState<Loaded<WikiContext>>({ status: "loading" });
  const [osm, setOsm] = useState<OsmLoaded>({ status: "idle" });



  const osmRaw = properties.osm_id;
  const osmRef =
    typeof osmRaw === "string" || typeof osmRaw === "number"
      ? parseOsmRef(String(osmRaw))
      : null;
  const wikiLinked = wikipediaTarget(properties) !== null;

  useEffect(() => {
    let alive = true;
    setPlace({ status: "loading" });

    placeAt(lon, lat)
      .then((value) => {
        if (alive) setPlace({ status: "ready", value });
      })
      .catch((error: unknown) => {
        if (alive) setPlace({ status: "error", message: describeError(error) });
      });

    return () => {
      alive = false;
    };
  }, [lon, lat, attempt]);

  useEffect(() => {
    if (!wikiLinked) {
      setWiki({ status: "ready", value: null } as const);
      return;
    }

    let alive = true;
    setWiki({ status: "loading" });

    wikiContext(properties)
      .then((value) => {
        if (alive) setWiki({ status: "ready", value });
      })
      .catch((error: unknown) => {
        if (alive) setWiki({ status: "error", message: describeError(error) });
      });

    return () => {
      alive = false;
    };
  }, [properties, attempt, wikiLinked]);

  useEffect(() => {
    setOsm({ status: "idle" });
  }, [properties]);

  const loadOsm = () => {
    setOsm({ status: "loading" });

    osmContext(properties)
      .then((value) => setOsm({ status: "ready", value }))
      .catch((error: unknown) =>
        setOsm({ status: "error", message: describeError(error) }),
      );
  };

  return (
    <>
      <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-ink-muted">Context</span>

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-[3px]">
          <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-ink-muted">
            Place
          </span>
          {place.status === "loading" ? (
            <p className="m-0 text-[10.5px] text-ink-muted">Looking up the place…</p>
          ) : place.status === "error" ? (
            <p className="m-0 text-[10.5px] text-ink-muted">
              {place.message}. <RetryButton onClick={() => setAttempt((n) => n + 1)} />
            </p>
          ) : loadedValue(place) ? (
            <>
              <strong className="text-[11px] font-semibold">{loadedValue(place)!.name}</strong>
              <span className="text-[10.5px] text-ink-soft">{loadedValue(place)!.detail}</span>
              {loadedValue(place)!.kind ? (
                <span className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-ink-muted">
                  {loadedValue(place)!.kind}
                </span>
              ) : null}
            </>
          ) : (
            <p className="m-0 text-[10.5px] text-ink-muted">
              No place is mapped this close to the feature.
            </p>
          )}
        </div>

        {wikiLinked ? (
          <div className="flex flex-col gap-[3px] border-t border-line pt-2">
            <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-ink-muted">
              Wikipedia
            </span>
            {wiki.status === "loading" ? (
              <p className="m-0 text-[10.5px] text-ink-muted">Loading the article…</p>
            ) : wiki.status === "error" ? (
              <p className="m-0 text-[10.5px] text-ink-muted">
                {wiki.message}. <RetryButton onClick={() => setAttempt((n) => n + 1)} />
              </p>
            ) : loadedValue(wiki) ? (
              <>
                <strong className="text-[11px] font-semibold">{loadedValue(wiki)!.title}</strong>
                <p className="m-0 text-[10.5px] leading-[1.5] text-ink-soft">
                  {(loadedValue(wiki) ?? null)!.extract.length > 320
                    ? `${(loadedValue(wiki) ?? null)!.extract.slice(0, 320).trimEnd()}…`
                    : (loadedValue(wiki) ?? null)!.extract}
                </p>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 self-start text-[10px] font-semibold text-accent hover:underline"
                  onClick={() => void openExternal(loadedValue(wiki)?.url ?? "")}
                >
                  <ExternalLink size={10} strokeWidth={2} aria-hidden="true" />
                  Read on Wikipedia
                </button>
              </>
            ) : (
              <p className="m-0 text-[10.5px] text-ink-muted">
                The linked article could not be found.
              </p>
            )}
          </div>
        ) : null}

        <div className="flex flex-col gap-[3px] border-t border-line pt-2">
          <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-ink-muted">
            OpenStreetMap
          </span>
          {!osmRef ? (
            <p className="m-0 text-[10.5px] text-ink-muted">
              This feature carries no OSM id.
            </p>
          ) : osm.status === "loading" ? (
            <p className="m-0 text-[10.5px] text-ink-muted">Asking Overpass…</p>
          ) : osm.status === "error" ? (
            <p className="m-0 text-[10.5px] text-ink-muted">
              {osm.message}. <RetryButton onClick={loadOsm} />
            </p>          ) : loadedValue(osm) ? (
            <>
              <div className="panel-scroll max-h-[150px] overflow-auto rounded-[6px] border border-line bg-tint px-1.5 py-1">
                {loadedValue(osm)!.tags.map(([key, value]: [string, string]) => (
                  <div
                    key={key}
                    className="flex items-baseline gap-2 py-[1px] font-mono text-[9px]"
                  >
                    <span className="flex-none text-ink-muted">{key}</span>
                    <span className="truncate text-ink-soft">{value}</span>
                  </div>
                ))}

              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 self-start text-[10px] font-semibold text-accent hover:underline"
                onClick={() => void openExternal((loadedValue(osm) ?? null)!.url ?? "")}
              >
                <ExternalLink size={10} strokeWidth={2} aria-hidden="true" />
                Open on openstreetmap.org
              </button>
            </>
          ) : (
            <p className="m-0 text-[10.5px] text-ink-muted">
              Overpass returned no tags for this element.
            </p>
          )}
        </div>
      </div>

      <p className="mb-0 mt-2 text-[9.5px] leading-[1.5] text-ink-muted">
        {`Nominatim, Wikipedia and Overpass · © OpenStreetMap contributors (ODbL)`}
      </p>
    </>
  );
}

export function FeaturePanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const notify = useUiStore((state) => state.notify);
  const coordFormat = useUiStore((state) => state.coordFormat);
  const layers = useProjectStore((state) => state.layers);
  const selection = useProjectStore((state) => state.selection);

  const layer = selection
    ? layers.find((item) => item.id === selection.layerId)
    : undefined;
  const feature = layer?.features.find((item) => item.id === selection?.featureId);

  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(message);
    } catch {
      notify("Clipboard is not available in this window.");
    }
  };


  if (!layer || !feature) {
    return (
      <PanelShell
        eyebrow="Selection"
        title="Feature detail"
        side="right"
        onClose={closePanel}
      >
        <EmptyState
          icon={<Crosshair size={22} strokeWidth={1.4} aria-hidden="true" />}
          title="Select a feature on the map or in the attribute table."
        >
          <span className="max-w-[220px] text-[10px] leading-normal">
            Attributes, geometry and geodesic measurements appear here.
          </span>
        </EmptyState>
      </PanelShell>
    );
  }

  const geographic = transformGeometry(feature.geometry, layer.crs, GEOGRAPHIC_CRS);
  const length = geometryLength(geographic);
  const area = geometryArea(geographic);

  let vertices = 0;
  eachPosition(geographic, () => {
    vertices += 1;
  });

  const vertex = firstPosition(feature.geometry);
  const geographicVertex = vertex
    ? transformPosition(vertex, layer.crs, GEOGRAPHIC_CRS)
    : null;

  const attributes = Object.entries(feature.properties);
  const centroid = geometryCentroid(geographic);

  return (
    <PanelShell
      eyebrow={`Selection · ${layer.name}`}
      title={feature.geometry.type}
      side="right"
      onClose={closePanel}
      footer={
        <>
          <span className="truncate font-mono">ID · {feature.id}</span>
          <span>{layer.crs}</span>
        </>
      }
    >
      <div className="flex flex-col gap-[7px] border-b border-line pb-3">
        <KeyValue label="Layer" value={layer.name} />
        <KeyValue label="Geometry" value={feature.geometry.type} />
        <KeyValue label="Vertices" value={`${vertices}`} />
        {length > 0 ? (
          <KeyValue
            label={feature.geometry.type.includes("Polygon") ? "Perimeter" : "Length"}
            value={formatDistance(length)}
          />
        ) : null}
        {area > 0 ? <KeyValue label="Area" value={formatArea(area)} /> : null}
      </div>

      <SectionLabel trailing={`${attributes.length}`}>Attributes</SectionLabel>
      {attributes.length ? (
        <div className="flex flex-col gap-[7px]">
          {attributes.map(([name, value]) => (
            <div
              key={name}
              className="flex items-baseline justify-between gap-3 text-[10.5px]"
            >
              <span className="flex-none text-ink-muted">{name}</span>
              <strong className="truncate text-right font-medium">
                {displayValue(value)}
              </strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 text-[10.5px] text-ink-muted">
          This feature carries no attributes.
        </p>
      )}

      {centroid ? (
        <OnlineContext
          properties={feature.properties}
          lon={centroid[0]}
          lat={centroid[1]}
        />
      ) : null}

      {geographicVertex ? (
        <>
          <SectionLabel>First vertex</SectionLabel>
          <div className="flex flex-col gap-[7px]">
            <KeyValue
              label="Geographic"
              value={
                <code className="font-mono text-[9.5px]">
                  {formatLat(geographicVertex[1], coordFormat)}{" "}
                  {formatLon(geographicVertex[0], coordFormat)}
                </code>
              }
            />
            <KeyValue
              label={layer.crs}
              value={
                <code className="font-mono text-[9.5px]">
                  {vertex?.[0].toFixed(3)}, {vertex?.[1].toFixed(3)}
                </code>
              }
            />
          </div>
        </>
      ) : null}

      <div className="mt-3.5 grid grid-cols-[1fr_auto] gap-1.5">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          onClick={() => zoomToSelection()}
        >
          <Frame size={13} strokeWidth={1.8} aria-hidden="true" />
          Zoom to feature
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          onClick={() =>
            copy(
              geographicVertex
                ? `${geographicVertex[1].toFixed(6)}, ${geographicVertex[0].toFixed(6)}`
                : "",
              "Coordinates copied",
            )
          }
        >
          <Copy size={13} strokeWidth={1.8} aria-hidden="true" />
          Copy
        </button>
      </div>

      <button
        type="button"
        className={`${SECONDARY_BUTTON} mt-1.5 w-full`}
        onClick={() =>
          copy(JSON.stringify(feature.properties, null, 2), "Attributes copied")
        }
      >
        <Copy size={13} strokeWidth={1.8} aria-hidden="true" />
        Copy attributes as JSON
      </button>
    </PanelShell>
  );
}
