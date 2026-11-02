import type { PartSummary } from "../../services/api/projects";
import { Icon } from "../../shared/ui/Icon";

/** Toggles one part; selecting none or every part means the full score ([]). */
export function togglePart(selected: string[], partId: string, allIds: string[]): string[] {
  const base = selected.length === 0 ? allIds : selected;
  const next = base.includes(partId) ? base.filter((id) => id !== partId) : [...base, partId];
  const ordered = allIds.filter((id) => next.includes(id));
  return ordered.length === 0 || ordered.length === allIds.length ? [] : ordered;
}

export function partSelectionLabel(selected: string[], parts: PartSummary[]): string {
  if (selected.length === 0) return "フルスコア";
  if (selected.length === 1) return parts.find((p) => p.id === selected[0])?.name ?? "1パート";
  return `${selected.length}パート`;
}

interface PartPickerProps {
  parts: PartSummary[];
  selected: string[];
  onChange: (partIds: string[]) => void;
}

/** Full score, one part, or any set of parts (APP_DESIGN.md §7.4 FR-VIEW-001). */
export function PartPicker({ parts, selected, onChange }: PartPickerProps) {
  const allIds = parts.map((p) => p.id);
  const isShown = (id: string) => selected.length === 0 || selected.includes(id);
  return (
    <details className="part-picker">
      <summary>
        <Icon name="layers" />
        <span>表示パート: {partSelectionLabel(selected, parts)}</span>
        <Icon name="chevronDown" size={14} className="part-picker__chevron" />
      </summary>
      <fieldset className="part-picker__menu">
        <legend className="visually-hidden">表示するパート</legend>
        <label>
          <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} /> フルスコア（全パート）
        </label>
        {parts.map((p) => (
          <label key={p.id}>
            <input type="checkbox" checked={isShown(p.id)} onChange={() => onChange(togglePart(selected, p.id, allIds))} /> {p.name}
          </label>
        ))}
      </fieldset>
    </details>
  );
}
