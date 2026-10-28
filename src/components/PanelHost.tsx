import { useUiStore } from "../state/uiStore";
import { AttributesPanel } from "./panels/AttributesPanel";
import { BasemapsPanel } from "./panels/BasemapsPanel";
import { DatasetsPanel } from "./panels/DatasetsPanel";
import { FeaturePanel } from "./panels/FeaturePanel";
import { JoinPanel } from "./panels/JoinPanel";
import { LayerPanel } from "./panels/LayerPanel";
import { MeasurePanel } from "./panels/MeasurePanel";
import { ProjectPanel } from "./panels/ProjectPanel";
import { SearchPanel } from "./panels/SearchPanel";
import { SettingsPanel } from "./panels/SettingsPanel";
import { TelemetryPanel } from "./panels/TelemetryPanel";

export function PanelHost() {
  const activePanel = useUiStore((state) => state.activePanel);

  switch (activePanel) {
    case "search":
      return <SearchPanel />;
    case "project":
      return <ProjectPanel />;
    case "data":
      return <DatasetsPanel />;
    case "layer":
      return <LayerPanel />;
    case "table":
      return <AttributesPanel />;
    case "measure":
      return <MeasurePanel />;
    case "join":
      return <JoinPanel />;
    case "basemaps":
      return <BasemapsPanel />;
    case "feature":
      return <FeaturePanel />;
    case "settings":
      return <SettingsPanel />;
    case "telemetry":
      return <TelemetryPanel />;
    default:
      return null;
  }
}
