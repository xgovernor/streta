import type { Attributes } from "../gis/types";

/**
 * Online context for a feature: where it is, what Wikipedia says about it, and
 * the full OpenStreetMap tags behind it when the layer only kept a few.
 *
 * Three public services are involved, each with its own manners: Nominatim
 * accepts one request a second and wants an identifiable client, Overpass is a
 * shared and slow resource, and Wikipedia's REST API is cheap. Everything here
 * is cached per feature and throttled per host, so clicking the same feature
 * again costs nothing and a burst of clicks queues instead of hammering.
 */

const GAP_MS: Record<string, number> = {
  "nominatim.openstreetmap.org": 1100,
  "overpass-api.de": 1200,
};

const lastCall = new Map<string, number>();
const chains = new Map<string, Promise<unknown>>();
const cache = new Map<string, Promise<unknown>>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `task` after the host's other requests, honouring a minimum gap. */
function politely<T>(host: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(host) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const gap = GAP_MS[host] ?? 0;
    const wait = (lastCall.get(host) ?? 0) + gap - Date.now();

    if (wait > 0) {
      await sleep(wait);
    }

    lastCall.set(host, Date.now());
    return task();
  });

  chains.set(host, next.catch(() => undefined));
  return next;
}

/** One cached promise per key, so two panels asking at once share one request. */
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = cache.get(key) as Promise<T> | undefined;

  if (existing) {
    return existing;
  }

  const pending = load().catch((error: unknown) => {
    // A failed lookup is not cached: a retry should reach the network again.
    cache.delete(key);
    throw error;
  });

  cache.set(key, pending);
  return pending;
}

