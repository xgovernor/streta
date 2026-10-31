import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Check,
  Code,
  Copy,
  FileCode,
  Hexagon,
  List,
  Mountain,
  PlusCircle,
  Ruler,
  Trash2,
  ZoomIn,
} from "lucide-react";
import { useMapStore } from "../state/mapStore";
import { useUiStore } from "../state/uiStore";
import {
  clearMeasurement,
  deleteMeasurementFeature,
  resumeMeasurement,
  reverseMeasurement,
  zoomToMeasurement,
} from "../map/mapController";

const MENU_WIDTH = 240;
const MENU_HEIGHT = 380;
const PADDING = 8;

export function MeasureContextMenu() {
  const menu = useMapStore((state) => state.measureContextMenu);
  const setMenu = useMapStore((state) => state.setMeasureContextMenu);
  const notify = useUiStore((state) => state.notify);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    if (!menu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteMeasurementFeature(menu.featureId);
        notify("Measurement line deleted");
        setMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu, setMenu, notify]);

  if (!menu) return null;

  // Viewport clamping
  const winW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const winH = typeof window !== "undefined" ? window.innerHeight : 800;
  const x = Math.min(Math.max(menu.x, PADDING), winW - MENU_WIDTH - PADDING);
  const y = Math.min(Math.max(menu.y, PADDING), winH - MENU_HEIGHT - PADDING);

  const copyToClipboard = async (text: string, label: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      notify(`Copied ${label}`);
      setTimeout(() => setCopiedKey(null), 1400);
      setTimeout(() => setMenu(null), 300);
    } catch {
      notify("Failed to copy to clipboard");
    }
  };

  const isPolygon = menu.geomType === "Polygon";
  const Icon = isPolygon ? Hexagon : Ruler;
  const isMulti = menu.totalLinesCount && menu.totalLinesCount > 1;

  const handleCopyDistance = () => {
    let text = menu.formattedDistance;
    if (menu.formattedNauticalMiles) {
      text += ` (${menu.formattedNauticalMiles})`;
    }
    if (menu.formattedMiles) {
      text += ` · ${menu.formattedMiles}`;
    }
    copyToClipboard(text, isPolygon ? "perimeter" : "distance", "distance");
  };

  const handleCopyArea = () => {
    let text = menu.formattedArea ?? "";
    if (menu.formattedHectares) {
      text += ` (${menu.formattedHectares})`;
    }
    if (menu.formattedAcres) {
      text += ` · ${menu.formattedAcres}`;
    }
    copyToClipboard(text, "area", "area");
  };

  const handleCopyCoordinates = () => {
    const text = menu.coords
      .map(([lon, lat]) => `${lat.toFixed(6)}, ${lon.toFixed(6)}`)
      .join("\n");
    copyToClipboard(text, `${menu.vertexCount} coordinates`, "coords");
  };

  const handleCopyGeoJson = () => {
    const geojson = {
      type: "Feature",
      geometry: {
        type: menu.geomType,
        coordinates: isPolygon ? [menu.coords] : menu.coords,
      },
      properties: {
        feature_id: menu.featureId,
        index: menu.lineIndex,
        total_features: menu.totalLinesCount,
        ...(isPolygon
          ? {
              area_sq_meters: menu.areaSqMeters,
              formatted_area: menu.formattedArea,
              formatted_hectares: menu.formattedHectares,
              formatted_acres: menu.formattedAcres,
              perimeter_meters: menu.distanceMeters,
              formatted_perimeter: menu.formattedDistance,
              centroid: menu.centroid,
            }
          : {
              distance_meters: menu.distanceMeters,
              formatted_distance: menu.formattedDistance,
            }),
        vertices: menu.vertexCount,
      },
    };
    copyToClipboard(JSON.stringify(geojson, null, 2), "GeoJSON geometry", "geojson");
  };

  const handleCopyWkt = () => {
    let wkt: string;
    if (isPolygon) {
      const ring = [...menu.coords];
      if (
        ring.length > 0 &&
        (ring[0][0] !== ring[ring.length - 1][0] ||
          ring[0][1] !== ring[ring.length - 1][1])
      ) {
        ring.push(ring[0]);
      }
      wkt = `POLYGON((${ring.map(([lon, lat]) => `${lon.toFixed(6)} ${lat.toFixed(6)}`).join(", ")}))`;
    } else {
      wkt = `LINESTRING(${menu.coords.map(([lon, lat]) => `${lon.toFixed(6)} ${lat.toFixed(6)}`).join(", ")})`;
    }
    copyToClipboard(wkt, "WKT geometry", "wkt");
  };

  const handleReverse = () => {
    const success = reverseMeasurement(menu.featureId);
    if (success) {
      notify(isPolygon ? "Reversed polygon ring vertices" : "Reversed line direction");
    }
    setMenu(null);
  };

  const handleZoom = () => {
    zoomToMeasurement(menu.featureId);
    setMenu(null);
  };

  const handleSliceElevation = () => {
    useMapStore.getState().setElevationSelectedFeatureId(menu.featureId ?? null);
    useUiStore.getState().openPanel("elevation");
    notify(`Terrain Elevation: slicing Line #${menu.lineIndex ?? 1}`);
    setMenu(null);
  };

  const handleInsertAnother = () => {
    resumeMeasurement(isPolygon ? "area" : "distance");
    notify(
      isPolygon
        ? "Ready: click map to plot another polygon"
        : "Ready: click map to draw another measurement line",
    );
    setMenu(null);
  };

  const handleDeleteThisLine = () => {
    deleteMeasurementFeature(menu.featureId);
    notify(isPolygon ? "Polygon deleted" : "Measurement line deleted");
    setMenu(null);
  };

  const handleClearAll = () => {
    clearMeasurement();
    notify("All measurements cleared");
    setMenu(null);
  };

  return (
    <div
      ref={menuRef}
      className="pointer-events-auto fixed z-50 flex w-[240px] flex-col rounded-[3px] border border-[#2b303d] bg-[#12141a] p-1 font-mono text-[11px] text-ink shadow-[0_16px_40px_rgba(0,0,0,0.85)] select-none animate-in fade-in zoom-in-95 duration-100"
      style={{ left: x, top: y, backgroundColor: "#12141a" }}
      role="menu"
      aria-label="Measurement Context Menu"
    >
      {/* Header telemetry plaque with solid opaque background */}
      <div className="flex items-center gap-2 border-b border-[#252936] px-2.5 py-2 bg-[#181b24] rounded-t-[2px]">
        <Icon size={13} className="text-accent flex-none" />
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate">
            <span className="font-semibold text-ink truncate text-[11.5px]">
              {isPolygon ? (menu.formattedArea ?? menu.formattedDistance) : menu.formattedDistance}
            </span>
            {isPolygon && menu.formattedHectares && (
              <span className="text-[10px] text-accent/90">· {menu.formattedHectares}</span>
            )}
            {!isPolygon && menu.formattedArea && (
              <span className="text-[10px] text-ink-muted">· {menu.formattedArea}</span>
            )}
            {isMulti && (
              <span className="ml-auto rounded-[2px] bg-accent/15 px-1 py-0.5 text-[9px] font-semibold text-accent">
                {isPolygon ? "Polygon" : "Line"} #{menu.lineIndex ?? 1}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-[9px] text-ink-muted truncate">
            {isPolygon ? (
              <>
                {menu.formattedAcres && <span>{menu.formattedAcres}</span>}
                <span>· Perim: {menu.formattedDistance}</span>
                <span>· {menu.vertexCount} pts</span>
              </>
            ) : (
              <>
                {menu.formattedNauticalMiles && (
                  <span>{menu.formattedNauticalMiles}</span>
                )}
                {menu.formattedMiles && <span>· {menu.formattedMiles}</span>}
                <span>· {menu.vertexCount} pts</span>
                {isMulti && <span>· of {menu.totalLinesCount} total</span>}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Menu options */}
      <div className="flex flex-col py-0.5">
        {isPolygon && menu.formattedArea && (
          <button
            type="button"
            role="menuitem"
            className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
            onClick={handleCopyArea}
          >
            {copiedKey === "area" ? (
              <Check size={12} className="text-ok flex-none" />
            ) : (
              <Copy size={12} className="text-ink-muted flex-none" />
            )}
            <span className="flex-1">Copy Area</span>
            <span className="text-[9px] text-accent font-semibold">Area</span>
          </button>
        )}

        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
          onClick={handleCopyDistance}
        >
          {copiedKey === "distance" ? (
            <Check size={12} className="text-ok flex-none" />
          ) : (
            <Copy size={12} className="text-ink-muted flex-none" />
          )}
          <span className="flex-1">{isPolygon ? "Copy Perimeter" : "Copy Distance"}</span>
          <span className="text-[9px] text-ink-muted">{isPolygon ? "Perim" : "Value"}</span>
        </button>

        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
          onClick={handleCopyCoordinates}
        >
          {copiedKey === "coords" ? (
            <Check size={12} className="text-ok flex-none" />
          ) : (
            <List size={12} className="text-ink-muted flex-none" />
          )}
          <span className="flex-1">{isPolygon ? "Copy Ring Vertices" : "Copy Lat/Lon Pairs"}</span>
          <span className="text-[9px] text-ink-muted">Text</span>
        </button>

        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
          onClick={handleCopyGeoJson}
        >
          {copiedKey === "geojson" ? (
            <Check size={12} className="text-ok flex-none" />
          ) : (
            <Code size={12} className="text-ink-muted flex-none" />
          )}
          <span className="flex-1">Copy GeoJSON</span>
          <span className="text-[9px] text-ink-muted">JSON</span>
        </button>

        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
          onClick={handleCopyWkt}
        >
          {copiedKey === "wkt" ? (
            <Check size={12} className="text-ok flex-none" />
          ) : (
            <FileCode size={12} className="text-ink-muted flex-none" />
          )}
          <span className="flex-1">Copy WKT</span>
          <span className="text-[9px] text-ink-muted">WKT</span>
        </button>

        <div className="my-1 border-t border-[#232733]" />

        {/* Slice Elevation Cross-Section */}
        {!isPolygon && (
          <button
            type="button"
            role="menuitem"
            className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
            onClick={handleSliceElevation}
          >
            <Mountain size={12} className="text-accent flex-none" />
            <span className="flex-1 font-semibold text-accent">Elevation Profile</span>
            <span className="text-[9px] text-accent/80 font-mono">DEM</span>
          </button>
        )}

        {/* Option to insert multiple measurement shapes */}
        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
          onClick={handleInsertAnother}
        >
          <PlusCircle size={12} className="text-accent flex-none" />
          <span className="flex-1 font-semibold text-accent">
            {isPolygon ? "Insert Another Polygon" : "Insert Another Line"}
          </span>
          <span className="text-[9px] text-accent/80 font-mono">+New</span>
        </button>

        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
          onClick={handleReverse}
        >
          <ArrowLeftRight size={12} className="text-ink-muted flex-none" />
          <span className="flex-1">Reverse Direction</span>
        </button>

        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] hover:bg-[#1e2330] hover:text-accent transition-colors"
          onClick={handleZoom}
        >
          <ZoomIn size={12} className="text-ink-muted flex-none" />
          <span className="flex-1">Zoom to Extent</span>
        </button>

        <div className="my-1 border-t border-[#232733]" />

        <button
          type="button"
          role="menuitem"
          className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] text-critical hover:bg-critical/15 transition-colors"
          onClick={handleDeleteThisLine}
        >
          <Trash2 size={12} className="text-critical flex-none" />
          <span className="flex-1">
            {isMulti
              ? `Delete ${isPolygon ? "Polygon" : "Line"} #${menu.lineIndex ?? 1}`
              : isPolygon
                ? "Delete Polygon"
                : "Delete Measurement"}
          </span>
          <span className="text-[9px] opacity-75">Del</span>
        </button>

        {isMulti && (
          <button
            type="button"
            role="menuitem"
            className="flex items-center gap-2 rounded-[2px] px-2 py-1.5 text-left text-[10.5px] text-critical/80 hover:bg-critical/15 hover:text-critical transition-colors"
            onClick={handleClearAll}
          >
            <Trash2 size={12} className="text-critical/80 flex-none" />
            <span className="flex-1">
              Clear All {isPolygon ? "Polygons" : "Lines"} ({menu.totalLinesCount})
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
