import type { FeatureLike } from "ol/Feature";
import type { Geometry } from "ol/geom";
import { Circle as CircleStyle, Fill, Icon, Stroke, Style, Text } from "ol/style";
import type { DatasetLayer, LayerStyle } from "../lib/gis/types";

const SELECTION_COLOR = "#ff8a4d";
const LABEL_COLOR = "#101820";
const LABEL_HALO = "rgba(255,255,255,.94)";

const cameraIconCache = new Map<string, Style>();

function createCameraSvgUri(
  color: string,
  selected: boolean,
  headingDeg: number | null,
): string {
  const size = 32;
  const center = 16;
  const badgeRadius = selected ? 12 : 10.5;
  const strokeColor = "#ffffff";
  const strokeWidth = selected ? 2.2 : 1.6;

  // Direction pointer arrow if heading is known
  const pointerSvg =
    headingDeg != null ?
      `<g transform="rotate(${headingDeg}, ${center}, ${center})">
        <polygon points="${center},1.5 ${center - 3.5},5.5 ${center + 3.5},5.5" fill="${color}" stroke="${strokeColor}" stroke-width="1.2" stroke-linejoin="round" />
      </g>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${pointerSvg}
    <circle cx="${center}" cy="${center}" r="${badgeRadius}" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />
    <g transform="translate(9, 9)">
      <path d="M4 1.5h6l1.2 1.5H13a1.5 1.5 0 0 1 1.5 1.5v6.5a1.5 1.5 0 0 1-1.5 1.5H1a1.5 1.5 0 0 1-1.5-1.5v-6.5A1.5 1.5 0 0 1 1 3h1.8L4 1.5z" fill="#ffffff" />
      <circle cx="7" cy="7.2" r="2.2" fill="${color}" />
    </g>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function cameraPointStyle(
  style: LayerStyle,
  options: StyleOptions,
  label: string,
  headingDeg: number | null,
): Style[] {
  const normHeading =
    headingDeg != null ?
      Math.round(((headingDeg % 360) + 360) % 360 / 5) * 5
    : null;
  const cacheKey = `${style.color}_${options.selected ? "1" : "0"}_${normHeading ?? "none"}`;

  let iconStyle = cameraIconCache.get(cacheKey);
  if (!iconStyle) {
    const svgUri = createCameraSvgUri(style.color, options.selected, normHeading);
    iconStyle = new Style({
      image: new Icon({
        src: svgUri,
        width: 30,
        height: 30,
      }),
      zIndex: options.selected ? 15 : 6,
    });
    cameraIconCache.set(cacheKey, iconStyle);
  }

  const styles: Style[] = [];

  if (options.selected) {
    styles.push(
      new Style({
        image: new CircleStyle({
          radius: 17,
          fill: new Fill({ color: alpha(SELECTION_COLOR, 0.22) }),
          stroke: new Stroke({
            color: alpha(SELECTION_COLOR, 0.95),
            width: 2,
          }),
        }),
        zIndex: 14,
      }),
    );
  }

  styles.push(iconStyle);

  if (label && options.resolution < 3200) {
    styles.push(
      new Style({
        text: new Text({
          text: label,
          font: '500 11px "IBM Plex Mono", monospace',
          offsetY: -20,
          fill: new Fill({ color: LABEL_COLOR }),
          stroke: new Stroke({ color: LABEL_HALO, width: 3 }),
          overflow: true,
        }),
        zIndex: options.selected ? 16 : 7,
      }),
    );
  }

  return styles;
}

function alpha(color: string, opacity: number): string {
  const hex = color.replace("#", "");

  if (hex.length !== 6) {
    return color;
  }

  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function labelFor(feature: FeatureLike, field: string | null): string {
  if (!field) {
    return "";
  }

  const value = feature.get(field);
  return value === null || value === undefined ? "" : String(value);
}

interface StyleOptions {
  resolution: number;
  selected: boolean;
  kind: string;
}

function pointStyle(
  style: LayerStyle,
  options: StyleOptions,
  label: string,
): Style[] {
  const radius = style.pointRadius + (options.selected ? 2 : 0);

  const point = new Style({
    image: new CircleStyle({
      radius,
      fill: new Fill({ color: style.color }),
      stroke: new Stroke({
        color: "#ffffff",
        width: options.selected ? 2.2 : 1.5,
      }),
    }),
    text:
      label && options.resolution < 3200 ?
        new Text({
          text: label,
          font: '500 11px "IBM Plex Mono", monospace',
          offsetY: -17,
          fill: new Fill({ color: LABEL_COLOR }),
          stroke: new Stroke({ color: LABEL_HALO, width: 3 }),
          overflow: true,
        })
      : undefined,
    zIndex: options.selected ? 12 : 5,
  });

  if (!options.selected) {
    return [point];
  }

  return [
    new Style({
      image: new CircleStyle({
        radius: radius + 6,
        fill: new Fill({ color: alpha(SELECTION_COLOR, 0.16) }),
        stroke: new Stroke({
          color: alpha(SELECTION_COLOR, 0.92),
          width: 1.25,
        }),
      }),
      zIndex: 11,
    }),
    point,
  ];
}

function lineStyle(style: LayerStyle, options: StyleOptions): Style[] {
  const width = style.strokeWidth + (options.selected ? 1.8 : 0);

  return [
    new Style({
      stroke: new Stroke({
        color: options.selected ? SELECTION_COLOR : style.color,
        width,
        lineCap: "round",
        lineJoin: "round",
      }),
      zIndex: options.selected ? 12 : 5,
    }),
  ];
}

function polygonStyle(
  style: LayerStyle,
  options: StyleOptions,
  label: string,
): Style[] {
  return [
    new Style({
      fill: new Fill({
        color: alpha(
          options.selected ? SELECTION_COLOR : style.color,
          options.selected ?
            Math.max(0.18, style.fillOpacity)
          : style.fillOpacity,
        ),
      }),
      stroke: new Stroke({
        color: options.selected ? SELECTION_COLOR : style.color,
        width: style.strokeWidth + (options.selected ? 1.4 : 0),
        lineJoin: "round",
      }),
      text:
        label && options.resolution < 3200 ?
          new Text({
            text: label,
            font: '500 11px "IBM Plex Mono", monospace',
            fill: new Fill({ color: LABEL_COLOR }),
            stroke: new Stroke({ color: LABEL_HALO, width: 3 }),
            overflow: true,
          })
        : undefined,
      zIndex: options.selected ? 12 : 5,
    }),
  ];
}

/**
 * Builds the style function for a dataset. The selection is read at render
 * time, so selecting a feature only needs a repaint, never a source rebuild.
 */
export function createDatasetStyle(
  layer: DatasetLayer,
  isSelected: (featureId: string) => boolean,
) {
  const isCameraLayer =
    /camera|cctv/i.test(layer.name) ||
    (typeof layer.source === "string" && /cctv/i.test(layer.source));

  return (feature: FeatureLike, resolution: number): Style[] => {
    const geom = (feature as { getGeometry?: () => Geometry | undefined }).getGeometry?.();
    const type =
      (feature as { getType?: () => string }).getType?.() ??
      geom?.getType() ??
      "Point";
    const rawId =
      feature.getId?.() ??
      feature.get("_id") ??
      feature.get("id") ??
      "";
    const featureId = String(rawId);
    const selected = isSelected(featureId);
    const options: StyleOptions = { resolution, selected, kind: type };
    const label = labelFor(feature, layer.style.labelField);

    switch (type) {
      case "Point":
      case "MultiPoint": {
        const hasCameraProps =
          isCameraLayer ||
          feature.get("snapshot_url") !== undefined ||
          feature.get("mount_height_m") !== undefined ||
          featureId.startsWith("cctv-cam-");

        if (hasCameraProps) {
          const rawHeading = feature.get("heading_deg");
          const headingDeg =
            typeof rawHeading === "number" && Number.isFinite(rawHeading) ?
              rawHeading
            : null;
          return cameraPointStyle(layer.style, options, label, headingDeg);
        }

        return pointStyle(layer.style, options, label);
      }
      case "Polygon":
      case "MultiPolygon":
        return polygonStyle(layer.style, options, label);
      default:
        return lineStyle(layer.style, options);
    }
  };
}

/** Style for the measure sketch: accent line, vertices and live segment labels. */
export function measureStyle(
  _feature: FeatureLike,
  resolution: number,
): Style[] {
  const styles: Style[] = [
    new Style({
      stroke: new Stroke({
        color: SELECTION_COLOR,
        width: 2,
        lineDash: [7, 5],
        lineCap: "round",
      }),
      fill: new Fill({ color: alpha(SELECTION_COLOR, 0.14) }),
    }),
    new Style({
      image: new CircleStyle({
        radius: 3.5,
        fill: new Fill({ color: "#ffffff" }),
        stroke: new Stroke({ color: SELECTION_COLOR, width: 1.6 }),
      }),
    }),
  ];

  if (resolution > 4000) {
    return styles;
  }

  return styles;
}

export { alpha as withAlpha };
