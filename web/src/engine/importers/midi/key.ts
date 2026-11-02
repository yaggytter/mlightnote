import type { Pitch } from "../../domain/types";
import { EventKind, type MIDIFile } from "./smf";
import type { RawNote } from "./notes";

// Key detection (declared FF 59 at tick 0, otherwise Krumhansl–Schmuckler
// on duration-weighted pitch classes) and key-aware spelling.

export interface Key {
  fifths: number;
  minor: boolean;
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJOR_FIFTHS_BY_TONIC = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

/** The key, whether the file declared it, or null when there are no notes. */
export function detectKey(file: MIDIFile, notes: RawNote[]): { key: Key; declared: boolean } | null {
  for (const tr of file.tracks) {
    for (const e of tr.events) {
      if (e.kind === EventKind.KeySignature && e.tick === 0) return { key: { fifths: e.keyFifths, minor: e.keyMinor }, declared: true };
    }
  }
  const hist = new Array<number>(12).fill(0);
  for (const n of notes) hist[n.pitch % 12] += n.endTick - n.startTick;
  let total = 0;
  for (const v of hist) total += v;
  if (total === 0) return null;
  let best: Key = { fifths: 0, minor: false };
  let bestScore = -2;
  for (let tonic = 0; tonic < 12; tonic++) {
    const major = correlate(hist, MAJOR, tonic);
    if (major > bestScore) {
      best = { fifths: MAJOR_FIFTHS_BY_TONIC[tonic], minor: false };
      bestScore = major;
    }
    const minor = correlate(hist, MINOR, tonic);
    if (minor > bestScore) {
      best = { fifths: MAJOR_FIFTHS_BY_TONIC[(tonic + 3) % 12], minor: true };
      bestScore = minor;
    }
  }
  return { key: best, declared: false };
}

function correlate(hist: number[], profile: number[], tonic: number): number {
  let mx = 0;
  let my = 0;
  for (let i = 0; i < 12; i++) {
    mx += hist[(tonic + i) % 12];
    my += profile[i];
  }
  mx /= 12;
  my /= 12;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < 12; i++) {
    const x = hist[(tonic + i) % 12] - mx;
    const y = profile[i] - my;
    num += x * y;
    dx += x * x;
    dy += y * y;
  }
  if (dx === 0 || dy === 0) return -1;
  return num / Math.sqrt(dx * dy);
}

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const SHARP_FALLBACK: [string, number][] = [["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0], ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0]];
const FLAT_FALLBACK: [string, number][] = [["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0], ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0]];

/** Spells MIDI notes with the key's letters (the harmonic-minor leading tone too). */
export class Speller {
  private readonly byPC: ([string, number] | undefined)[] = new Array(12).fill(undefined);
  private readonly flat: boolean;

  constructor(key: Key) {
    this.flat = key.fifths < 0;
    const alterOf: Record<string, number> = {};
    if (key.fifths > 0) for (let i = 0; i < key.fifths && i < 7; i++) alterOf[SHARP_ORDER[i]] = 1;
    else for (let i = 0; i < -key.fifths && i < 7; i++) alterOf[SHARP_ORDER[6 - i]] = -1;
    for (const l of LETTERS) {
      const alter = alterOf[l] ?? 0;
      this.byPC[(((NATURAL_PC[l] + alter) % 12) + 12) % 12] = [l, alter];
    }
    if (key.minor) {
      const tonicPC = ((((key.fifths * 7) % 12) + 12) % 12 + 9) % 12; // relative minor
      const lead = (tonicPC + 11) % 12;
      if (!this.byPC[lead]) {
        const seventh = this.byPC[(tonicPC + 10) % 12];
        if (seventh) this.byPC[lead] = [seventh[0], seventh[1] + 1];
      }
    }
  }

  spell(note: number): Pitch {
    const pc = note % 12;
    const [step, alter] = this.byPC[pc] ?? (this.flat ? FLAT_FALLBACK[pc] : SHARP_FALLBACK[pc]);
    return { Step: step, Alter: alter, Octave: Math.trunc((note - alter - NATURAL_PC[step]) / 12) - 1, CentsOffset: 0 };
  }
}