async function getJson<T>(host: string, url: string, init?: RequestInit): Promise<T> {
  return politely(host, async () => {
    const response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      throw new Error(`${host} answered HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  });
}

export interface PlaceContext {
  name: string;
  /** City, region and country, in that order, without repeats. */
  detail: string;
  kind: string | null;
}

interface NominatimResponse {
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
}

const ADDRESS_PARTS = [
  "house_number",
  "road",
  "neighbourhood",
  "suburb",
  "city",
  "town",
  "village",
  "municipality",
  "county",
  "state",
  "country",
];

/** The readable line under the place name, from Nominatim's address object. */
export function addressLine(address: Record<string, string> | undefined): string {
  if (!address) {
    return "";
  }

  const parts: string[] = [];

  for (const key of ADDRESS_PARTS) {
    const value = address[key]?.trim();

    if (value && !parts.includes(value)) {
      parts.push(value);
    }
  }

  return parts.join(", ");
}

export function placeFromNominatim(json: NominatimResponse): PlaceContext | null {
  const name = (json.name ?? "").trim();
  const display = (json.display_name ?? "").trim();

  if (!name && !display) {
    return null;
  }

  const detail = addressLine(json.address);

  return {
    // Settlements often have no `name`, only a display line ending in the country.
    name: name || display.split(",")[0]?.trim() || display,
    detail: detail || display,
    kind: json.category && json.type ? `${json.category} · ${json.type}` : null,
  };
}

/** Reverse geocoding, rounded to about a metre so jitter does not re-request. */
export function placeAt(lon: number, lat: number): Promise<PlaceContext | null> {
  const key = `place:${lon.toFixed(5)},${lat.toFixed(5)}`;

  return cached(key, async () => {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", lat.toFixed(6));
    url.searchParams.set("lon", lon.toFixed(6));
    url.searchParams.set("zoom", "16");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "en");

    const json = await getJson<NominatimResponse>(
      "nominatim.openstreetmap.org",
      url.toString(),
    );

    return placeFromNominatim(json);
  });
}

export interface WikiContext {
  title: string;
  extract: string;
  url: string;
  thumbnail: string | null;
  lang: string;
}

export interface WikiTarget {
  lang: string;
  title: string;
  /** True when the title had to be resolved through Wikidata. */
  viaWikidata: boolean;
}

/**
 * The Wikipedia article a feature points at. OSM features carry either a
 * `wikipedia` tag (`en:Zurich`) or a `wikidata` id (`Q72`), and both are read.
 */
export function wikipediaTarget(properties: Attributes): WikiTarget | null {
  const wikipedia = properties.wikipedia;
  const wikidata = properties.wikidata;

  if (typeof wikipedia === "string" && wikipedia.includes(":")) {
    const [lang, ...rest] = wikipedia.split(":");
    const title = rest.join(":").trim();

    if (lang.trim() && title) {
      return { lang: lang.trim(), title, viaWikidata: false };
    }
  }

  if (typeof wikidata === "string" && /^Q\d+$/.test(wikidata.trim())) {
    return { lang: "en", title: wikidata.trim(), viaWikidata: true };
  }

  return null;
}

interface WikidataResponse {
  entities?: Record<
    string,
    { sitelinks?: Record<string, { title?: string }> }
  >;
}

interface WikiSummaryResponse {
  title?: string;
  extract?: string;
  thumbnail?: { source?: string };
  content_urls?: { desktop?: { page?: string } };
}

export function wikiFromSummary(
  json: WikiSummaryResponse,
  lang: string,
): WikiContext | null {
  const title = (json.title ?? "").trim();
  const extract = (json.extract ?? "").trim();

  if (!title || !extract) {
    return null;
  }

  return {
    title,
    extract,
    lang,
    url:
      json.content_urls?.desktop?.page ??
      `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    thumbnail: json.thumbnail?.source ?? null,
  };
}

export function wikiContext(properties: Attributes): Promise<WikiContext | null> {
  const target = wikipediaTarget(properties);

  if (!target) {
    return Promise.resolve(null);
  }

  const key = `wiki:${target.lang}:${target.title}`;

  return cached(key, async () => {
    let lang = target.lang;
    let title = target.title;

    if (target.viaWikidata) {
      const url = new URL("https://www.wikidata.org/w/api.php");
      url.searchParams.set("action", "wbgetentities");
      url.searchParams.set("ids", target.title);
      url.searchParams.set("props", "sitelinks");
      url.searchParams.set("sitefilter", "enwiki");
      url.searchParams.set("format", "json");
      url.searchParams.set("origin", "*");

      const entity = await getJson<WikidataResponse>("www.wikidata.org", url.toString());
      const linked = entity.entities?.[target.title]?.sitelinks?.enwiki?.title;

      if (!linked) {
        return null;
      }

      lang = "en";
      title = linked;
    }

    const summary = await getJson<WikiSummaryResponse>(
      `${lang}.wikipedia.org`,
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    );

    return wikiFromSummary(summary, lang);
  });
}

export interface OsmRef {
  /** Node, way or relation, when the id says so. */
  type: "node" | "way" | "relation" | null;
  id: string;
}

/**
 * OSM ids arrive in a few shapes: `r122949`, `way/123`, `node 42`, or a bare
 * (sometimes signed) number whose type the extract dropped.
 */
export function parseOsmRef(raw: string): OsmRef | null {
  const value = raw.trim();

  const named = value.match(/^(node|way|relation)[\s/:-]*(\d+)$/i);

  if (named) {
    return {
      type: named[1].toLowerCase() as OsmRef["type"],
      id: named[2],
    };
  }

  const prefixed = value.match(/^([nwr])(\d+)$/i);

  if (prefixed) {
    const types = { n: "node", w: "way", r: "relation" } as const;
    const type = types[prefixed[1].toLowerCase() as keyof typeof types];

    return { type, id: prefixed[2] };
  }

  const bare = value.match(/^-?(\d+)$/);

  if (bare) {
    return { type: null, id: bare[1] };
  }

  return null;
}

export interface OsmContext {
  type: string;
  id: string;
  tags: [string, string][];
  url: string;
}

interface OverpassResponse {
  elements?: {
    type?: string;
    id?: number;
    tags?: Record<string, string>;
  }[];
}

/** Overpass only sees three element types, so an unknown id is asked for as all. */
export function overpassQuery(ref: OsmRef): string {
  const selector = ref.type ?? "node";

  if (ref.type) {
    return `[out:json][timeout:12];${selector}(${ref.id});out tags;`;
  }

  return `[out:json][timeout:12];(${["node", "way", "relation"].map((type) => `${type}(${ref.id});`).join("")});out tags;`;
}

export function osmFromOverpass(
  json: OverpassResponse,
  fallback: OsmRef,
): OsmContext | null {
  const element = json.elements?.find((item) => item.tags && Object.keys(item.tags).length);

  if (!element?.id) {
    return null;
  }

  const type = element.type ?? fallback.type ?? "node";
  const id = String(element.id);

  return {
    type,
    id,
    tags: Object.entries(element.tags ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
    url: `https://www.openstreetmap.org/${type}/${id}`,
  };
}

export function osmContext(properties: Attributes): Promise<OsmContext | null> {
  const raw = properties.osm_id;
  const ref = typeof raw === "string" || typeof raw === "number" ? parseOsmRef(String(raw)) : null;

  if (!ref) {
    return Promise.resolve(null);
  }

  const key = `osm:${ref.type ?? "any"}:${ref.id}`;

  return cached(key, async () => {
    const url = new URL("https://overpass-api.de/api/interpreter");
    url.searchParams.set("data", overpassQuery(ref));

    const json = await getJson<OverpassResponse>(
      "overpass-api.de",
      url.toString(),
    );

    return osmFromOverpass(json, ref);
  });
}
