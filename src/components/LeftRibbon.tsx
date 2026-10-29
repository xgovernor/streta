import {
  Database,
  FolderOpen,
  GitMerge,
  Map,
  Search,
  Settings2,
  Table,
} from "lucide-react";
import type { PanelId } from "../lib/gis/types";
import { useUiStore } from "../state/uiStore";
import { ToolButton } from "./ToolButton";

const TOOLS: {
  id: PanelId;
  label: string;
  icon: typeof Search;
  shortcut?: string;
}[] = [
    { id: "search", label: "Search features", icon: Search, shortcut: "/" },
    { id: "project", label: "Project file", icon: FolderOpen },
    { id: "data", label: "Datasets", icon: Database, shortcut: "D" },
    { id: "table", label: "Attribute table", icon: Table, shortcut: "T" },
    { id: "join", label: "Join table", icon: GitMerge },
    { id: "basemaps", label: "Basemaps", icon: Map },
  ];


function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft"
    >
      <svg viewBox="0 0 28 28" className="size-7">
        <circle
          cx="14"
          cy="14"
          r="7"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1"
        />
        <path d="M14 5v18M5 14h18" stroke="var(--accent)" strokeWidth="1" />
        <circle cx="14" cy="14" r="1.5" fill="var(--accent)" />
      </svg>
    </span>
  );
}

export function LeftRibbon() {
  const activePanel = useUiStore((state) => state.activePanel);
  const togglePanel = useUiStore((state) => state.togglePanel);

  return (
    <nav
      className="glass pointer-events-auto absolute bottom-[var(--footer-h)] left-0 top-0 z-20 flex w-[46px] flex-col items-center gap-[5px] border-r border-line pb-3 pt-[9px]"
      aria-label="Workspace tools"
    >
      <BrandMark />

      <div className="my-[3px] h-px w-[18px] shrink-0 bg-line" />

      <div className="flex shrink-0 flex-col items-center gap-1">
        {TOOLS.map((tool) => (
          <ToolButton
            key={tool.id}
            label={tool.label}
            icon={tool.icon}
            side="left"
            shortcut={tool.shortcut}
            active={activePanel === tool.id}
            onClick={() => togglePanel(tool.id)}
          />
        ))}
      </div>

      <div className="flex-1" />

      <div className="flex shrink-0 flex-col items-center gap-1">
        <ToolButton
          label="Settings"
          icon={Settings2}
          side="left"
          active={activePanel === "settings"}
          onClick={() => togglePanel("settings")}
        />
      </div>
    </nav>
  );
}
