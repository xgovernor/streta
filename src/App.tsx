import { useEffect } from "react";
import { MapCanvas } from "./map/MapCanvas";
import { resetNorth, zoomBy } from "./map/mapController";
import { LeftRibbon } from "./components/LeftRibbon";
import { MapAttribution } from "./components/MapAttribution";
import { RightRibbon } from "./components/RightRibbon";
import { FeaturePopup } from "./components/FeaturePopup";
import { PanelHost } from "./components/PanelHost";
import { ProjectPlaque } from "./components/ProjectPlaque";
import { StatusBar } from "./components/StatusBar";
import { Toast } from "./components/Toast";
import { useProjectStore } from "./state/projectStore";
import { useUiStore } from "./state/uiStore";

const PANEL_KEYS: Record<string, "data" | "table" | "measure"> = {
  d: "data",
  // The layer stack lives inside the Datasets panel; both keys open it.
  l: "data",
  t: "table",
  m: "measure",
  a: "measure",
};

function App() {
  const theme = useUiStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
    const onKeyDown = (event: KeyboardEvent) => {      const ui = useUiStore.getState();
      if (event.key === "Escape") {
        if (ui.activePanel) {
          ui.closePanel();
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
      <div className="pointer-events-none absolute inset-0 z-10 [contain:layout_paint_style]">
        <ProjectPlaque />
        <LeftRibbon />
        <RightRibbon />
        <FeaturePopup />
        <PanelHost />
        <MapAttribution />
        <StatusBar />
        <Toast />
      </div>
    </main>
  );
}

export default App;
