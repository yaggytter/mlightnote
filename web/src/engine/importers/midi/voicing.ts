import { gmDrum } from "../../domain/drums";
import { midiNote } from "../../domain/pitch";
import { EVENT_NOTE, type ScoreEvent } from "../../domain/types";
import type { RawNote } from "./notes";

/** A quantized note on one lane, possibly one piece of a split longer note. */
export interface QNote {
  start: number;
  end: number;
  pitch: number;
  tieStart: boolean;
  tieStop: boolean;
}

/**
 * Makes a lane writable as one voice: each note stops at the next onset,
 * and notes starting together are cut at every member's end with ties
 * carrying the longer ones — a MusicXML chord must share one duration.
 */
export function blockChords(notes: QNote[]): QNote[] {
  if (notes.length === 0) return [];
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const out: QNote[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j].start === sorted[i].start) j++;
    const nextOnset = j < sorted.length ? sorted[j].start : -1;
    out.push(...splitChord(dedupePitches(sorted.slice(i, j)), nextOnset));
    i = j;
  }
  return out;
}

function dedupePitches(chord: QNote[]): QNote[] {
  const best = new Map<number, QNote>();
  for (const n of chord) {
    const b = best.get(n.pitch);
    if (!b || n.end > b.end) best.set(n.pitch, n);
  }
  return [...best.values()].map((n) => ({ ...n }));
}

function splitChord(chord: QNote[], nextOnset: number): QNote[] {
  const ends = new Set<number>();
  for (const n of chord) {
    if (nextOnset >= 0 && n.end > nextOnset) n.end = nextOnset;
    ends.add(n.end);
  }
  const cuts = [...ends].sort((a, b) => a - b);
  const out: QNote[] = [];
  for (const n of chord) {
    let from = n.start;
    for (const cut of cuts) {
      if (cut <= from || cut > n.end) continue;
      out.push({ start: from, end: cut, pitch: n.pitch, tieStop: from > n.start || n.tieStop, tieStart: cut < n.end || n.tieStart });
      from = cut;
    }
  }
  return out;
}

// ---- drum lanes: hands stems-up in voice 1, feet stems-down in voice 2 ----

export interface LaneSpec {
  staff: number;
  voice: number;
  stem: string;
  drums: boolean;
}

export const HANDS_LANE = 1;
export const FEET_LANE = 2;

export const DRUM_LANES = new Map<number, LaneSpec>([
  [HANDS_LANE, { staff: 1, voice: 1, stem: "up", drums: true }],
  [FEET_LANE, { staff: 1, voice: 2, stem: "down", drums: true }],
]);

export function splitDrumLanes(notes: RawNote[]): Map<number, RawNote[]> {
  const lanes = new Map<number, RawNote[]>();
  for (const n of notes) {
    const lane = gmDrum(n.pitch).Foot ? FEET_LANE : HANDS_LANE;
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane)!.push(n);
  }
  return lanes;
}

/** A drum hit lasts until the lane's next hit, at most one beat. */
export function drumLengths(notes: QNote[], beat: number, grid: number): QNote[] {
  const out = [...notes].sort((a, b) => a.start - b.start).map((n) => ({ ...n }));
  for (let i = 0; i < out.length; i++) {
    let end = out[i].start + beat;
    for (let j = i + 1; j < out.length; j++) {
      if (out[j].start > out[i].start) {
        end = Math.min(end, out[j].start);
        break;
      }
    }
    out[i].end = Math.max(end, out[i].start + grid);
  }
  return out;
}

/** Unpitched drum notation from the GM map; Pitch keeps the MIDI key. */
export function asDrumNotes(events: ScoreEvent[], stem: string): ScoreEvent[] {
  return events.map((e) => {
    if (e.Kind !== EVENT_NOTE || !e.Pitch) return e;
    const d = gmDrum(midiNote(e.Pitch));
    const out: ScoreEvent = { ...e, Unpitched: { Step: d.Step, Octave: d.Octave }, Stem: stem, Accidental: "", Percussion: true };
    if (d.Notehead) out.Notehead = d.Notehead;
    else delete out.Notehead;
    return out;
  });
}
