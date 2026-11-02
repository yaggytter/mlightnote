import type { StaffLabel } from "../../services/notation/NotationRenderer";

/** Labels are worth showing only when there is more than one part. */
export function hasSeveralParts(labels: StaffLabel[]): boolean {
  return new Set(labels.map((l) => l.name)).size > 1;
}

/**
 * Full part names beside every system, in the margin left of the paper
 * (screen only — print keeps the engraved names and abbreviations). They
 * make a many-part score readable past page one, where the engraving
 * shows only abbreviations.
 */
export function StaffLabels({ labels }: { labels: StaffLabel[] }) {
  if (!hasSeveralParts(labels)) return null;
  return (
    <div className="staff-labels" aria-hidden="true">
      {labels.map((l, i) => (
        <span key={i} className="staff-labels__label" style={{ top: l.top, height: Math.max(l.bottom - l.top, 14) }} title={l.name}>
          {l.name}
        </span>
      ))}
    </div>
  );
}
