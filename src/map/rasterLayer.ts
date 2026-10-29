import GeoTIFF from "ol/source/GeoTIFF";
import WebGLTileLayer from "ol/layer/WebGLTile";
import type { Pixel } from "ol/pixel";

export type RasterFormula =
  | "NDVI"
  | "NDWI"
  | "NDBI"
  | "NBR"
  | "CIR"
  | "RGB"
  | "Elevation";

export interface RasterLayerConfig {
  layerId: string;
  name: string;
  kind: "multispectral" | "elevation";
  bands: Record<string, string>; // Maps band name (e.g. 'B04') to strata://cog/...
  bandOrder?: string[];
  initialFormula?: RasterFormula;
  opacity?: number;
  contrastScale?: number;
}

export interface PixelProbeData {
  coordinate: [number, number]; // [lon, lat]
  activeFormula: RasterFormula;
  computedValue: number | null;
  formattedValue: string;
  interpretation: string;
  rawBands: Record<string, number>;
}

export const MULTISPECTRAL_DEFAULT_BANDS = [
  "B02", // 1: Blue
  "B03", // 2: Green
  "B04", // 3: Red
  "B08", // 4: NIR
  "B11", // 5: SWIR-1
  "B12", // 6: SWIR-2
];

/**
 * Strict Architectural Enforcement:
 * Asserts that all source URLs are routed through strata://cog/...
 * External https:// requests are strictly prohibited per Master Spec (Sections 1.2, 5.1, 5.3).
 */
export function validateStrataCogUrl(url: string): void {
  if (!url.startsWith("strata://cog/")) {
    throw new Error(
      `Architectural Violation: WebView cannot make direct external requests. URL must start with strata://cog/. Got: "${url}"`,
    );
  }
}

/**
 * Generates OpenLayers WebGLTile style expressions with divide-by-zero guards (1e-6).
 */
