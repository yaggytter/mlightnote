import { newID } from "../../domain/ids";
import { pitchFromMIDI } from "../../domain/pitch";
import { compare, rat, sub, type Rational } from "../../domain/rational";
import type { Barline, Direction, ImportWarning, Measure, Navigation, Notations, Part, ScoreEvent, SpanMark } from "../../domain/types";
import { attr, childNames, elements, intAttr, intChild, ownText, text, type XElement } from "../../xml/tree";

// ---- barlines and navigation (repeats, voltas, D.C./D.S.) ----

const DEFAULT_SEGNO = "segno";
const DEFAULT_CODA = "coda";

export function mapBarline(bx: XElement): Barline | null {
  const repeat = elements(bx, "repeat").at(-1);
  const ending = elements(bx, "ending").at(-1);
  const bl: Barline = { Location: attr(bx, "location") || "right", Style: text(bx, "bar-style"), Repeat: "", Times: 0, Ending: null };
  if (repeat) {
    const dir = attr(repeat, "direction");
    if (dir === "forward" || dir === "backward") {
      bl.Repeat = dir;
      const times = intAttr(repeat, "times");
      if (times > 0) bl.Times = times;
    }
  }
  if (ending && attr(ending, "type") !== "") {
    bl.Ending = { Numbers: attr(ending, "number").trim(), Type: attr(ending, "type"), Text: ownText(ending).trim() };
  }
  if (bl.Style === "" && bl.Repeat === "" && !bl.Ending) return null;
  return bl;
}

export interface SoundAttrs {
  segno: string;
  coda: string;
  dalsegno: string;
  tocoda: string;
  dacapo: string;
  fine: string;
}

export function readSound(el: XElement): SoundAttrs {
  return {
    segno: attr(el, "segno"),
    coda: attr(el, "coda"),
    dalsegno: attr(el, "dalsegno"),
    tocoda: attr(el, "tocoda"),
    dacapo: attr(el, "dacapo"),
    fine: attr(el, "fine"),
  };
}

export function mergeSound(n: Navigation, s: SoundAttrs): Navigation {
  const out = { ...n };
  if (s.segno) out.Segno = s.segno;
  if (s.coda) out.Coda = s.coda;
  if (s.dalsegno) out.DalSegno = s.dalsegno;
  if (s.tocoda) out.ToCoda = s.tocoda;
  if (out.DaCapo || s.dacapo === "yes") out.DaCapo = true;
  if (out.Fine || (s.fine !== "" && s.fine !== "no")) out.Fine = true;
  return out;
}

const DA_CAPO = /\bD\.\s*C\.|\bda\s+capo\b/i;
const DAL_SEGNO = /\bD\.\s*S\.|\bdal\s+segno\b/i;
const TO_CODA = /\bto\s+coda\b/i;
const FINE = /^\s*fine\s*$/i;

/** Jumps read from signs and text when the source has no <sound> jumps. */
export function inferNavigation(directions: Direction[]): Navigation {
  const n: Navigation = {};
  for (const d of directions) {
    if (d.Type === "segno") n.Segno = DEFAULT_SEGNO;
    else if (d.Type === "coda") n.Coda = DEFAULT_CODA;
    else if (d.Type === "words") {
      if (DA_CAPO.test(d.Text)) n.DaCapo = true;
      else if (DAL_SEGNO.test(d.Text)) n.DalSegno = DEFAULT_SEGNO;
      else if (TO_CODA.test(d.Text)) n.ToCoda = DEFAULT_CODA;
      else if (FINE.test(d.Text)) n.Fine = true;
    }
  }
  return n;
}

// ---- note-attached notations ----

function span(s: XElement): SpanMark {
  const m: SpanMark = { Type: attr(s, "type") };
  const num = intAttr(s, "number");
  if (num) m.Number = num;
  if (attr(s, "placement")) m.Placement = attr(s, "placement");
  if (attr(s, "bracket")) m.Bracket = attr(s, "bracket");
  return m;
}

