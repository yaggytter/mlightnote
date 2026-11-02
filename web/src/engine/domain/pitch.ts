import type { Pitch, Transpose } from "./types";

const NATURAL_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const STEP_ORDER = ["C", "D", "E", "F", "G", "A", "B"] as const;

export const NO_TRANSPOSE: Transpose = { diatonic: 0, chromatic: 0, octaveChange: 0 };

export function midiNote(p: Pitch): number {
  return (p.Octave + 1) * 12 + (NATURAL_SEMITONE[p.Step] ?? 0) + p.Alter;
}

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

function floorMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

export function stepIndex(step: string): number {
  const i = STEP_ORDER.indexOf(step as (typeof STEP_ORDER)[number]);
  return i < 0 ? 0 : i;
}

/**
 * The pitch that sounds when this written pitch is played on an instrument
 * with transposition t. Letters move by diatonic steps; the alteration is
 * derived so the MIDI note matches the chromatic shift exactly.
 */
export function applyTranspose(p: Pitch, t: Transpose): Pitch {
  const target = midiNote(p) + t.chromatic + 12 * t.octaveChange;
  const shifted = stepIndex(p.Step) + t.diatonic;
  const step = STEP_ORDER[floorMod(shifted, 7)];
  const octave = p.Octave + floorDiv(shifted, 7) + t.octaveChange;
  const alter = target - ((octave + 1) * 12 + NATURAL_SEMITONE[step]);
  return { Step: step, Alter: alter, Octave: octave, CentsOffset: p.CentsOffset };
}

export function inverse(t: Transpose): Transpose {
  return { diatonic: -t.diatonic || 0, chromatic: -t.chromatic || 0, octaveChange: -t.octaveChange || 0 };
}

export function isNoTranspose(t: Transpose): boolean {
  return t.diatonic === 0 && t.chromatic === 0 && t.octaveChange === 0;
}

export function sameTranspose(a: Transpose, b: Transpose): boolean {
  return a.diatonic === b.diatonic && a.chromatic === b.chromatic && a.octaveChange === b.octaveChange;
}

/** Spells a MIDI note with sharps (60 = C4). */
export function pitchFromMIDI(n: number): Pitch {
  const names: [string, number][] = [
    ["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0], ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0],
  ];
  const [step, alter] = names[floorMod(n, 12)];
  return { Step: step, Alter: alter, Octave: floorDiv(n, 12) - 1, CentsOffset: 0 };
}

/**
 * Moves a key signature by a chromatic interval around the circle of fifths
 * (7 semitones = one fifth), preferring the spelling with fewer accidentals.
 */
export function transposeFifths(fifths: number, chromatic: number): number {
  let delta = floorMod(chromatic * 7, 12);
  if (delta > 6) delta -= 12;
  let f = fifths + delta;
  while (f > 7) f -= 12;
  while (f < -7) f += 12;
  return f;
}
