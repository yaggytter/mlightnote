// A small text notation for the built-in sample songs (APP_DESIGN.md §7.1).
// One token is "<pitches>:<duration>":
//   pitches   "r" (a rest), "C4", "F#5", "Bb3", or a chord "G3+B3+D4"
//   duration  w h q e s (whole, half, quarter, eighth, 16th), "." = dotted
// e.g. "D5:q G4:e A4:e B4:e C5:e" is one 3/4 measure.

/** Ticks per quarter note in the generated MIDI. */
export const TICKS_PER_QUARTER = 480;

const DURATION_QUARTERS: Record<string, number> = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };
const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const PITCH_PATTERN = /^([A-G])(#|b)?(-?\d)$/;
const DURATION_PATTERN = /^([whqes])(\.?)$/;

export interface NoteToken {
  /** MIDI note numbers; empty for a rest. */
  pitches: number[];
  ticks: number;
}

/** MIDI note number of "C4" (= 60), "F#5", "Bb3"… */
export function midiPitch(name: string): number {
  const m = PITCH_PATTERN.exec(name);
  if (!m) throw new Error(`音名を読めません: ${name}`);
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  const pitch = (Number(m[3]) + 1) * 12 + STEP_SEMITONES[m[1]] + accidental;
  if (pitch < 0 || pitch > 127) throw new Error(`MIDI の音域外です: ${name}`);
  return pitch;
}

function durationTicks(text: string): number {
  const m = DURATION_PATTERN.exec(text);
  if (!m) throw new Error(`音価を読めません: ${text}`);
  const quarters = DURATION_QUARTERS[m[1]] * (m[2] ? 1.5 : 1);
  return Math.round(quarters * TICKS_PER_QUARTER);
}

/** Parses one token, e.g. "G3+B3+D4:h". */
export function parseToken(token: string): NoteToken {
  const [pitchText, durationText, extra] = token.split(":");
  if (!pitchText || !durationText || extra !== undefined) throw new Error(`書式が違います: ${token}`);
  const pitches = pitchText === "r" ? [] : pitchText.split("+").map(midiPitch);
  return { pitches, ticks: durationTicks(durationText) };
}

/** Parses a measure (tokens separated by spaces). */
export function parseMeasure(measure: string): NoteToken[] {
  return measure.trim().split(/\s+/).filter(Boolean).map(parseToken);
}

/** Ticks of one measure in the given time signature. */
export function measureTicks(beats: number, beatType: number): number {
  return (beats * 4 * TICKS_PER_QUARTER) / beatType;
}
