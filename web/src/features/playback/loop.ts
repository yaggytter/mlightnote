import type { MeasureTiming } from "../../services/api/playback";
import type { LoopRange } from "../../services/audio/AudioEngine";

/** An A-B loop in measures (positions in the plan's measure list), inclusive. */
export interface LoopState {
  a: number | null;
  b: number | null;
  enabled: boolean;
}

export const NO_LOOP: LoopState = { a: null, b: null, enabled: false };

function ordered(a: number, b: number): Pick<LoopState, "a" | "b"> {
  return a <= b ? { a, b } : { a: b, b: a };
}

/** Sets A at the given measure; B moves along if it would end up before A. */
export function setLoopStart(loop: LoopState, measure: number): LoopState {
  const b = loop.b === null || loop.b < measure ? measure : loop.b;
  return { a: measure, b, enabled: true };
}

/** Sets B at the given measure; a B before A swaps the two. */
export function setLoopEnd(loop: LoopState, measure: number): LoopState {
  return { ...ordered(loop.a ?? measure, measure), enabled: true };
}

/** `L`: turns the loop on/off; with no range yet, loops the current measure. */
export function toggleLoop(loop: LoopState, measure: number): LoopState {
  if (loop.a === null) return { a: measure, b: measure, enabled: true };
  return { ...loop, enabled: !loop.enabled };
}

/** The engine's loop range in seconds, or null when the loop is off. */
export function loopRange(loop: LoopState, measures: MeasureTiming[]): LoopRange | null {
  if (!loop.enabled || loop.a === null || loop.b === null) return null;
  const start = measures[loop.a];
  const end = measures[loop.b];
  if (!start || !end) return null;
  return { startSeconds: start.startSeconds, endSeconds: end.endSeconds };
}

export function loopLabel(loop: LoopState, measures: MeasureTiming[]): string | null {
  if (loop.a === null || loop.b === null) return null;
  const a = measures[loop.a]?.number ?? String(loop.a + 1);
  const b = measures[loop.b]?.number ?? String(loop.b + 1);
  return a === b ? `${a}小節` : `${a}–${b}小節`;
}
