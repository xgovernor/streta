import type { Bookmark, BookmarkPriority, BookmarkStatus, BookmarkTier } from "./types";

/**
 * Converts a Web Mercator zoom level (0-22) to an approximate Google Earth / KML range in meters.
 */
export function zoomToKmlRange(zoom: number): number {
  const clamped = Math.max(0, Math.min(24, zoom));
  return Math.round(40075016 / Math.pow(2, clamped));
}

/**
 * Converts a KML range in meters to an approximate Web Mercator zoom level.
 */
export function kmlRangeToZoom(rangeMeters: number): number {
  if (!rangeMeters || rangeMeters <= 0) return 10;
  const zoom = Math.log2(40075016 / rangeMeters);
  return Math.max(1, Math.min(22, Math.round(zoom * 10) / 10));
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Serializes bookmarks to standard GeoJSON FeatureCollection.
 */
export function exportBookmarksToGeoJson(bookmarks: Bookmark[]): string {
  const featureCollection = {
    type: "FeatureCollection",
    features: bookmarks.map((b) => ({
      type: "Feature",
      id: b.id,
      geometry: {
        type: "Point",
        coordinates: [b.lon, b.lat],
      },
      properties: {
        id: b.id,
        title: b.title,
        notes: b.notes ?? "",
        tier: b.tier ?? "project",
        priority: b.priority ?? "routine",
        status: b.status ?? "active",
        category: b.category ?? "",
        color: b.color ?? "#00e5ff",
        icon: b.icon ?? "pin",
        zoom: b.zoom,
        rotation: b.rotation ?? 0,
        pitch: b.pitch ?? 0,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt ?? b.createdAt,
      },
    })),
  };

  return JSON.stringify(featureCollection, null, 2);
}

/**
 * Parses GeoJSON text and extracts Bookmark items.
 */
export function importBookmarksFromGeoJson(
  geoJsonText: string,
  targetTier: BookmarkTier = "project",
): Bookmark[] {
  let parsed: any;
  try {
    parsed = JSON.parse(geoJsonText);
  } catch (e) {
    throw new Error(`Invalid GeoJSON format: ${e instanceof Error ? e.message : String(e)}`);
  }

  const rawFeatures: any[] =
    parsed.type === "FeatureCollection" && Array.isArray(parsed.features)
      ? parsed.features
      : parsed.type === "Feature"
      ? [parsed]
      : [];

  const bookmarks: Bookmark[] = [];
  const now = Date.now();

  for (let i = 0; i < rawFeatures.length; i++) {
    const f = rawFeatures[i];
    if (!f || !f.geometry) continue;

    let coords: [number, number] | null = null;
    if (f.geometry.type === "Point" && Array.isArray(f.geometry.coordinates)) {
      coords = [Number(f.geometry.coordinates[0]), Number(f.geometry.coordinates[1])];
    } else if (f.geometry.coordinates && Array.isArray(f.geometry.coordinates)) {
      // Centroid or first point fallback
      const c = f.geometry.coordinates;
      if (Array.isArray(c[0])) {
        const pt = Array.isArray(c[0][0]) ? c[0][0] : c[0];
        coords = [Number(pt[0]), Number(pt[1])];
      }
    }

    if (!coords || isNaN(coords[0]) || isNaN(coords[1])) continue;

    const props = f.properties || {};
    const title = props.title || props.name || `Point ${i + 1}`;
    const notes = props.notes || props.description || props.desc || "";
    const zoom = Number(props.zoom) || 12;
    const rotation = Number(props.rotation) || 0;
    const pitch = Number(props.pitch) || 0;
    const color = props.color || props.marker_color || "#00e5ff";
    const priority = (props.priority as BookmarkPriority) || "routine";
    const status = (props.status as BookmarkStatus) || "active";
    const category = props.category || "";

    bookmarks.push({
      id: "bm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      tier: targetTier,
      title: String(title),
      notes: String(notes),
      lon: coords[0],
      lat: coords[1],
      zoom,
      rotation,
      pitch,
      color: String(color),
      priority,
      status,
      category: String(category),
      createdAt: Number(props.createdAt) || now,
      updatedAt: Number(props.updatedAt) || now,
    });
  }

  return bookmarks;
}

/**
 * Exports bookmarks to standard OGC KML 2.2 with <LookAt> camera parameters.
 */
export function exportBookmarksToKml(
  bookmarks: Bookmark[],
  documentName: string = "Strata Bookmarks",
): string {
  const placemarks = bookmarks
    .map((b) => {
      const headingDeg = Math.round((((b.rotation ?? 0) * 180) / Math.PI) % 360);
      const tiltDeg = Math.round(((b.pitch ?? 0) * 180) / Math.PI);
      const rangeMeters = zoomToKmlRange(b.zoom);
      const colorHex = (b.color || "#00e5ff").replace("#", "");

      return `    <Placemark>
      <name>${escapeXml(b.title)}</name>
      <description><![CDATA[${b.notes || ""}${b.category ? `\nCategory: ${b.category}` : ""}${b.priority ? `\nPriority: ${b.priority.toUpperCase()}` : ""}]]></description>
      <ExtendedData>
        <Data name="tier"><value>${b.tier ?? "project"}</value></Data>
        <Data name="priority"><value>${b.priority ?? "routine"}</value></Data>
        <Data name="status"><value>${b.status ?? "active"}</value></Data>
        <Data name="category"><value>${escapeXml(b.category ?? "")}</value></Data>
        <Data name="zoom"><value>${b.zoom}</value></Data>
        <Data name="color"><value>#${colorHex}</value></Data>
      </ExtendedData>
      <LookAt>
        <longitude>${b.lon}</longitude>
        <latitude>${b.lat}</latitude>
        <altitude>0</altitude>
        <heading>${headingDeg}</heading>
        <tilt>${tiltDeg}</tilt>
        <range>${rangeMeters}</range>
        <altitudeMode>relativeToGround</altitudeMode>
      </LookAt>
      <Point>
        <coordinates>${b.lon},${b.lat},0</coordinates>
      </Point>
    </Placemark>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(documentName)}</name>
${placemarks}
  </Document>
</kml>`;
}

/**
 * Parses KML text into Bookmark items.
 * Works across both Browser DOM and regex fallback for Bun/Node tests.
 */
export function importBookmarksFromKml(
  kmlText: string,
  targetTier: BookmarkTier = "project",
): Bookmark[] {
  const bookmarks: Bookmark[] = [];
  const now = Date.now();

  // Try standard DOMParser if present
  if (typeof DOMParser !== "undefined") {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(kmlText, "text/xml");
      const placemarks = doc.querySelectorAll("Placemark");

      placemarks.forEach((p, idx) => {
        const name = p.querySelector("name")?.textContent?.trim() || `Bookmark ${idx + 1}`;
        const desc = p.querySelector("description")?.textContent?.trim() || "";

        // Extract coordinates from <Point><coordinates>
        const coordText = p.querySelector("Point coordinates")?.textContent?.trim() || "";
        const parts = coordText.split(/[,\s]+/).filter(Boolean);
        if (parts.length < 2) return;

        const lon = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (isNaN(lon) || isNaN(lat)) return;

        // Camera / LookAt
        const rangeEl = p.querySelector("LookAt range, Camera range");
        const headingEl = p.querySelector("LookAt heading, Camera heading");
        const tiltEl = p.querySelector("LookAt tilt, Camera tilt");

        let zoom = 12;
        if (rangeEl && rangeEl.textContent) {
          zoom = kmlRangeToZoom(parseFloat(rangeEl.textContent));
        }

        let rotation = 0;
        if (headingEl && headingEl.textContent) {
          rotation = (parseFloat(headingEl.textContent) * Math.PI) / 180;
        }

        let pitch = 0;
        if (tiltEl && tiltEl.textContent) {
          pitch = (parseFloat(tiltEl.textContent) * Math.PI) / 180;
        }

        // Extended data tags
        const categoryData = p.querySelector('Data[name="category"] value')?.textContent || "";
        const priorityData = (p.querySelector('Data[name="priority"] value')?.textContent ||
          "routine") as BookmarkPriority;
        const colorData = p.querySelector('Data[name="color"] value')?.textContent || "#00e5ff";

        bookmarks.push({
          id: "bm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
          tier: targetTier,
          title: name,
          notes: desc,
          lon,
          lat,
          zoom,
          rotation,
          pitch,
          color: colorData,
          priority: priorityData,
          category: categoryData,
          createdAt: now,
          updatedAt: now,
        });
      });

      if (bookmarks.length > 0) return bookmarks;
    } catch {
      // Fallback to regex parser below
    }
  }

  // Regex-based robust fallback for testing / headless CLI
  const placemarkRegex = /<Placemark[\s\S]*?<\/Placemark>/gi;
  const matches = kmlText.match(placemarkRegex) || [];

  matches.forEach((pText, idx) => {
    const nameMatch = pText.match(/<name>(.*?)<\/name>/i);
    const title = nameMatch ? nameMatch[1].trim() : `Placemark ${idx + 1}`;

    const descMatch = pText.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
    const notes = descMatch ? descMatch[1].trim() : "";

    const coordsMatch = pText.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
    if (!coordsMatch) return;
    const parts = coordsMatch[1].trim().split(/[,\s]+/).filter(Boolean);
    if (parts.length < 2) return;

    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (isNaN(lon) || isNaN(lat)) return;

    const rangeMatch = pText.match(/<range>(.*?)<\/range>/i);
    const headingMatch = pText.match(/<heading>(.*?)<\/heading>/i);
    const tiltMatch = pText.match(/<tilt>(.*?)<\/tilt>/i);

    const zoom = rangeMatch ? kmlRangeToZoom(parseFloat(rangeMatch[1])) : 12;
    const rotation = headingMatch ? (parseFloat(headingMatch[1]) * Math.PI) / 180 : 0;
    const pitch = tiltMatch ? (parseFloat(tiltMatch[1]) * Math.PI) / 180 : 0;

    bookmarks.push({
      id: "bm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      tier: targetTier,
      title,
      notes,
      lon,
      lat,
      zoom,
      rotation,
      pitch,
      color: "#00e5ff",
      priority: "routine",
      createdAt: now,
      updatedAt: now,
    });
  });

  return bookmarks;
}

/**
 * Serializes bookmarks to CSV format.
 */
export function exportBookmarksToCsv(bookmarks: Bookmark[]): string {
  const headers = [
    "id",
    "title",
    "notes",
    "longitude",
    "latitude",
    "zoom",
    "rotation",
    "pitch",
    "tier",
    "priority",
    "status",
    "category",
    "color",
    "createdAt",
    "updatedAt",
  ];

  const rows = bookmarks.map((b) => [
    escapeCsvField(b.id),
    escapeCsvField(b.title),
    escapeCsvField(b.notes ?? ""),
    escapeCsvField(b.lon),
    escapeCsvField(b.lat),
    escapeCsvField(b.zoom),
    escapeCsvField(b.rotation ?? 0),
    escapeCsvField(b.pitch ?? 0),
    escapeCsvField(b.tier ?? "project"),
    escapeCsvField(b.priority ?? "routine"),
    escapeCsvField(b.status ?? "active"),
    escapeCsvField(b.category ?? ""),
    escapeCsvField(b.color ?? "#00e5ff"),
    escapeCsvField(b.createdAt),
    escapeCsvField(b.updatedAt ?? b.createdAt),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

/**
 * Parses CSV text into Bookmark items.
 */
export function importBookmarksFromCsv(
  csvText: string,
  targetTier: BookmarkTier = "project",
): Bookmark[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const headers = parseCsvLine(headerLine).map((h) => h.trim().toLowerCase());

  const lonIndex = headers.findIndex((h) =>
    ["longitude", "lon", "lng", "x", "easting"].includes(h),
  );
  const latIndex = headers.findIndex((h) =>
    ["latitude", "lat", "y", "northing"].includes(h),
  );
  const titleIndex = headers.findIndex((h) => ["title", "name", "label"].includes(h));
  const notesIndex = headers.findIndex((h) =>
    ["notes", "note", "desc", "description", "comment"].includes(h),
  );
  const zoomIndex = headers.findIndex((h) => ["zoom", "level", "z"].includes(h));
  const categoryIndex = headers.findIndex((h) => ["category", "mission", "group"].includes(h));
  const priorityIndex = headers.findIndex((h) => ["priority", "prio"].includes(h));
  const colorIndex = headers.findIndex((h) => ["color", "colour", "hex"].includes(h));
  const rotationIndex = headers.findIndex((h) => ["rotation", "bearing", "heading"].includes(h));

  if (lonIndex === -1 || latIndex === -1) {
    throw new Error("CSV must contain 'longitude' (or lon/x) and 'latitude' (or lat/y) columns.");
  }

  const bookmarks: Bookmark[] = [];
  const now = Date.now();

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (!values[lonIndex] || !values[latIndex]) continue;

    const lon = parseFloat(values[lonIndex]);
    const lat = parseFloat(values[latIndex]);
    if (isNaN(lon) || isNaN(lat)) continue;

    const title =
      titleIndex !== -1 && values[titleIndex] ? values[titleIndex].trim() : `Point ${i}`;
    const notes = notesIndex !== -1 && values[notesIndex] ? values[notesIndex].trim() : "";
    const zoom = zoomIndex !== -1 && parseFloat(values[zoomIndex]) ? parseFloat(values[zoomIndex]) : 12;
    const category = categoryIndex !== -1 && values[categoryIndex] ? values[categoryIndex].trim() : "";
    const priority =
      priorityIndex !== -1 && values[priorityIndex]
        ? (values[priorityIndex].toLowerCase().trim() as BookmarkPriority)
        : "routine";
    const color = colorIndex !== -1 && values[colorIndex] ? values[colorIndex].trim() : "#00e5ff";
    const rotation =
      rotationIndex !== -1 && parseFloat(values[rotationIndex])
        ? parseFloat(values[rotationIndex])
        : 0;

    bookmarks.push({
      id: "bm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      tier: targetTier,
      title,
      notes,
      lon,
      lat,
      zoom,
      rotation,
      pitch: 0,
      color,
      category,
      priority,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }

  return bookmarks;
}