export function buildRasterStyle(
  formula: RasterFormula,
  bandIndices: {
    b02: number;
    b03: number;
    b04: number;
    b08: number;
    b11: number;
    b12: number;
    elevation: number;
  },
  contrastScale = 1.0 / 3000.0,
): Record<string, any> {
  const { b02, b03, b04, b08, b11, b12, elevation } = bandIndices;

  switch (formula) {
    case "NDVI": {
      // (B08 - B04) / (B08 + B04 + 1e-6)
      const ndvi = [
        "/",
        ["-", ["band", b08], ["band", b04]],
        ["+", ["band", b08], ["band", b04], 1e-6],
      ];
      return {
        variables: { contrastScale },
        color: [
          "interpolate",
          ["linear"],
          ndvi,
          -0.2,
          "#0c2c84", // Water / snow
          0.0,
          "#ffffcc", // Bare rock / sand
          0.2,
          "#c2e699", // Sparse vegetation
          0.4,
          "#78c679", // Moderate shrubs/grass
          0.6,
          "#31a354", // Dense cropland
          0.85,
          "#006837", // Lush forest canopy
        ],
      };
    }

    case "NDWI": {
      // (B03 - B08) / (B03 + B08 + 1e-6)
      const ndwi = [
        "/",
        ["-", ["band", b03], ["band", b08]],
        ["+", ["band", b03], ["band", b08], 1e-6],
      ];
      return {
        variables: { contrastScale },
        color: [
          "interpolate",
          ["linear"],
          ndwi,
          -0.5,
          "#8c510a", // Dry land / forest
          -0.1,
          "#dfc27d", // Low moisture soil
          0.0,
          "#f5f5f5", // Shoreline / neutral
          0.1,
          "#80cdc1", // Shallow / turbid water
          0.3,
          "#35978f", // Clear water
          0.6,
          "#01665e", // Deep clear reservoir/sea
        ],
      };
    }

    case "NDBI": {
      // (B11 - B08) / (B11 + B08 + 1e-6)
      const ndbi = [
        "/",
        ["-", ["band", b11], ["band", b08]],
        ["+", ["band", b11], ["band", b08], 1e-6],
      ];
      return {
        variables: { contrastScale },
        color: [
          "interpolate",
          ["linear"],
          ndbi,
          -0.6,
          "#1a9850", // High biomass (non-urban)
          -0.2,
          "#91cf60", // Mixed vegetation
          0.0,
          "#ffffbf", // Bare soil / transitional
          0.15,
          "#fee08b", // Low-density urban
          0.35,
          "#fc8d59", // Commercial / industrial
          0.6,
          "#d73027", // Dense concrete & asphalt
        ],
      };
    }

    case "NBR": {
      // (B08 - B12) / (B08 + B12 + 1e-6)
      const nbr = [
        "/",
        ["-", ["band", b08], ["band", b12]],
        ["+", ["band", b08], ["band", b12], 1e-6],
      ];
      return {
        variables: { contrastScale },
        color: [
          "interpolate",
          ["linear"],
          nbr,
          -0.4,
          "#49006a", // High burn severity / charcoal
          -0.1,
          "#ae017e", // Moderate-high burn
          0.1,
          "#f768a1", // Low burn severity
          0.25,
          "#fa9fb5", // Unburned sparse
          0.45,
          "#78c679", // Moderate forest
          0.7,
          "#006837", // Unburned healthy dense canopy
        ],
      };
    }

    case "CIR": {
      // Color Infrared (False Color): NIR (B08) -> Red, Red (B04) -> Green, Green (B03) -> Blue
      return {
        variables: { contrastScale },
        color: [
          "array",
          ["clamp", ["*", ["band", b08], ["var", "contrastScale"]], 0, 1],
          ["clamp", ["*", ["band", b04], ["var", "contrastScale"]], 0, 1],
          ["clamp", ["*", ["band", b03], ["var", "contrastScale"]], 0, 1],
          1.0,
        ],
      };
    }

    case "RGB": {
      // Natural True Color: Red (B04), Green (B03), Blue (B02)
      return {
        variables: { contrastScale },
        color: [
          "array",
          ["clamp", ["*", ["band", b04], ["var", "contrastScale"]], 0, 1],
          ["clamp", ["*", ["band", b03], ["var", "contrastScale"]], 0, 1],
          ["clamp", ["*", ["band", b02], ["var", "contrastScale"]], 0, 1],
          1.0,
        ],
      };
    }

    case "Elevation":
    default: {
      // Hypsometric tint for DEM elevation raster (meters)
      return {
        variables: { contrastScale },
        color: [
          "interpolate",
          ["linear"],
          ["band", elevation],
          -50,
          "#023858", // Sub-sea depression
          0,
          "#045a8d", // Sea level
          100,
          "#41b6c4", // Coastal plain
          400,
          "#78c679", // Lowland green
          1000,
          "#c2e699", // Foothills
          1800,
          "#fe9929", // Sub-alpine
          2800,
          "#d95f0e", // Rocky alpine ridge
          4200,
          "#ffffff", // Glacial peak
        ],
      };
    }
  }
}

/**
 * Creates an OpenLayers WebGLTileLayer driven by an ol/source/GeoTIFF.
 * Strictly guarantees that all sources are strata://cog/... URLs.
 */
