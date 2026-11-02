import { EventKind, type MIDIEvent } from "./smf";

/** A paired note-on/off before quantization. */
export interface RawNote {
  startTick: number;
  endTick: number;
  pitch: number;
}

/**
 * Pairs note-on/off with a per-pitch FIFO (so retriggers and overlaps pair
 * correctly), sorts by onset — stably, keeping file order within a chord —
 * and trims each note at the next distinct onset. Unmatched note-ons are
 * dropped rather than guessed.
 */
export function pairNotes(events: MIDIEvent[]): RawNote[] {
  const open = new Map<number, number[]>();
  const notes: RawNote[] = [];
  for (const e of events) {
    if (e.kind === EventKind.NoteOn) {
      const q = open.get(e.note) ?? [];
      q.push(e.tick);
      open.set(e.note, q);
    } else if (e.kind === EventKind.NoteOff) {
      const q = open.get(e.note);
      if (!q || q.length === 0) continue;
      const start = q.shift()!;
      if (e.tick > start) notes.push({ startTick: start, endTick: e.tick, pitch: e.note });
    }
  }
  notes.sort((a, b) => a.startTick - b.startTick);
  for (let i = 0; i < notes.length - 1; i++) {
    const next = notes[i + 1];
    if (next.startTick <= notes[i].startTick) continue; // a chord: leave fully overlapping
    if (notes[i].endTick > next.startTick) notes[i].endTick = next.startTick;
  }
  return notes;
}
