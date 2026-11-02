import { toFloat } from "../../domain/rational";
import { EVENT_NOTE, type ScoreEvent } from "../../domain/types";

// Beaming for transcribed voices: within a beat (a dotted quarter in
// compound time); in 4/4 two beats of plain eighths beam as a group of
// four. Rests break beams; 16ths get a second level with hooks.

const beamable = (e: ScoreEvent) => e.Kind === EVENT_NOTE && (e.NoteType === "eighth" || e.NoteType === "16th");
const isSixteenth = (e: ScoreEvent) => e.NoteType === "16th";
const isPlainEighth = (e: ScoreEvent) => e.Kind === EVENT_NOTE && e.NoteType === "eighth" && e.Dots === 0 && !e.TimeModification;

export function applyBeams(events: ScoreEvent[], beats: number, beatType: number): ScoreEvent[] {
  const out = events.map((e) => ({ ...e }));
  const base = out.flatMap((e, i) => (e.Chord ? [] : [i]));
  const beatLen = beatType === 8 && beats % 3 === 0 && beats > 3 ? 1.5 : 4 / beatType;
  let groupOf = (start: number) => Math.trunc(start / beatLen + 1e-9);
  if (beats === 4 && beatType === 4) {
    const plain = new Map<number, boolean>([
      [0, true],
      [1, true],
    ]);
    for (const i of base) if (!isPlainEighth(out[i])) plain.set(Math.trunc(toFloat(out[i].Start) / 2), false);
    groupOf = (start: number) => {
      const half = Math.trunc(start / 2);
      return plain.get(half) ? 100 + half : Math.trunc(start / beatLen + 1e-9);
    };
  }
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 2) setBeams(out, run);
    run = [];
  };
  let prevGroup = -1;
  for (const i of base) {
    const e = out[i];
    const g = groupOf(toFloat(e.Start));
    if (!beamable(e) || g !== prevGroup) flush();
    if (beamable(e)) run.push(i);
    prevGroup = g;
  }
  flush();
  return out;
}

function setBeams(out: ScoreEvent[], run: number[]) {
  run.forEach((i, k) => {
    const beams = [k === 0 ? "begin" : k === run.length - 1 ? "end" : "continue"];
    if (isSixteenth(out[i])) {
      const prev = k > 0 && isSixteenth(out[run[k - 1]]);
      const next = k < run.length - 1 && isSixteenth(out[run[k + 1]]);
      beams.push(prev && next ? "continue" : next ? "begin" : prev ? "end" : k === 0 ? "forward hook" : "backward hook");
    }
    out[i].Beams = beams;
  });
}
