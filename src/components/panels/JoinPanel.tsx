import { useMemo, useState } from "react";
import { Database, FileSpreadsheet, GitMerge } from "lucide-react";
import { normalizeJoinKey, parseJoinTable, previewJoin } from "../../lib/gis/join";
import type { JoinTable } from "../../lib/gis/join";
import { openTextFile } from "../../lib/fileIo";
import { formatCount } from "../../lib/format";
import { describeError, joinTableOntoLayer } from "../../lib/projectFile";
import { useProjectStore } from "../../state/projectStore";
import { useUiStore } from "../../state/uiStore";
import { PanelShell } from "../PanelShell";
import {
  EmptyState,
  FIELD_INPUT,
  InfoNote,
  KeyValue,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SectionLabel,
} from "./shared";

const TABLE_FILTERS = [
  { name: "Tables", extensions: ["csv", "tsv", "txt"] },
];

function comparable(name: string): string {
  return normalizeJoinKey(name).replace(/[^a-z0-9]/g, "");
}

/**
 * Picks the column that looks like a shared key. A column named like one of the
 * layer's own fields wins, so a census table opens keyed on ADM2_PCODE rather
 * than on whichever column happens to end in "name".
 */
function guessKeyColumn(
  headers: string[],
  fields: { name: string }[],
): string {
  const shared = new Set(fields.map((field) => comparable(field.name)));
  const matching = headers.find((header) => shared.has(comparable(header)));

  if (matching) {
    return matching;
  }

  const preferred = /(pcode|code|id|name)$/i;
  return headers.find((header) => preferred.test(header.trim())) ?? headers[0] ?? "";
}

/** Matches a table column to a layer field, ignoring case and separators. */
function guessTargetField(
  fields: { name: string }[],
  keyColumn: string,
): string {
  const wanted = comparable(keyColumn);
  const exact = fields.find((field) => comparable(field.name) === wanted);

  return exact?.name ?? fields[0]?.name ?? "";
}

