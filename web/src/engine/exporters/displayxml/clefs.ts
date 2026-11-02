import { stepIndex } from "../../domain/pitch";
import { EVENT_NOTE, type ClefSpec, type Measure, type MeasureAttributes, type Part } from "../../domain/types";

// Mid-piece clef changes are shown only when they make the music easier to
// read: kept when the notes they govern need fewer ledger lines under the
// new clef than under the current one. Display-only; the model keeps the
// source's clefs.

interface StaffRange {
  bottom: number;
  top: number;
}

const REFERENCE: Record<string, number> = { G: 4 * 7 + 4, F: 3 * 7 + 3, C: 4 * 7 };
const DEFAULT_LINE: Record<string, number> = { G: 2, F: 4, C: 3 };

function clefRange(c: ClefSpec): StaffRange | null {
  const ref = REFERENCE[c.Sign];
  if (ref === undefined) return null; // percussion, TAB, none
  const line = c.Line === 0 ? DEFAULT_LINE[c.Sign] : c.Line;
  const bottom = ref - (line - 1) * 2;
  return { bottom, top: bottom + 8 };
}

function ledgerLines(r: StaffRange, diatonic: number): number {
  if (diatonic < r.bottom - 1) return Math.trunc((r.bottom - diatonic) / 2);
  if (diatonic > r.top + 1) return Math.trunc((diatonic - r.top) / 2);
  return 0;
}

function ledgerCost(part: Part, staff: number, from: number, to: number, c: ClefSpec): number | null {
  const r = clefRange(c);
  if (!r) return null;
  const measures = part.Measures ?? [];
  let cost = 0;
  for (let mi = from; mi < to && mi < measures.length; mi++) {
    for (const v of measures[mi].Voices ?? []) {
      if (v.Staff !== staff) continue;
      for (const e of v.Events ?? []) {
        if (e.Kind === EVENT_NOTE && e.Pitch && !e.Unpitched) cost += ledgerLines(r, e.Pitch.Octave * 7 + stepIndex(e.Pitch.Step));
      }
    }
  }
  return cost;
}

const key = (measure: number, attr: number, staff: number) => `${measure}/${attr}/${staff}`;
const sameClef = (a: ClefSpec, b: ClefSpec) => a.Staff === b.Staff && a.Sign === b.Sign && a.Line === b.Line;

function unhelpfulClefChanges(part: Part): Set<string> {
  const changes: { measure: number; attr: number; clef: ClefSpec }[] = [];
  const current = new Map<number, ClefSpec>();
  (part.Measures ?? []).forEach((m, mi) =>
    (m.AttributeChanges ?? []).forEach((a, ai) => {
      for (const c of a.Clefs ?? []) {
        if (!current.has(c.Staff)) current.set(c.Staff, c);
        else changes.push({ measure: mi, attr: ai, clef: c });
      }
    }),
  );
  const skip = new Set<string>();
  changes.forEach((ch, i) => {
    const staff = ch.clef.Staff;
    const old = current.get(staff)!;
    const k = key(ch.measure, ch.attr, staff);
    if (sameClef(old, ch.clef)) {
      skip.add(k);
      return;
    }
    let end = (part.Measures ?? []).length;
    const next = changes.slice(i + 1).find((n) => n.clef.Staff === staff);
    if (next) end = Math.max(next.measure, ch.measure + 1);
    const newCost = ledgerCost(part, staff, ch.measure, end, ch.clef);
    const oldCost = ledgerCost(part, staff, ch.measure, end, old);
    if (newCost !== null && oldCost !== null && newCost >= oldCost) {
      skip.add(k);
      return;
    }
    current.set(staff, ch.clef);
  });
  return skip;
}

function isEmptyAttributes(a: MeasureAttributes): boolean {
  return !a.Key && !a.Time && a.StaffCount === 0 && !(a.Clefs && a.Clefs.length) && !a.Transpose && a.Divisions === 0;
}

/** The part's measures without unhelpful clef changes. */
export function withReadableClefs(part: Part): Measure[] {
  const measures = part.Measures ?? [];
  const skip = unhelpfulClefChanges(part);
  if (skip.size === 0) return measures;
  return measures.map((m, mi) => {
    let changed = false;
    const attrs: MeasureAttributes[] = [];
    (m.AttributeChanges ?? []).forEach((a, ai) => {
      const clefs = (a.Clefs ?? []).filter((c) => {
        if (skip.has(key(mi, ai, c.Staff))) {
          changed = true;
          return false;
        }
        return true;
      });
      const next = { ...a, Clefs: clefs.length ? clefs : null };
      if (!isEmptyAttributes(next)) attrs.push(next);
    });
    return changed ? { ...m, AttributeChanges: attrs } : m;
  });
}
