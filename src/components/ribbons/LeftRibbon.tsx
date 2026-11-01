import { motion, type Variants } from "motion/react";
import {
  Bookmark,
  Database,
  FolderGit2,
  Radio,
  Search,
  Settings2,
} from "lucide-react";
import type { PanelId } from "../../lib/gis/types";
import { useUiStore } from "../../state/uiStore";
import { cx } from "../../lib/cx";

interface RibbonItem {
  id: PanelId;
  label: string;
  icon: typeof Database;
  shortcut?: string;
  badge?: number;
}

const leftRibbonVariants: Variants = {
  hidden: { opacity: 0, x: -50 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.85, delay: 0.16, ease: [0.16, 1, 0.3, 1] },
  },
};

export function LeftRibbon() {
  const booted = useUiStore((state) => state.booted);
  const leftPanel = useUiStore((state) => state.leftPanel);
  const togglePanel = useUiStore((state) => state.togglePanel);

  const PRIMARY_ITEMS: RibbonItem[] = [
    { id: "data", label: "Datasets & Layers", icon: Database, shortcut: "D" },
    { id: "search", label: "Search & Coordinates", icon: Search, shortcut: "/" },
    { id: "bookmarks", label: "Bookmarks & Notes", icon: Bookmark, shortcut: "B" },
    { id: "project", label: "Project & Workspace", icon: FolderGit2 },
    { id: "telemetry", label: "Live Telemetry Feeds", icon: Radio },
  ];

  return (
    <motion.aside
      initial="hidden"
      animate={booted ? "visible" : "hidden"}
      variants={leftRibbonVariants}
      className="pointer-events-auto absolute left-0 top-[var(--commandbar-h)] bottom-[var(--footer-h)] z-20 flex w-[var(--ribbon-w)] flex-col items-center justify-between border-r border-line bg-solid py-2 select-none"
      aria-label="Navigation Ribbon"
    >
      <div className="flex w-full flex-col items-center gap-1">
        {PRIMARY_ITEMS.map((item) => {
          const isActive = leftPanel === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => togglePanel(item.id)}
              className={cx(
                "group relative flex size-9 items-center justify-center rounded-[2px] transition-colors focus-visible:outline-2",
                isActive
                  ? "bg-tint text-accent before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2.5px] before:rounded-r before:bg-accent"
                  : "text-ink-muted hover:bg-tint/70 hover:text-ink"
              )}
              title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
              aria-label={item.label}
              aria-pressed={isActive}
            >
              <item.icon size={17} strokeWidth={2} />
              {/* Tooltip flyout on hover */}
              <span className="pointer-events-none absolute left-[calc(100%+8px)] z-50 hidden whitespace-nowrap rounded-[2px] border border-line bg-solid px-2 py-1 font-mono text-[9px] font-semibold text-ink shadow-panel group-hover:block">
                {item.label}
                {item.shortcut ? (
                  <span className="ml-1.5 text-ink-muted">({item.shortcut})</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex w-full flex-col items-center gap-1 border-t border-line/60 pt-2">
        <button
          type="button"
          onClick={() => togglePanel("settings")}
          className={cx(
            "group relative flex size-9 items-center justify-center rounded-[2px] transition-colors focus-visible:outline-2",
            leftPanel === "settings"
              ? "bg-tint text-accent before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2.5px] before:rounded-r before:bg-accent"
              : "text-ink-muted hover:bg-tint/70 hover:text-ink"
          )}
          title="Settings & Display Preferences"
          aria-label="Settings"
          aria-pressed={leftPanel === "settings"}
        >
          <Settings2 size={17} strokeWidth={2} />
          <span className="pointer-events-none absolute left-[calc(100%+8px)] z-50 hidden whitespace-nowrap rounded-[2px] border border-line bg-solid px-2 py-1 font-mono text-[9px] font-semibold text-ink shadow-panel group-hover:block">
            Settings
          </span>
        </button>
      </div>
    </motion.aside>
  );
}