export function JoinPanel() {
  const closePanel = useUiStore((state) => state.closePanel);
  const notify = useUiStore((state) => state.notify);
  const layers = useProjectStore((state) => state.layers);
  const setActiveLayer = useProjectStore((state) => state.setActiveLayer);

  const [raw, setRaw] = useState<{ text: string; name: string } | null>(null);
  const [table, setTable] = useState<JoinTable | null>(null);
  const [keyColumn, setKeyColumn] = useState("");
  const [targetLayerId, setTargetLayerId] = useState("");
  const [targetField, setTargetField] = useState("");
  const [busy, setBusy] = useState(false);

  const joinable = useMemo(
    () => layers.filter((layer) => layer.features.length > 0),
    [layers],
  );
  const target = joinable.find((layer) => layer.id === targetLayerId) ?? null;

  const preview = useMemo(() => {
    if (!table || !target || !keyColumn || !targetField) {
      return null;
    }

    try {
      return previewJoin(target, table, keyColumn, targetField);
    } catch {
      return null;
    }
  }, [table, target, keyColumn, targetField]);

  const openTable = async () => {
    setBusy(true);

    try {
      const file = await openTextFile(TABLE_FILTERS);

      if (!file) {
        return;
      }

      const parsed = parseJoinTable(file.text, file.name.replace(/\.[^.]+$/, ""));
      setTable(parsed);
      setRaw({ text: file.text, name: file.name.replace(/\.[^.]+$/, "") });

      const first = joinable.find((layer) => /polygon/i.test(layer.geometryKind)) ?? joinable[0];
      const guessed = guessKeyColumn(parsed.headers, first?.fields ?? []);
      setKeyColumn(guessed);

      if (first) {
        setTargetLayerId(first.id);
        setTargetField(guessTargetField(first.fields, guessed));
      }
    } catch (error) {
      notify(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const runJoin = () => {
    if (!raw) {
      return;
    }

    setBusy(true);

    try {
      const { layer, outcome } = joinTableOntoLayer({
        tableText: raw.text,
        tableName: raw.name,
        keyColumn,
        targetLayerId,
        targetField,
      });

      setActiveLayer(layer.id);
      notify(
        `Joined ${formatCount(outcome.preview.matchedFeatures)} features from “${raw.name}”`,
      );

      for (const warning of [...outcome.warnings, ...outcome.replacedColumns.map((column) => `“${column}” from the table replaced the layer's own values`)].slice(0, 2)) {
        console.warn("Join warning", warning);
      }
    } catch (error) {
      notify(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelShell
      eyebrow="Analysis"
      title="Join table"
      onClose={closePanel}
      footer={
        <>
          <span>Match on a shared key</span>
          <span>{table ? `${formatCount(table.rows.length)} rows` : "No table"}</span>
        </>
      }
    >
      <SectionLabel trailing={table ? "Loaded" : "CSV or TSV"}>Attribute table</SectionLabel>
      <button
        type="button"
        className={`${SECONDARY_BUTTON} w-full`}
        disabled={busy}
        onClick={() => void openTable()}
      >
        <FileSpreadsheet size={13} strokeWidth={1.9} aria-hidden="true" />
        {table ? "Choose another table" : "Open table"}
      </button>

      {table ? (
        <p className="mb-0 mt-2 flex items-center gap-1.5 text-[10.5px] text-ink-muted">
          <strong className="font-semibold text-ink-soft">{table.name}</strong>
          <span className="font-mono text-[9px]">
            {formatCount(table.rows.length)} rows · {table.headers.length} columns
          </span>
        </p>
      ) : null}

      {!joinable.length ? (
        <EmptyState
          icon={<Database size={22} strokeWidth={1.4} aria-hidden="true" />}
          title="No layer to join onto. Load boundaries first — the bundled Bangladesh districts work well."
        />
      ) : (
        <>
          <SectionLabel>Match</SectionLabel>
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-[10.5px] text-ink-muted">
              Table column
              <select
                className={FIELD_INPUT}
                value={keyColumn}
                disabled={!table}
                onChange={(event) => {
                  const value = event.target.value;
                  setKeyColumn(value);

                  if (target) {
                    setTargetField(guessTargetField(target.fields, value));
                  }
                }}
              >
                {!table ? <option value="">Open a table first</option> : null}
                {(table?.headers ?? []).map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[10.5px] text-ink-muted">
              Layer
              <select
                className={FIELD_INPUT}
                value={targetLayerId}
                onChange={(event) => {
                  const id = event.target.value;
                  const next = joinable.find((layer) => layer.id === id);
                  setTargetLayerId(id);

                  if (next) {
                    setTargetField(guessTargetField(next.fields, keyColumn));
                  }
                }}
              >
                {joinable.map((layer) => (
                  <option key={layer.id} value={layer.id}>
                    {layer.name} ({formatCount(layer.features.length)})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[10.5px] text-ink-muted">
              Layer field
              <select
                className={FIELD_INPUT}
                value={targetField}
                onChange={(event) => setTargetField(event.target.value)}
              >
                {(target?.fields ?? []).map((field) => (
                  <option key={field.name} value={field.name}>
                    {field.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {preview ? (
            <>
              <SectionLabel trailing={`${formatCount(preview.matchedRows)} matched`}>
                Preview
              </SectionLabel>
              <div className="flex flex-col gap-1.5">
                <KeyValue label="Table rows" value={formatCount(preview.rows)} />
                <KeyValue
                  label="Features receiving values"
                  value={`${formatCount(preview.matchedFeatures)} of ${formatCount(preview.features)}`}
                />
                <KeyValue label="Rows without a match" value={formatCount(preview.rows - preview.matchedRows)} />
              </div>

              {preview.unmatchedSample.length ? (
                <p className="mb-0 mt-2 font-mono text-[9px] leading-relaxed text-ink-muted">
                  Unmatched keys: {preview.unmatchedSample.join(", ")}
                </p>
              ) : null}
            </>
          ) : null}

          <button
            type="button"
            className={`${PRIMARY_BUTTON} mt-3.5 w-full`}
            disabled={busy || !preview || preview.matchedFeatures === 0}
            onClick={runJoin}
          >
            <GitMerge size={13} strokeWidth={1.9} aria-hidden="true" />
            Join onto {target?.name ?? "layer"}
          </button>
        </>
      )}

      <InfoNote>
        The table keeps its own columns and the layer keeps its geometry: the
        result is a new layer, leaving the boundary layer untouched. Keys are
        compared ignoring case and spaces, so a census table keyed on{" "}
        {`ADM2_PCODE`} lines up with a boundary layer keyed on {`adm2_pcode`}.
        Rows that match nothing are counted above and left without values.
      </InfoNote>
    </PanelShell>
  );
}
