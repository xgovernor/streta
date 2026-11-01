import { useEffect } from "react";
import { MapCanvas } from "./map/MapCanvas";
import { CesiumCanvas } from "./map/CesiumCanvas";
import { applyCamera, resetNorth, zoomBy } from "./map/mapController";
import { CommandBar } from "./components/CommandBar";
import { MapAttribution } from "./components/MapAttribution";
import { FeaturePopup } from "./components/FeaturePopup";
import { TelemetryHoverPopup } from "./components/TelemetryHoverPopup";
import { PanelHost } from "./components/PanelHost";
import { StatusBar } from "./components/StatusBar";
import { Toast } from "./components/Toast";
import { LeftRibbon } from "./components/ribbons/LeftRibbon";
import { RightRibbon } from "./components/ribbons/RightRibbon";
import { FloatingCanvasControls } from "./components/FloatingCanvasControls";
import { RegionSnipOverlay } from "./components/RegionSnipOverlay";
import { HorizontalBasemapTray } from "./components/panels/HorizontalBasemapTray";
import { MeasureContextMenu } from "./components/MeasureContextMenu";
import { BookmarkContextMenu } from "./components/BookmarkContextMenu";
import { useProjectStore } from "./state/projectStore";
import { useMapStore } from "./state/mapStore";
import { useUiStore } from "./state/uiStore";
import type { PanelId } from "./lib/gis/types";

const PANEL_KEYS: Record<string, PanelId> = {
  d: "data",
  l: "data",
  t: "table",
  b: "bookmarks",
};

function App() {
  const theme = useUiStore((state) => state.theme);
  const timelineOpen = useUiStore((state) => state.timelineOpen);
  const viewMode = useUiStore((state) => state.viewMode);
  const leftPanel = useUiStore((state) => state.leftPanel);
  const rightPanel = useUiStore((state) => state.rightPanel);
  const tableHeight = useUiStore((state) => state.tableHeight);
  const tableMaximized = useUiStore((state) => state.tableMaximized);
  const isTableOpen = leftPanel === "table" || rightPanel === "table";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  /** Synchronize the dynamic table height and maximize state with CSS variable */
  useEffect(() => {
    if (!isTableOpen) {
      document.documentElement.style.removeProperty("--table-h");
      return;
    }
    const val = tableMaximized
      ? "calc(100vh - var(--commandbar-h) - var(--footer-h) - var(--timeline-h))"
      : `${tableHeight}px`;
    document.documentElement.style.setProperty("--table-h", val);
    return () => {
      document.documentElement.style.removeProperty("--table-h");
    };
  }, [isTableOpen, tableHeight, tableMaximized]);

  /**
   * The shared camera store is the handoff point between renderers: while
   * Cesium owns the screen it keeps the store up to date, and returning to 2D
   * applies the last 3D pose back onto the OpenLayers view.
   */
  useEffect(() => {
    if (viewMode !== "2d") return;
    applyCamera(useMapStore.getState().camera);
  }, [viewMode]);

  /** The bottom dock raises the attribute table and attribution above it. */
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--timeline-h",
      timelineOpen ? "128px" : "0px",
    );
    return () => {
      document.documentElement.style.removeProperty("--timeline-h");
    };
  }, [timelineOpen]);

  // Layers that could not be restored from the last session are reported once.
  useEffect(() => {
    const { hydrationWarnings, dismissHydrationWarnings } =
      useProjectStore.getState();

    if (hydrationWarnings.length) {
      useUiStore.getState().notify(hydrationWarnings[0]);
      dismissHydrationWarnings();
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ui = useUiStore.getState();
      if (event.key === "Escape") {
        if (ui.basemapTrayOpen) {
          ui.setBasemapTrayOpen(false);
        } else if (ui.leftPanel || ui.rightPanel) {
          ui.closePanel();
        } else if (ui.alertsOpen) {
          ui.setAlertsOpen(false);
        } else if (useProjectStore.getState().measureMode !== "off") {
          useProjectStore.getState().setMeasureMode("off");
        }

        if (event.target instanceof HTMLElement) {
          event.target.blur();
        }
        return;
      }

      // Key events normally come from an element, but a synthetic event can
      // carry the window: only an element can be inside a text field.
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.key === "Q" && !event.ctrlKey && !event.metaKey && !event.altKey && target === null) {
        event.preventDefault();
        ui.setCoordFormat("projected");
        return;
      }

      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], [role='slider']",
        )
      ) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }


      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(1);
        return;
      }

      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomBy(-1);
        return;
      }

      if (event.key === "0") {
        event.preventDefault();
        resetNorth();
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        ui.openPanel("search");
        return;
      }

      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        // OL Draw interactions get no pointer events from Cesium: never arm
        // an invisible tool.
        if (ui.viewMode === "3d") {
          ui.notify("Measuring works on the 2D map — switch back to 2D");
          return;
        }
        const currentMode = useProjectStore.getState().measureMode;
        const nextMode = currentMode === "distance" ? "off" : "distance";
        useProjectStore.getState().setMeasureMode(nextMode);
        if (ui.rightPanel && ["elevation", "buffer", "knn", "boolean", "measure"].includes(ui.rightPanel)) {
          ui.closePanel();
        }
        ui.notify(
          nextMode === "distance"
            ? "Measurement tool active: click map to measure"
            : "Measurement tool paused",
        );
        return;
      }

      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        if (ui.viewMode === "3d") {
          ui.notify("Area measurement works on the 2D map — switch back to 2D");
          return;
        }
        const currentMode = useProjectStore.getState().measureMode;
        const nextMode = currentMode === "area" ? "off" : "area";
        useProjectStore.getState().setMeasureMode(nextMode);
        if (ui.rightPanel && ["elevation", "buffer", "knn", "boolean", "measure"].includes(ui.rightPanel)) {
          ui.closePanel();
        }
        ui.notify(
          nextMode === "area"
            ? "Area tool active: click map to plot polygon ring"
            : "Area measurement tool paused",
        );
        return;
      }

      const panel = PANEL_KEYS[event.key.toLowerCase()];

      if (panel) {
        event.preventDefault();
        ui.togglePanel(panel);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <main className="fixed inset-0 isolate overflow-hidden bg-shell">
      <MapCanvas />
      {viewMode === "3d" && <CesiumCanvas />}
      <div className="pointer-events-none absolute inset-0 z-10">
        <CommandBar />
        <LeftRibbon />
        <RightRibbon />
        <FloatingCanvasControls />
        <FeaturePopup />
        <TelemetryHoverPopup />
        <MeasureContextMenu />
        <BookmarkContextMenu />
        <PanelHost />
        <MapAttribution />
        <StatusBar />
        <Toast />
        <HorizontalBasemapTray />
        <RegionSnipOverlay />
      </div>
    </main>
  );
}

export default App;