export function mapNotations(blocks: XElement[]): Notations | undefined {
  const n: Notations = {};
  const push = <K extends "Slurs" | "Tuplets" | "Articulations" | "Ornaments">(k: K, v: NonNullable<Notations[K]>) => {
    if (v.length) n[k] = [...((n[k] as unknown[]) ?? []), ...v] as Notations[K];
  };
  for (const b of blocks) {
    push("Slurs", elements(b, "slur").filter((s) => attr(s, "type") !== "").map(span));
    push("Tuplets", elements(b, "tuplet").filter((s) => attr(s, "type") !== "").map(span));
    for (const a of elements(b, "articulations")) push("Articulations", childNames(a));
    for (const o of elements(b, "ornaments")) push("Ornaments", childNames(o));
    for (const f of elements(b, "fermata")) n.Fermata = attr(f, "type") || "upright";
    if (elements(b, "arpeggiate").length > 0) n.Arpeggiate = true;
  }
  const empty = !n.Slurs && !n.Tuplets && !n.Articulations && !n.Ornaments && !n.Fermata && !n.Arpeggiate;
  return empty ? undefined : n;
}

// ---- unpitched (percussion) notes ----

/** midi-instrument id → 0-based percussion key (<midi-unpitched> is 1-based). */
export function drumKeys(instruments: XElement[]): Map<string, number> {
  const keys = new Map<string, number>();
  for (const mi of instruments) {
    const id = attr(mi, "id");
    const u = intChild(mi, "midi-unpitched");
    if (id && u >= 1 && u <= 128) keys.set(id, u - 1);
  }
  return keys;
}

export function mapUnpitched(event: ScoreEvent, unpitched: XElement, instrument: XElement | undefined, drums: Map<string, number>): void {
  event.Percussion = true;
  event.Unpitched = { Step: text(unpitched, "display-step"), Octave: intChild(unpitched, "display-octave") };
  if (!instrument) return;
  const key = drums.get(attr(instrument, "id"));
  if (key !== undefined) {
    const p = pitchFromMIDI(key);
    event.Pitch = p;
    event.ConcertPitch = { ...p };
  }
}

export function hasUnpitched(part: Part): boolean {
  return (part.Measures ?? []).some((m) => (m.Voices ?? []).some((v) => (v.Events ?? []).some((e) => !!e.Unpitched)));
}

// ---- measure numbering ----

/** Renumbers degenerate measure numbers (e.g. every measure "0"). */
export function renumberDuplicateMeasures(parts: Part[]): Part[] | null {
  if (parts.length === 0 || !numbersDegenerate(parts[0].Measures ?? [])) return null;
  return parts.map((part) => {
    let n = 0;
    const measures: Measure[] = (part.Measures ?? []).map((m, i) => {
      if (!(i === 0 && m.Implicit)) n++;
      return { ...m, Number: String(n) };
    });
    return { ...part, Measures: measures };
  });
}

function numbersDegenerate(measures: Measure[]): boolean {
  if (measures.length < 2) return false;
  return new Set(measures.map((m) => m.Number)).size * 2 < measures.length;
}

// ---- <backup> clamping ----

export const BACKUP_ELEMENT = "backup";

/** Moves the cursor back by d, stopping at the measure start. */
export function backupCursor(cursor: Rational, d: Rational, clamped: boolean): [Rational, boolean] {
  const next = sub(cursor, d);
  if (compare(next, rat(0)) < 0) return [rat(0), true];
  return [next, clamped];
}

/** Folds per-measure clamp markers into one REPAIRED warning per part. */
export function summarizeBackupRepairs(warnings: ImportWarning[], partSourceID: string): ImportWarning[] {
  const out: ImportWarning[] = [];
  const measures: string[] = [];
  let first = -1;
  for (const w of warnings) {
    if (w.Element !== BACKUP_ELEMENT || w.Code !== "") {
      out.push(w);
      continue;
    }
    if (first < 0) first = w.MeasureIndex;
    measures.push(String(w.MeasureIndex + 1));
  }
  if (measures.length === 0) return out;
  const shown = measures.length > 10 ? [...measures.slice(0, 10), "…"] : measures;
  out.push({
    Severity: "warning",
    Code: "REPAIRED",
    Message: `${measures.length}小節で<backup>が小節の先頭より前を指していたため、小節の先頭に補正しました（${shown.join(", ")}小節目）。`,
    PartID: partSourceID,
    MeasureIndex: first,
    Element: BACKUP_ELEMENT,
  });
  return out;
}

export { newID };
