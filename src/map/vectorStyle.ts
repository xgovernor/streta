import type { FeatureLike } from "ol/Feature";
import type { Geometry } from "ol/geom";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import type { DatasetLayer, LayerStyle } from "../lib/gis/types";

const SELECTION_COLOR = "#ff8a4d";
const LABEL_COLOR = "#101820";
const LABEL_HALO = "rgba(255,255,255,.94)";

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
  return (feature: FeatureLike, resolution: number): Style[] => {
    const geometry = feature.getGeometry() as Geometry | undefined;
    const type = geometry?.getType() ?? "Point";
    const selected = isSelected(String(feature.getId() ?? ""));
    const options: StyleOptions = { resolution, selected, kind: type };
    const label = labelFor(feature, layer.style.labelField);

    switch (type) {
      case "Point":
      case "MultiPoint":
        return pointStyle(layer.style, options, label);
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
