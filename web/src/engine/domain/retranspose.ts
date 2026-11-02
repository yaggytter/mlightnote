import { applyTranspose, inverse, isNoTranspose, transposeFifths } from "./pitch";
import { EVENT_NOTE, type Harmony, type Measure, type Part, type ScoreEvent, type Transpose } from "./types";

/**
 * Rewrites a part as notated for an instrument with transposition t,
 * keeping every sounding pitch (APP_DESIGN.md §7.7 FR-EDIT-001). Written
 * pitches are respelled from concert pitch, key signatures move with the
 * instrument, chord symbols follow the notes, and the source's accidental
 * marks are dropped. The input is not modified.
 */
export function retranspose(part: Part, t: Transpose): Part {
  let source = part.Instrument.Transpose;
  const measures: Measure[] = (part.Measures ?? []).map((m) => {
    const attrs = (m.AttributeChanges ?? []).map((a) => {
      if (a.Transpose) source = a.Transpose;
      const key = a.Key ? { Fifths: transposeFifths(transposeFifths(a.Key.Fifths, source.chromatic), -t.chromatic) } : null;
      return { ...a, Key: key, Transpose: null };
    });
    return {
      ...m,
      AttributeChanges: m.AttributeChanges ? attrs : m.AttributeChanges,
      Harmonies: retransposeHarmonies(m.Harmonies, source, t),
      Voices: m.Voices ? m.Voices.map((v) => ({ ...v, Events: v.Events ? v.Events.map((e) => rewriteEvent(e, t)) : v.Events })) : m.Voices,
    };
  });
  const out: Part = { ...part, Instrument: { ...part.Instrument, Transpose: t }, Measures: part.Measures ? measures : part.Measures };
  return declareTransposition(out, t);
}

function rewriteEvent(e: ScoreEvent, t: Transpose): ScoreEvent {
  if (e.Kind !== EVENT_NOTE || !e.Pitch || e.Unpitched) return e;
  const concert = e.ConcertPitch ?? e.Pitch;
  return { ...e, Pitch: applyTranspose(concert, inverse(t)), ConcertPitch: concert, Accidental: "" };
}

function declareTransposition(part: Part, t: Transpose): Part {
  if (isNoTranspose(t) || !part.Measures || part.Measures.length === 0) return part;
  const [first, ...rest] = part.Measures;
  const attrs = first.AttributeChanges ?? [];
  const declared = { ...t };
  const firstAttrs =
    attrs.length === 0
      ? [{ Divisions: 0, Key: null, Time: null, Clefs: null, StaffCount: 0, Transpose: declared }]
      : [{ ...attrs[0], Transpose: declared }, ...attrs.slice(1)];
  return { ...part, Measures: [{ ...first, AttributeChanges: firstAttrs }, ...rest] };
}

/** Moves a chord symbol's root and bass by t, spelled by letter name. */
export function transposeHarmony(h: Harmony, t: Transpose): Harmony {
  const out = { ...h };
  if (h.RootStep) {
    const p = applyTranspose({ Step: h.RootStep, Alter: h.RootAlter, Octave: 4, CentsOffset: 0 }, t);
    out.RootStep = p.Step;
    out.RootAlter = p.Alter;
  }
  if (h.BassStep) {
    const p = applyTranspose({ Step: h.BassStep, Alter: h.BassAlter, Octave: 4, CentsOffset: 0 }, t);
    out.BassStep = p.Step;
    out.BassAlter = p.Alter;
  }
  return out;
}

function retransposeHarmonies(hs: Harmony[] | null, source: Transpose, t: Transpose): Harmony[] | null {
  if (!hs || hs.length === 0) return hs;
  return hs.map((h) => transposeHarmony(transposeHarmony(h, source), inverse(t)));
}
