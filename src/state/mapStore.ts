import { create } from "zustand";
import type { CameraState } from "../lib/gis/types";

/**
 * The brief card shown at the point where a feature was hovered or clicked.
 * A click owns the card; a hover may or may not, depending on whether the
 * hovered feature is still the one the user acted on.
 */
export interface MapPopup {
  layerId: string;
  featureId: string;
  lon: number;
  lat: number;
  properties?: Record<string, unknown>;
}

export interface MeasureContextMenuState {
  x: number;
  y: number;
  featureId?: string;
  lineIndex?: number;
  totalLinesCount?: number;
  coords: [number, number][]; // [lon, lat][]
  geomType: "LineString" | "Polygon";
  distanceMeters: number;
  formattedDistance: string;
  formattedNauticalMiles?: string;
  formattedMiles?: string;
  areaSqMeters?: number;
  formattedArea?: string;
  formattedHectares?: string;
  formattedAcres?: string;
  centroid?: [number, number];
  vertexCount: number;
}

interface MapState {
  ready: boolean;
  camera: CameraState;
  /** Cursor in WGS 84 degrees. */
  pointer: { lon: number; lat: number } | null;
  /** Cursor in view projection metres. */
  pointerView: { x: number; y: number } | null;
  /** Label of the dataset feature under the cursor, if any. */
  hoverLabel: string | null;
  /** Where the click card is anchored, in WGS 84 degrees. */
  popup: MapPopup | null;
  /** The hovered feature, used only to keep one feature’s card on screen. */
  activeFeature: MapPopup | null;
  /** Active measurement context menu, if opened via right-click on a line. */
  measureContextMenu: MeasureContextMenuState | null;
  setReady: (ready: boolean) => void;
  setPopup: (popup: MapPopup | null) => void;
  setActiveFeature: (feature: MapPopup | null) => void;
  setMeasureContextMenu: (menu: MeasureContextMenuState | null) => void;
  setCamera: (camera: CameraState) => void;
  setPointer: (
    pointer: { lon: number; lat: number } | null,
    view?: { x: number; y: number } | null,
  ) => void;
  setHoverLabel: (label: string | null) => void;
}

export const useMapStore = create<MapState>((set) => ({
  ready: false,
  camera: {
    lon: 13.5,
    lat: 47.5,
    zoom: 4.2,
    rotation: 0,
    resolution: 8517,
  },
  pointer: null,
  pointerView: null,
  hoverLabel: null,
  popup: null,
  activeFeature: null,
  measureContextMenu: null,

  setReady: (ready) => set({ ready }),
  setPopup: (popup) => set({ popup }),
  setActiveFeature: (activeFeature) => set({ activeFeature }),
  setMeasureContextMenu: (measureContextMenu) => set({ measureContextMenu }),
  setCamera: (camera) => set({ camera }),
  setPointer: (pointer, view = null) => set({ pointer, pointerView: view }),
  setHoverLabel: (hoverLabel) => set({ hoverLabel }),
}));

