import type { PartSummary } from "../../services/api/projects";
import type { PartPatch } from "../../services/api/projectState";
import {
  CUSTOM_TRANSPOSITION,
  presetById,
  presetIdFor,
  sameTranspose,
  suggestedPreset,
  TRANSPOSITION_PRESETS,
  type Transpose,
} from "../../shared/transpositions";

const CONCERT: Transpose = { diatonic: 0, chromatic: 0, octaveChange: 0 };

interface TranspositionFieldProps {
  part: PartSummary;
  busy: boolean;
  onUpdate: (patch: PartPatch) => void;
}

/**
 * Which transposing instrument the part is written for. Changing it
 * rewrites the notation only; the sound (and the "実音表示" view) stays
 * the same. The part's sound (GM program) only *suggests* a setting —
 * it never changes the notation by itself.
 */
export function TranspositionField({ part, busy, onUpdate }: TranspositionFieldProps) {
  const current = part.transpose ?? CONCERT;
  const currentId = presetIdFor(current);
  const suggestion = suggestedPreset(part.mix.program);
  const showSuggestion = suggestion && !sameTranspose(suggestion.transpose, current);

  return (
    <div className="inspector__transpose">
      <label className="inspector__field">
        <span>移調（記譜）</span>
        <select
          value={currentId}
          disabled={busy}
          onChange={(e) => {
            const preset = presetById(e.target.value);
            if (preset) onUpdate({ transpose: preset.transpose });
          }}
        >
          {currentId === CUSTOM_TRANSPOSITION && <option value={CUSTOM_TRANSPOSITION}>ファイルの指定（{describe(current)}）</option>}
          {TRANSPOSITION_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {showSuggestion && (
        <button type="button" className="inspector__suggestion" disabled={busy} onClick={() => onUpdate({ transpose: suggestion.transpose })}>
          おすすめ: {shortLabel(suggestion.label)} に設定
        </button>
      )}
    </div>
  );
}

/** "B♭（クラリネット…）" → "B♭": the key alone fits on the button. */
function shortLabel(label: string): string {
  return label.split("（")[0];
}

function describe(t: Transpose): string {
  const parts = [`${t.chromatic > 0 ? "+" : ""}${t.chromatic}半音`];
  if (t.octaveChange) parts.push(`${t.octaveChange > 0 ? "+" : ""}${t.octaveChange}オクターブ`);
  return parts.join("・");
}
