import { midiNote } from "../domain/pitch";
import { toFloat } from "../domain/rational";
import { EVENT_NOTE, effectiveAttributes, hasArticulation, type CanonicalScore, type Measure, type Notations, type Part } from "../domain/types";
import { measureCount, performanceOrder } from "./order";

// The absolute-time playback timeline (APP_DESIGN.md §7.6 FR-PLAY-002): notes
// in performance order, tempo from any part's metronome marks, tie chains
// sounding once, dynamics and articulations shaping velocity and length.
// JSON shape matches the Go Plan.

export const DEFAULT_TEMPO_BPM = 120;

export interface PlanEvent {
  partId: string;
  staff: number;
  startSeconds: number;
  durationSeconds: number;
  midiNote: number;
  velocity: number;
  measureIndex: number;
}

export interface MeasureTiming {
  index: number;
  number: string;
  startSeconds: number;
  endSeconds: number;
}

export interface Click {
  seconds: number;
  accent?: boolean;
}

export interface Plan {
  events: PlanEvent[] | null;
  measures: MeasureTiming[] | null;
  clicks: Click[] | null;
  totalSeconds: number;
}

interface TempoSegment {
  startQuarter: number;
  secondsPerBeat: number;
}

const TIE_EPSILON = 1e-6;

export function generatePlan(score: CanonicalScore): Plan {
  const plan: Plan = { events: null, measures: null, clicks: null, totalSeconds: 0 };
  const parts = score.Parts ?? [];
  if (parts.length === 0) return plan;
  const order = performanceOrder(score);
  const lengths = scoreMeasureLengths(score);
  const beats = beatLengths(parts[0]);
  const marks = tempoMarks(score);

  const starts: number[] = [];
  const segments: TempoSegment[] = [{ startQuarter: 0, secondsPerBeat: 60 / DEFAULT_TEMPO_BPM }];
  let quarter = 0;
  order.forEach((mi, k) => {
    starts[k] = quarter;
    for (const t of marks[mi]) segments.push({ startQuarter: quarter + t.offset, secondsPerBeat: 60 / t.bpm });
    quarter += lengths[mi];
  });
  segments.sort((a, b) => a.startQuarter - b.startQuarter);

  const clicks: Click[] = [];
  const measures: MeasureTiming[] = [];
  const first = parts[0].Measures ?? [];
  order.forEach((mi, k) => {
    const end = starts[k] + lengths[mi];
    appendClicks(clicks, starts[k], end, beats[mi], segments);
    const timing: MeasureTiming = { index: mi, number: "", startSeconds: quarterToSeconds(starts[k], segments), endSeconds: quarterToSeconds(end, segments) };
    if (mi < first.length) {
      timing.index = first[mi].Index;
      timing.number = first[mi].Number;
    }
    measures.push(timing);
  });

  const events: PlanEvent[] = [];
  for (const part of parts) {
    for (const n of partNotes(part, order, starts)) {
      const startSec = quarterToSeconds(n.start, segments);
      events.push({
        partId: part.ID,
        staff: n.staff,
        startSeconds: startSec,
        durationSeconds: quarterToSeconds(n.end, segments) - startSec,
        midiNote: n.midi,
        velocity: n.velocity,
        measureIndex: n.measureIndex,
      });
    }
  }
  events.sort((a, b) => a.startSeconds - b.startSeconds);
  plan.events = events.length ? events : null;
  plan.measures = measures.length ? measures : null;
  plan.clicks = clicks.length ? clicks : null;
  plan.totalSeconds = quarterToSeconds(quarter, segments);
  return plan;
}

interface Sounding {
  start: number;
  end: number;
  staff: number;
  midi: number;
  velocity: number;
  measureIndex: number;
}

function partNotes(part: Part, order: number[], starts: number[]): Sounding[] {
  const notes: Sounding[] = [];
  const pending = new Map<string, number>();
  const dyn = new DynamicsTracker();
  const measures = part.Measures ?? [];
  order.forEach((mi, k) => {
    if (mi >= measures.length) return;
    const measure = measures[mi];
    const marks = measureDynamics(measure);
    for (const voice of measure.Voices ?? []) {
      for (const ev of voice.Events ?? []) {
        if (ev.Kind !== EVENT_NOTE || !ev.Pitch) continue;
        const pitch = ev.ConcertPitch ?? ev.Pitch;
        const offset = toFloat(ev.Start);
        const start = starts[k] + offset;
        const end = start + toFloat(ev.Duration);
        const midi = midiNote(pitch);
        const id = `${ev.Staff}/${midi}`;
        const i = pending.get(id);
        if (i !== undefined && ev.TieStop && Math.abs(notes[i].end - start) < TIE_EPSILON) {
          const [, tail] = articulate(ev.Notations, 0, end - start); // staccato on the chain's last note
          notes[i].end = start + tail;
        } else {
          let [velocity, length] = articulate(ev.Notations, dyn.velocityAt(marks, offset), end - start);
          if (ev.TieStart) length = end - start; // staccato applies to a tie chain's last note only
          notes.push({ start, end: start + length, staff: ev.Staff, midi, velocity, measureIndex: measure.Index });
          pending.set(id, notes.length - 1);
        }
        if (!ev.TieStart) pending.delete(id);
      }
    }
    dyn.advance(marks);
  });
  return notes;
}

interface TempoMark {
  offset: number;
  bpm: number;
}

