import { useEffect, useState } from "react";
import {
  Frame,
  Hexagon,
  LocateFixed,
  Maximize2,
  Minimize2,
  Minus,
  Mountain,
  Plus,
  Radar,
  Ruler,
} from "lucide-react";

import { fitToData, flyTo, resetNorth, zoomBy } from "../map/mapController";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";
import { useUiStore, type AnalysisTab } from "../state/uiStore";
import { RailButton } from "./RailButton";
import { ToolButton } from "./ToolButton";

function CompassButton() {
  const rotation = useMapStore((state) => state.camera.rotation);

  return (
    <RailButton
      label="Reset north"
      side="right"
      shortcut="0"
      onClick={resetNorth}
    >
      <span
        aria-hidden="true"
        className="relative block size-[18px] rounded-full border border-current before:absolute before:-top-[3px] before:left-1/2 before:h-[3px] before:w-px before:-translate-x-1/2 before:bg-current"
      >
        <span
          className="absolute inset-0.5 origin-center transition-transform duration-75 ease-linear"
          style={{ transform: `rotate(${-rotation}rad)` }}
        >
          <span className="absolute left-1/2 top-0 h-1.5 w-[3px] -translate-x-1/2 rounded-t-[2px] bg-accent" />
          <span className="absolute bottom-0 left-1/2 h-[5px] w-0.5 -translate-x-1/2 rounded-b-[2px] bg-ink-muted" />
        </span>
      </span>
    </RailButton>
  );
}

export function RightRibbon() {
  const openAnalysisTab = useUiStore((state) => state.openAnalysisTab);
  const analysisTab = useUiStore((state) => state.analysisTab);
  const togglePanel = useUiStore((state) => state.togglePanel);
  const activePanel = useUiStore((state) => state.activePanel);
  const setMeasureMode = useProjectStore((state) => state.setMeasureMode);
  const layerCount = useProjectStore((state) => state.layers.length);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreen = () => {
      setFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", handleFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreen);
    };
  }, []);

  const toggleTool = (tab: AnalysisTab) => {
    if (activePanel === "measure" && analysisTab === tab) {
      togglePanel("measure");
    } else {
      openAnalysisTab(tab);
      if (tab === "distance") setMeasureMode("distance");
      else if (tab === "area") setMeasureMode("area");
      else setMeasureMode("off");
    }
  };

  const locate = () => {
    if (!("geolocation" in navigator)) {          useUiStore.getState().flash("Location is not available in this window.");
      return;
    }

    useUiStore.getState().flash("Finding your position…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        flyTo(position.coords.longitude, position.coords.latitude, 11);
        useUiStore.getState().flash("Centered on your location");
      },
      () => {
        useUiStore.getState().flash("Location permission denied or unavailable.");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      useUiStore.getState().flash("Fullscreen is not available in this window.");
    }
  };

  return (
    <nav
      className="glass pointer-events-auto absolute bottom-[var(--footer-h)] right-0 top-0 z-20 flex w-[46px] flex-col items-center gap-[5px] border-l border-line pb-3 pt-[9px]"
      aria-label="Map tools"
    >
      <div className="flex shrink-0 flex-col items-center gap-1">
        <ToolButton
          label="Zoom in"
          icon={Plus}
          side="right"
          shortcut="+"
          onClick={() => zoomBy(1)}
        />
        <ToolButton
          label="Zoom out"
          icon={Minus}
          side="right"
          shortcut="−"
          onClick={() => zoomBy(-1)}
        />
      </div>

      <div className="my-[3px] h-px w-[18px] shrink-0 bg-line" />

      <div className="flex shrink-0 flex-col items-center gap-1">
        <CompassButton />
        <ToolButton
          label={layerCount ? "Fit all layers" : "Fit data extent"}
          icon={Frame}
          side="right"
          onClick={() => {
            fitToData();
            if (!layerCount) {
              useUiStore.getState().flash("No datasets are loaded yet.");
            }
          }}
        />
        <ToolButton
          label="Find my location"
          icon={LocateFixed}
          side="right"
          onClick={locate}
        />
      </div>

      <div className="my-[3px] h-px w-[18px] shrink-0 bg-line" />

      <div className="flex shrink-0 flex-col items-center gap-1">
        <ToolButton
          label="Measure distance"
          icon={Ruler}
          side="right"
          shortcut="M"
          active={activePanel === "measure" && analysisTab === "distance"}
          onClick={() => toggleTool("distance")}
        />
        <ToolButton
          label="Measure area"
          icon={Hexagon}
          side="right"
          active={activePanel === "measure" && analysisTab === "area"}
          onClick={() => toggleTool("area")}
        />
        <ToolButton
          label="Elevation profile"
          icon={Mountain}
          side="right"
          active={activePanel === "measure" && analysisTab === "elevation"}
          onClick={() => toggleTool("elevation")}
        />
        <ToolButton
          label="Proximity buffer"
          icon={Radar}
          side="right"
          active={activePanel === "measure" && analysisTab === "buffer"}
          onClick={() => toggleTool("buffer")}
        />
      </div>


      <div className="flex-1" />

      <div className="flex shrink-0 flex-col items-center gap-1">
        <ToolButton
          label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          icon={fullscreen ? Minimize2 : Maximize2}
          side="right"
          onClick={toggleFullscreen}
        />
      </div>
    </nav>
  );
}
