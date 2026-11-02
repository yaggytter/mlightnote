import { useEffect, useState } from "react";
import type { PartSummary } from "../../services/api/projects";
import type { MetadataPatch, PartPatch, ProjectState } from "../../services/api/projectState";
import { GM_PROGRAM_NAMES, programLabel } from "../../shared/gm";
import { Icon } from "../../shared/ui/Icon";
import { TranspositionField } from "./TranspositionField";

interface InspectorProps {
  state: ProjectState;
  parts: PartSummary[];
  busy: boolean;
  onUpdateMetadata: (patch: MetadataPatch) => void;
  onUpdatePart: (partId: string, patch: PartPatch) => void;
  onReorderParts: (partIds: string[]) => void;
}

/** The part order after moving one part up (-1) or down (+1). */
export function movePart(ids: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

const METADATA_FIELDS: { key: keyof MetadataPatch; label: string }[] = [
  { key: "title", label: "曲名" },
  { key: "movement", label: "サブタイトル（タイトルの下の行）" },
  { key: "composer", label: "作曲" },
  { key: "arranger", label: "編曲" },
  { key: "lyricist", label: "作詞" },
  { key: "copyright", label: "著作権表示" },
];

// The line under the title is MusicXML's movement title; a subtitle
// entered before that was editable is shown there when no movement is set.
function metadataValue(state: ProjectState, key: keyof MetadataPatch): string {
  if (key === "movement") return state.metadata.movement || state.metadata.subtitle || "";
  return state.metadata[key] ?? "";
}

// A text field that commits on blur or Enter, so each finished edit is one
// command (one undo step) rather than one per keystroke (§6.3 "確定済み変更
// をコマンド履歴へ追加する").
function CommitField({
  label,
  value,
  onCommit,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  disabled: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="inspector__field">
      <span>{label}</span>
      <input
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(value);
        }}
      />
    </label>
  );
}

interface PartEditorProps {
  part: PartSummary;
  busy: boolean;
  onUpdate: (patch: PartPatch) => void;
  onMove: ((delta: -1 | 1) => void) | null;
  isFirst: boolean;
  isLast: boolean;
}

function PartEditor({ part, busy, onUpdate, onMove, isFirst, isLast }: PartEditorProps) {
  const { mix } = part;
  // Optimistic toggles (§8.2 "optimistic表示"): reflect the click at once,
  // then fall back to the server's value when the refreshed part arrives.
  type ToggleKey = "muted" | "solo" | "visible" | "printable";
  const [pending, setPending] = useState<Pick<PartPatch, ToggleKey>>({});
  useEffect(() => setPending({}), [mix.muted, mix.solo, mix.visible, mix.printable]);
  const toggle = (key: ToggleKey, value: boolean) => {
    setPending((p) => ({ ...p, [key]: value }));
    onUpdate({ [key]: value });
  };
  return (
    <fieldset className="inspector__part">
      <legend>{part.name}</legend>
      {onMove && (
        <div className="inspector__order">
          <button type="button" className="icon-button icon-button--small" disabled={busy || isFirst} onClick={() => onMove(-1)} aria-label={`${part.name}を上へ`} title="上へ">
            <Icon name="arrowUp" size={14} />
          </button>
          <button type="button" className="icon-button icon-button--small" disabled={busy || isLast} onClick={() => onMove(1)} aria-label={`${part.name}を下へ`} title="下へ">
            <Icon name="arrowDown" size={14} />
          </button>
        </div>
      )}
      <CommitField label="パート名" value={part.name} disabled={busy} onCommit={(name) => name.trim() && onUpdate({ name: name.trim() })} />
      <CommitField
        label="略称（2段目以降の表示）"
        value={part.abbreviation}
        placeholder={part.autoAbbreviation ? `自動: ${part.autoAbbreviation}` : undefined}
        disabled={busy}
        onCommit={(abbreviation) => onUpdate({ abbreviation })}
      />
      <label className="inspector__field">
        <span>音色</span>
        <select value={mix.program} disabled={busy} onChange={(e) => onUpdate({ program: Number(e.target.value) })}>
          {GM_PROGRAM_NAMES.map((_, program) => (
            <option key={program} value={program}>
              {programLabel(program)}
            </option>
          ))}
        </select>
      </label>
      {!part.percussion && <TranspositionField part={part} busy={busy} onUpdate={onUpdate} />}
      <label className="inspector__field">
        <span>音量 {Math.round(mix.volume * 100)}</span>
        <input type="range" min={0} max={1} step={0.05} defaultValue={mix.volume} key={`v${mix.volume}`} disabled={busy}
          aria-valuetext={`${Math.round(mix.volume * 100)}`}
          onPointerUp={(e) => onUpdate({ volume: Number((e.target as HTMLInputElement).value) })}
          onKeyUp={(e) => onUpdate({ volume: Number((e.target as HTMLInputElement).value) })} />
      </label>
      <label className="inspector__field">
        <span>パン {mix.pan === 0 ? "C" : mix.pan < 0 ? `L${Math.round(-mix.pan * 100)}` : `R${Math.round(mix.pan * 100)}`}</span>
        <input type="range" min={-1} max={1} step={0.05} defaultValue={mix.pan} key={`p${mix.pan}`} disabled={busy}
          onPointerUp={(e) => onUpdate({ pan: Number((e.target as HTMLInputElement).value) })}
          onKeyUp={(e) => onUpdate({ pan: Number((e.target as HTMLInputElement).value) })} />
      </label>
      <div className="inspector__toggles">
        <label><input type="checkbox" checked={pending.muted ?? mix.muted} disabled={busy} onChange={(e) => toggle("muted", e.target.checked)} /> ミュート</label>
        <label><input type="checkbox" checked={pending.solo ?? mix.solo} disabled={busy} onChange={(e) => toggle("solo", e.target.checked)} /> ソロ</label>
      </div>
      <div className="inspector__toggles">
        <label title="フルスコア表示に含める">
          <input type="checkbox" checked={pending.visible ?? mix.visible ?? true} disabled={busy} onChange={(e) => toggle("visible", e.target.checked)} /> 表示
        </label>
        <label title="フルスコア印刷に含める">
          <input type="checkbox" checked={pending.printable ?? mix.printable ?? true} disabled={busy} onChange={(e) => toggle("printable", e.target.checked)} /> 印刷
        </label>
      </div>
    </fieldset>
  );
}

export function Inspector({ state, parts, busy, onUpdateMetadata, onUpdatePart, onReorderParts }: InspectorProps) {
  const ids = parts.map((p) => p.id);
  return (
    <aside className="inspector" aria-label="インスペクター">
      <section className="inspector__section">
        <h2>曲情報</h2>
        {METADATA_FIELDS.map(({ key, label }) => (
          <CommitField key={key} label={label} value={metadataValue(state, key)} disabled={busy} onCommit={(v) => onUpdateMetadata({ [key]: v })} />
        ))}
      </section>
      <h2 className="inspector__parts-heading">パート</h2>
      {parts.map((p, i) => (
        <PartEditor
          key={p.id}
          part={p}
          busy={busy}
          onUpdate={(patch) => onUpdatePart(p.id, patch)}
          onMove={parts.length > 1 ? (delta) => onReorderParts(movePart(ids, i, delta)) : null}
          isFirst={i === 0}
          isLast={i === parts.length - 1}
        />
      ))}
    </aside>
  );
}