export function createCogLayer(config: RasterLayerConfig): {
  layer: WebGLTileLayer;
  source: GeoTIFF;
  bandOrder: string[];
  setFormula: (formula: RasterFormula) => void;
  setOpacity: (opacity: number) => void;
  setContrastScale: (scale: number) => void;
} {
  const isMultispectral = config.kind === "multispectral";
  const bandOrder =
    config.bandOrder ??
    (isMultispectral ? MULTISPECTRAL_DEFAULT_BANDS : ["elevation"]);

  // Build GeoTIFF SourceInfo array — strictly enforcing strata://cog/... URLs
  const sources = bandOrder.map((bandName) => {
    const rawUrl =
      config.bands[bandName] ?? `strata://cog/${config.layerId}/${bandName}`;
    validateStrataCogUrl(rawUrl);
    return {
      url: rawUrl,
    };
  });

  const source = new GeoTIFF({
    normalize: false,
    loadMissingProjection: true,
    sources,
  });

  const bandIndices = {
    b02: Math.max(1, bandOrder.indexOf("B02") + 1),
    b03: Math.max(1, bandOrder.indexOf("B03") + 1),
    b04: Math.max(1, bandOrder.indexOf("B04") + 1),
    b08: Math.max(1, bandOrder.indexOf("B08") + 1),
    b11: Math.max(1, bandOrder.indexOf("B11") + 1),
    b12: Math.max(1, bandOrder.indexOf("B12") + 1),
    elevation: Math.max(
      1,
      bandOrder.indexOf("elevation") >= 0
        ? bandOrder.indexOf("elevation") + 1
        : 1,
    ),
  };

  let currentFormula =
    config.initialFormula ?? (isMultispectral ? "NDVI" : "Elevation");
  let currentContrast = config.contrastScale ?? 1.0 / 3000.0;

  const initialStyle = buildRasterStyle(
    currentFormula,
    bandIndices,
    currentContrast,
  );

  const layer = new WebGLTileLayer({
    source,
    style: initialStyle,
    opacity: config.opacity ?? 0.9,
    properties: {
      id: config.layerId,
      name: config.name,
      isRaster: true,
      kind: config.kind,
    },
  });

  return {
    layer,
    source,
    bandOrder,
    setFormula: (formula: RasterFormula) => {
      currentFormula = formula;
      layer.setStyle(
        buildRasterStyle(currentFormula, bandIndices, currentContrast),
      );
    },
    setOpacity: (opacity: number) => {
      layer.setOpacity(Math.max(0, Math.min(1, opacity)));
    },
    setContrastScale: (scale: number) => {
      currentContrast = scale;
      layer.setStyle(
        buildRasterStyle(currentFormula, bandIndices, currentContrast),
      );
    },
  };
}

/**
 * Synchronous client-side pixel probe extracting raw band values directly
 * from WebGL tile texture memory via `layer.getData(pixel)`.
 * Executed on pointermove in < 0.1ms without IPC overhead.
 */
