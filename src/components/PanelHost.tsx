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
import { TimeDock } from "./panels/TimeDock";
import { AlertQueue } from "./AlertQueue";

import { BookmarksPanel } from "./panels/BookmarksPanel";

/**
 * Docks, not a single panel. The left and right columns are independent (a
 * dataset stack can stay open while an inspection runs); the timeline lives
 * in the bottom dock next to the attribute table.
 */
function LeftDock() {
  const leftPanel = useUiStore((state) => state.leftPanel);

  switch (leftPanel) {
    case "search":
      return <SearchPanel />;
    case "project":
      return <ProjectPanel />;
    case "bookmarks":
      return <BookmarksPanel />;
    case "data":
    case "telemetry":
      return <DatasetsPanel />;
    case "table":
      return <AttributesPanel />;
    case "join":
      return <JoinPanel />;
    case "basemaps":
      return <BasemapsPanel />;
    case "settings":
      return <SettingsPanel />;
    default:
      return null;
  }
}

function RightDock() {
  const rightPanel = useUiStore((state) => state.rightPanel);

  switch (rightPanel) {
    case "layer":
      return <LayerPanel />;
    case "table":
      return <AttributesPanel />;
    case "measure":
      return <MeasurePanel />;
    case "feature":
      return <FeaturePanel />;
    default:
      return null;
  }
}

export function PanelHost() {
  const timelineOpen = useUiStore((state) => state.timelineOpen);

  return (
    <>
      <LeftDock />
      <RightDock />
      <AlertQueue />
      {timelineOpen ? <TimeDock /> : null}
    </>
  );
}
