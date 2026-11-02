import type { MeasureInfo } from "./measures";
import type { RawNote } from "./notes";

// Quantization grid, triplet detection, and the notatable shapes a span of
// ticks is written as.

/** The triplet grid must fit this many times better than straight. */
const TRIPLET_BIAS = 2;

export class TripletSet {
  private readonly beats = new Map<string, Set<number>>();
  has(staff: number, measure: number, beat: number): boolean {
    return this.beats.get(`${staff}/${measure}`)?.has(beat) ?? false;
  }
  mark(staff: number, measure: number, beat: number): void {
    const k = `${staff}/${measure}`;
    if (!this.beats.has(k)) this.beats.set(k, new Set());
    this.beats.get(k)!.add(beat);
  }
}

export interface Layout {
  division: number;
  sixteenthTicks: number;
  tripletTicks: number; // 0 when the resolution can't express a triplet eighth
  triplets: TripletSet;
}

export function beatTicks(l: Layout, m: MeasureInfo): number {
  return l.tripletTicks === 0 || m.den !== 4 ? 0 : l.division;
}

export function roundTo(t: number, grid: number): number {
  return Math.floor((t + Math.floor(grid / 2)) / grid) * grid;
}

export function measureIndexAt(measures: MeasureInfo[], tick: number): number {
  let lo = 0;
  let hi = measures.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (measures[mid].endTick > tick) hi = mid;
    else lo = mid + 1;
  }
  return lo < measures.length && tick >= measures[lo].startTick ? lo : -1;
}

export function detectTriplets(staffNotes: Map<number, RawNote[]>, measures: MeasureInfo[], l: Layout, gridTicks: number): TripletSet {
  const set = new TripletSet();
  if (l.tripletTicks === 0) return set;
  for (const [staff, notes] of staffNotes) {
    const errs = new Map<string, { mi: number; beat: number; straight: number; triplet: number; interior: number }>();
    for (const n of notes) {
      const mi = measureIndexAt(measures, n.startTick);
      if (mi < 0) continue;
      const bt = beatTicks(l, measures[mi]);
      if (bt === 0) continue;
      const rel = n.startTick - measures[mi].startTick;
      const beat = Math.floor(rel / bt);
      const k = `${mi}/${beat}`;
      if (!errs.has(k)) errs.set(k, { mi, beat, straight: 0, triplet: 0, interior: 0 });
      const a = errs.get(k)!;
      a.straight += Math.abs(rel - roundTo(rel, gridTicks));
      a.triplet += Math.abs(rel - roundTo(rel, l.tripletTicks));
      if (roundTo(rel, l.tripletTicks) % bt !== 0) a.interior++;
    }
    for (const a of errs.values()) {
      if (a.interior > 0 && a.straight > 0 && a.triplet * TRIPLET_BIAS < a.straight) set.mark(staff, a.mi, a.beat);
    }
  }
  return set;
}

/** Snaps a tick to the triplet grid inside a triplet beat, else to the straight grid. */
export function quantizeTick(l: Layout, tick: number, staff: number, measures: MeasureInfo[], gridTicks: number, atEnd: boolean): number {
  const probe = atEnd && tick > 0 ? tick - 1 : tick;
  const mi = measureIndexAt(measures, probe);
  if (mi >= 0) {
    const bt = beatTicks(l, measures[mi]);
    if (bt > 0 && l.triplets.has(staff, mi, Math.floor((probe - measures[mi].startTick) / bt))) return roundTo(tick, l.tripletTicks);
  }
  return roundTo(tick, gridTicks);
}

export interface Segment {
  offset: number;
  length: number;
  triplet: boolean;
}

export function segments(l: Layout, staff: number, mi: number, m: MeasureInfo, start: number, end: number): Segment[] {
  const bt = beatTicks(l, m);
  if (bt === 0) return [{ offset: start, length: end - start, triplet: false }];
  const out: Segment[] = [];
  for (let cur = start; cur < end; ) {
    const beat = Math.floor(cur / bt);
    if (l.triplets.has(staff, mi, beat)) {
      const segEnd = Math.min(end, (beat + 1) * bt);
      out.push({ offset: cur, length: segEnd - cur, triplet: true });
      cur = segEnd;
      continue;
    }
    let segEnd = end;
    for (let b = beat + 1; b * bt < end; b++) {
      if (l.triplets.has(staff, mi, b)) {
        segEnd = b * bt;
        break;
      }
    }
    out.push({ offset: cur, length: segEnd - cur, triplet: false });
    cur = segEnd;
  }
  return out;
}

export interface Shape {
  offset: number;
  length: number;
  noteType: string;
  dots: number;
  triplet: boolean;
}

const NOTATABLE_BASES = [16, 8, 4, 2, 1]; // whole … 16th, in sixteenths

/** Greedy (optionally dotted) notatable pieces for a length in sixteenths. */
export function decomposeDuration(sixteenths: number): { sixteenths: number; dots: number }[] {
  const pieces: { sixteenths: number; dots: number }[] = [];
  let remaining = sixteenths;
  while (remaining > 0) {
    const base = NOTATABLE_BASES.find((b) => b <= remaining) ?? 1;
    if (base % 2 === 0 && remaining >= base + base / 2) {
      pieces.push({ sixteenths: base, dots: 1 });
      remaining -= base + base / 2;
    } else {
      pieces.push({ sixteenths: base, dots: 0 });
      remaining -= base;
    }
  }
  return pieces.length ? pieces : [{ sixteenths: 1, dots: 0 }];
}

export function actualSixteenths(base: number, dots: number): number {
  return dots === 1 ? base + base / 2 : base;
}

export function noteTypeName(sixteenths: number): string {
  return { 16: "whole", 8: "half", 4: "quarter", 2: "eighth" }[sixteenths] ?? "16th";
}

/** Notatable fragments of a segment; a whole triplet beat is just a quarter. */
export function shapes(l: Layout, seg: Segment): Shape[] {
  const out: Shape[] = [];
  let cur = seg.offset;
  if (!seg.triplet) {
    for (const p of decomposeDuration(Math.max(Math.floor(seg.length / l.sixteenthTicks), 1))) {
      const length = actualSixteenths(p.sixteenths, p.dots) * l.sixteenthTicks;
      out.push({ offset: cur, length, noteType: noteTypeName(p.sixteenths), dots: p.dots, triplet: false });
      cur += length;
    }
    return out;
  }
  let units = Math.max(Math.floor(seg.length / l.tripletTicks), 1);
  if (units === 3) return [{ offset: cur, length: 3 * l.tripletTicks, noteType: "quarter", dots: 0, triplet: false }];
  while (units > 0) {
    const n = units >= 2 ? 2 : 1;
    out.push({ offset: cur, length: n * l.tripletTicks, noteType: n === 2 ? "quarter" : "eighth", dots: 0, triplet: true });
    cur += n * l.tripletTicks;
    units -= n;
  }
  return out;
}