export function sampleRasterPixel(
  layer: WebGLTileLayer,
  pixel: Pixel,
  coord: [number, number],
  bandOrder: string[],
  activeFormula: RasterFormula,
): PixelProbeData | null {
  const data = layer.getData(pixel);
  if (!data) {
    return null;
  }

  const isDataView = data instanceof DataView;
  const bytesPerSample =
    isDataView && bandOrder.length > 0
      ? Math.max(1, Math.floor(data.byteLength / bandOrder.length))
      : 4;
  const dataLen = isDataView
    ? Math.floor(data.byteLength / bytesPerSample)
    : data.length;

  if (dataLen === 0) {
    return null;
  }

  const getValueAt = (index: number): number => {
    if (isDataView) {
      if (bytesPerSample === 2) {
        if (index * 2 + 2 <= data.byteLength) {
          return data.getUint16(index * 2, true);
        }
        return 0;
      } else if (bytesPerSample === 1) {
        if (index < data.byteLength) {
          return data.getUint8(index);
        }
        return 0;
      } else {
        if (index * 4 + 4 <= data.byteLength) {
          return data.getFloat32(index * 4, true);
        }
        return 0;
      }
    }
    return Number((data as ArrayLike<number>)[index] ?? 0);
  };

  // Check if pixel is empty or transparent
  let hasSignal = false;
  const rawBands: Record<string, number> = {};

  for (let i = 0; i < bandOrder.length && i < dataLen; i++) {
    const val = getValueAt(i);
    rawBands[bandOrder[i]] = val;
    if (val !== 0 && !isNaN(val)) {
      hasSignal = true;
    }
  }

  if (!hasSignal) {
    return null;
  }

  let computedValue: number | null = null;
  let formattedValue = "—";
  let interpretation = "No active analysis";

  const b02 = rawBands["B02"] ?? 0;
  const b03 = rawBands["B03"] ?? 0;
  const b04 = rawBands["B04"] ?? 0;
  const b08 = rawBands["B08"] ?? 0;
  const b11 = rawBands["B11"] ?? 0;
  const b12 = rawBands["B12"] ?? 0;
  const elev = rawBands["elevation"] ?? rawBands["B01"] ?? getValueAt(0);

  switch (activeFormula) {
    case "NDVI": {
      // (B08 - B04) / (B08 + B04 + 1e-6)
      const val = (b08 - b04) / (b08 + b04 + 1e-6);
      computedValue = Math.max(-1, Math.min(1, val));
      formattedValue = computedValue.toFixed(3);
      if (computedValue > 0.6) {
        interpretation = "Dense, healthy forest canopy";
      } else if (computedValue > 0.35) {
        interpretation = "Moderate vegetation / shrubs / crops";
      } else if (computedValue > 0.1) {
        interpretation = "Sparse grass / arid vegetation";
      } else if (computedValue > 0.0) {
        interpretation = "Bare soil / rock / sand";
      } else {
        interpretation = "Open water body or snow/cloud cover";
      }
      break;
    }

    case "NDWI": {
      // (B03 - B08) / (B03 + B08 + 1e-6)
      const val = (b03 - b08) / (b03 + b08 + 1e-6);
      computedValue = Math.max(-1, Math.min(1, val));
      formattedValue = computedValue.toFixed(3);
      if (computedValue > 0.2) {
        interpretation = "Clear, open water surface";
      } else if (computedValue > 0.0) {
        interpretation = "Wetland / high moisture boundary";
      } else {
        interpretation = "Terrestrial surface / non-water";
      }
      break;
    }

    case "NDBI": {
      // (B11 - B08) / (B11 + B08 + 1e-6)
      const val = (b11 - b08) / (b11 + b08 + 1e-6);
      computedValue = Math.max(-1, Math.min(1, val));
      formattedValue = computedValue.toFixed(3);
      if (computedValue > 0.25) {
        interpretation = "High-density built-up / impervious";
      } else if (computedValue > 0.05) {
        interpretation = "Low-density urban / roads / bare ground";
      } else {
        interpretation = "Vegetated or agricultural land";
      }
      break;
    }

    case "NBR": {
      // (B08 - B12) / (B08 + B12 + 1e-6)
      const val = (b08 - b12) / (b08 + b12 + 1e-6);
      computedValue = Math.max(-1, Math.min(1, val));
      formattedValue = computedValue.toFixed(3);
      if (computedValue > 0.45) {
        interpretation = "Unburned healthy forest";
      } else if (computedValue > 0.15) {
        interpretation = "Low burn severity / regrowth";
      } else if (computedValue > -0.1) {
        interpretation = "Moderate burn severity";
      } else {
        interpretation = "High burn severity / active scar";
      }
      break;
    }

    case "CIR": {
      formattedValue = `NIR: ${b08.toFixed(0)} | R: ${b04.toFixed(0)} | G: ${b03.toFixed(0)}`;
      interpretation = "Color Infrared (Vegetation in vibrant red)";
      break;
    }

    case "RGB": {
      formattedValue = `R: ${b04.toFixed(0)} | G: ${b03.toFixed(0)} | B: ${b02.toFixed(0)}`;
      interpretation = "Natural True Color reflectance";
      break;
    }

    case "Elevation": {
      if (elev <= -9000 || isNaN(elev)) {
        computedValue = null;
        formattedValue = "No Data";
        interpretation = "Outside terrain coverage / No Data";
      } else {
        computedValue = elev;
        formattedValue = `${elev.toFixed(1)} m`;
        interpretation = `Elevation: ${elev.toFixed(1)} m above MSL`;
      }
      break;
    }
  }

  return {
    coordinate: coord,
    activeFormula,
    computedValue,
    formattedValue,
    interpretation,
    rawBands,
  };
}
