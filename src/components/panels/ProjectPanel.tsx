import { useState } from "react";
import { FilePlus2, FolderOpen, Save } from "lucide-react";
import { VIEW_CRS } from "../../lib/gis/crs";
import { applyCamera } from "../../map/mapController";
import { formatCount } from "../../lib/format";
import { describeError, openProjectFile, saveProjectFile } from "../../lib/projectFile";
import { useProjectStore } from "../../state/projectStore";
import { useUiStore } from "../../state/uiStore";
import { PanelShell } from "../PanelShell";
import {
  FIELD_INPUT,
  InfoNote,
  LayerSwatch,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SectionLabel,
} from "./shared";

export function ProjectPanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const notify = useUiStore((state) => state.notify);
  const projectName = useProjectStore((state) => state.projectName);
  const projectPath = useProjectStore((state) => state.projectPath);
  const dirty = useProjectStore((state) => state.dirty);
  const layers = useProjectStore((state) => state.layers);
  const recent = useProjectStore((state) => state.recent);
  const setProjectName = useProjectStore((state) => state.setProjectName);
  const newProject = useProjectStore((state) => state.newProject);

  const [busy, setBusy] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);

  const featureCount = layers.reduce(
    (total, layer) => total + layer.features.length,
    0,
  );

  const save = async () => {
    setBusy(true);

    try {
      const saved = await saveProjectFile();

      if (saved) {
        notify(`Saved “${useProjectStore.getState().projectName}”`);
      }
    } catch (error) {
      notify(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    setBusy(true);

    try {
      const result = await openProjectFile();

      if (!result) {
        return;
      }

      applyCamera(result.view);
      notify(
        `Opened “${result.name}” · ${formatCount(result.layerCount)} layers`,
      );

      for (const warning of result.warnings.slice(0, 2)) {
        notify(warning);
      }
    } catch (error) {
      notify(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelShell
      eyebrow="Workspace"
      title="Project"
      onClose={closePanel}
      footer={
        <>
          <span>Strata project · v1</span>
          <span>{dirty ? "Unsaved" : "Saved"}</span>
        </>
      }
    >
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[8px] uppercase tracking-[0.08em] text-ink-muted">
          Project name
        </span>
        <input
          value={projectName}
          className={FIELD_INPUT}
          onChange={(event) => setProjectName(event.currentTarget.value)}
        />
      </label>

      <p
        className="mb-0 mt-1.5 truncate font-mono text-[9px] text-ink-muted"
        title={projectPath ?? "Not saved to disk yet"}
      >
        {projectPath ?? "Not saved to disk yet"}
      </p>

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-1.5">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          disabled={busy}
          onClick={() => void save()}
        >
          <Save size={13} strokeWidth={1.9} aria-hidden="true" />
          Save project
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          disabled={busy}
          title="Open project"
          aria-label="Open project"
          onClick={() => void open()}
        >
          <FolderOpen size={13} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        className={`${SECONDARY_BUTTON} mt-1.5 w-full`}
        disabled={busy}
        onClick={() => {
          if (!confirmNew) {
            setConfirmNew(true);
            window.setTimeout(() => setConfirmNew(false), 4000);
            return;
          }

          newProject();
          setConfirmNew(false);
          notify("New empty project");
        }}
      >
        <FilePlus2 size={13} strokeWidth={1.9} aria-hidden="true" />
        {confirmNew ? "Click again to discard this workspace" : "New project"}
      </button>

      <SectionLabel>Contents</SectionLabel>
      <div className="flex flex-col gap-[7px]">
        <div className="flex items-baseline justify-between text-[10.5px]">
          <span className="text-ink-muted">Layers</span>
          <strong className="font-medium text-ink-soft">{layers.length}</strong>
        </div>
        <div className="flex items-baseline justify-between text-[10.5px]">
          <span className="text-ink-muted">Features</span>
          <strong className="font-medium text-ink-soft">
            {formatCount(featureCount)}
          </strong>
        </div>
        <div className="flex items-baseline justify-between text-[10.5px]">
          <span className="text-ink-muted">View projection</span>
          <strong className="font-mono text-[9px] font-medium text-ink-soft">
            {VIEW_CRS}
          </strong>
        </div>
      </div>

      {layers.length ? (
        <>
          <SectionLabel trailing="Included">Layers</SectionLabel>
          <div className="flex flex-col gap-px">
            {[...layers].reverse().map((layer) => (
              <div
                key={layer.id}
                className="flex items-center gap-2 rounded-[7px] px-1.5 py-[6px]"
              >
                <LayerSwatch color={layer.style.color} />
                <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-soft">
                  {layer.name}
                </span>
                <span className="flex-none font-mono text-[9px] text-ink-muted">
                  {formatCount(layer.features.length)}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {recent.length ? (
        <p className="mb-0 mt-3 border-t border-line pt-[11px] text-[10.5px] leading-[1.55] text-ink-muted">
          {recent.length} large dataset{recent.length === 1 ? "" : "s"} from the
          last session were left on disk. Reload them from the Datasets panel.
        </p>
      ) : null}

      <InfoNote>
        A project file carries every layer with its data, styling, projection,
        the current view and your preferences, so it opens the same anywhere.
        Opening one replaces the workspace in place.
      </InfoNote>
    </PanelShell>
  );
}