function tempoMarks(score: CanonicalScore): TempoMark[][] {
  const out: TempoMark[][] = Array.from({ length: measureCount(score) }, () => []);
  for (const part of score.Parts ?? []) {
    (part.Measures ?? []).forEach((m, mi) => {
      for (const d of m.Directions ?? []) {
        if (d.Type !== "metronome" || d.PerMinute <= 0) continue;
        const offset = toFloat(d.Start);
        if (!out[mi].some((x) => Math.abs(x.offset - offset) < TIE_EPSILON)) out[mi].push({ offset, bpm: d.PerMinute });
      }
    });
  }
  for (const ms of out) ms.sort((a, b) => a.offset - b.offset);
  return out;
}

function scoreMeasureLengths(score: CanonicalScore): number[] {
  const parts = score.Parts ?? [];
  const firstMeasures = parts[0].Measures ?? [];
  const sig = measureLengths(firstMeasures);
  const out: number[] = [];
  for (let mi = 0; mi < measureCount(score); mi++) {
    out[mi] = mi < sig.length ? sig[mi] : mi > 0 ? out[mi - 1] : 4;
    if (mi >= firstMeasures.length || !firstMeasures[mi].Implicit) continue;
    const extent = notesExtent(score, mi);
    if (extent > 0) out[mi] = extent;
  }
  return out;
}

function notesExtent(score: CanonicalScore, mi: number): number {
  let extent = 0;
  for (const part of score.Parts ?? []) {
    const m = (part.Measures ?? [])[mi];
    if (!m) continue;
    for (const v of m.Voices ?? []) for (const ev of v.Events ?? []) extent = Math.max(extent, toFloat(ev.Start) + toFloat(ev.Duration));
  }
  return extent;
}

function measureLengths(measures: Measure[]): number[] {
  let current = 4;
  return measures.map((m) => {
    const t = effectiveAttributes(m).Time;
    if (t && t.BeatType > 0) current = (t.Beats * 4) / t.BeatType;
    return current;
  });
}

function beatLengths(part: Part): number[] {
  let current = 1;
  return (part.Measures ?? []).map((m) => {
    const t = effectiveAttributes(m).Time;
    if (t && t.BeatType > 0) current = 4 / t.BeatType;
    return current;
  });
}

function appendClicks(clicks: Click[], start: number, end: number, beat: number, segments: TempoSegment[]): void {
  const epsilon = 1e-9;
  for (let q = start, n = 0; q < end - epsilon; n++, q = start + n * beat) {
    const c: Click = { seconds: quarterToSeconds(q, segments) };
    if (n === 0) c.accent = true;
    clicks.push(c);
  }
}

function quarterToSeconds(position: number, segments: TempoSegment[]): number {
  if (position <= 0 || segments.length === 0) return 0;
  let seconds = 0;
  segments.forEach((seg, i) => {
    let segEnd = i + 1 < segments.length ? segments[i + 1].startQuarter : position;
    if (segEnd > position) segEnd = position;
    if (segEnd <= seg.startQuarter) return;
    seconds += (segEnd - seg.startQuarter) * seg.secondsPerBeat;
  });
  return seconds;
}

// ---- dynamics and articulation ----

const DEFAULT_VELOCITY = 80;
const LEVEL: Record<string, number> = { pppp: 22, ppp: 30, pp: 40, p: 52, mp: 64, mf: 76, f: 90, ff: 104, fff: 116, ffff: 124 };
const ACCENT: Record<string, number> = { sf: 112, sfz: 112, sffz: 120, fz: 112, rf: 104, rfz: 104, fp: 100, sfp: 112, sfpp: 112 };
const AFTER_ACCENT: Record<string, string> = { fp: "p", sfp: "p", sfpp: "pp" };

interface DynamicMark {
  offset: number;
  name: string;
}

function measureDynamics(m: Measure): DynamicMark[] {
  return (m.Directions ?? [])
    .filter((d) => d.Type === "dynamics")
    .map((d) => ({ offset: toFloat(d.Start), name: d.Text }))
    .sort((a, b) => a.offset - b.offset);
}

class DynamicsTracker {
  level = DEFAULT_VELOCITY;

  velocityAt(marks: DynamicMark[], offset: number): number {
    let v = this.level;
    for (const m of marks) {
      if (m.offset > offset + TIE_EPSILON) break;
      if (Object.hasOwn(LEVEL, m.name)) {
        v = LEVEL[m.name];
        continue;
      }
      if (Object.hasOwn(ACCENT, m.name)) {
        if (m.offset > offset - TIE_EPSILON) return ACCENT[m.name];
        if (Object.hasOwn(AFTER_ACCENT, m.name)) v = LEVEL[AFTER_ACCENT[m.name]];
      }
    }
    return v;
  }

  advance(marks: DynamicMark[]): void {
    for (const m of marks) {
      if (Object.hasOwn(LEVEL, m.name)) this.level = LEVEL[m.name];
      else if (Object.hasOwn(AFTER_ACCENT, m.name)) this.level = LEVEL[AFTER_ACCENT[m.name]];
    }
  }
}

function articulate(n: Notations | undefined, velocity: number, length: number): [number, number] {
  if (hasArticulation(n, "strong-accent")) velocity += 22;
  else if (hasArticulation(n, "accent")) velocity += 15;
  if (hasArticulation(n, "staccatissimo") || hasArticulation(n, "spiccato")) length *= 0.3;
  else if (hasArticulation(n, "staccato")) length *= 0.5;
  return [Math.min(velocity, 127), length];
}
