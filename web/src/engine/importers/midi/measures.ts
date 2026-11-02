import { newID } from "../../domain/ids";
import { rat } from "../../domain/rational";
import { EVENT_NOTE, EVENT_REST, type ClefSpec, type Measure, type MeasureAttributes, type Pitch, type ScoreEvent } from "../../domain/types";
import { applyBeams } from "./beams";
import { Speller, type Key } from "./key";
import { beatTicks, detectTriplets, quantizeTick, segments, shapes, type Layout, type Shape, TripletSet } from "./layout";
import type { RawNote } from "./notes";
import { EventKind, MIDIError, type MIDIFile } from "./smf";
import { asDrumNotes, blockChords, drumLengths, type LaneSpec, type QNote } from "./voicing";

export interface MeasureInfo {
  startTick: number;
  endTick: number;
  num: number;
  den: number;
}

/** Guards the browser against absurdly long (malformed) files. */
const MAX_MEASURES = 20000;

export function collectTimeSignatures(file: MIDIFile): { tick: number; num: number; den: number }[] {
  const out = file.tracks.flatMap((tr) => tr.events.filter((e) => e.kind === EventKind.TimeSignature).map((e) => ({ tick: e.tick, num: e.timeSigNum, den: e.timeSigDen })));
  return out.sort((a, b) => a.tick - b.tick);
}

export function computeMeasureBoundaries(timeSigs: { tick: number; num: number; den: number }[], totalTicks: number, division: number): MeasureInfo[] {
  let num = 4;
  let den = 4;
  let idx = 0;
  if (timeSigs.length > 0 && timeSigs[0].tick === 0) {
    ({ num, den } = timeSigs[0]);
    idx++;
  }
  const measures: MeasureInfo[] = [];
  for (let tick = 0; ; ) {
    while (idx < timeSigs.length && timeSigs[idx].tick <= tick) {
      ({ num, den } = timeSigs[idx]);
      idx++;
    }
    const beat = Math.trunc((division * 4) / den);
    let measureTicks = num * beat;
    if (measureTicks <= 0) measureTicks = division * 4;
    const end = tick + measureTicks;
    measures.push({ startTick: tick, endTick: end, num, den });
    if (measures.length > MAX_MEASURES) throw new MIDIError("midi: file is too long to transcribe");
    tick = end;
    if (tick >= totalTicks) break;
  }
  return measures;
}

interface Placed extends Shape {
  measureIdx: number;
}

function splitAcrossMeasures(start: number, end: number, measures: MeasureInfo[], l: Layout, staff: number): Placed[] {
  const out: Placed[] = [];
  measures.forEach((info, mi) => {
    if (end <= info.startTick || start >= info.endTick) return;
    const clipStart = Math.max(start, info.startTick) - info.startTick;
    const clipEnd = Math.min(end, info.endTick) - info.startTick;
    if (clipEnd <= clipStart) return;
    for (const seg of segments(l, staff, mi, info, clipStart, clipEnd)) for (const sh of shapes(l, seg)) out.push({ ...sh, measureIdx: mi });
  });
  return out;
}

interface Draft {
  offsetTicks: number;
  durationTicks: number;
  noteType: string;
  dots: number;
  pitch: Pitch | null;
  tieStart: boolean;
  tieStop: boolean;
  triplet: boolean;
}

export function buildMeasures(
  laneNotes: Map<number, RawNote[]>,
  lanes: Map<number, LaneSpec> | null,
  clefs: ClefSpec[] | null,
  measures: MeasureInfo[],
  gridTicks: number,
  division: number,
  key: Key | null,
): Measure[] {
  const speller = new Speller(key ?? { fifths: 0, minor: false });
  const sixteenthTicks = Math.trunc(division / 4);
  const l: Layout = { division, sixteenthTicks, tripletTicks: 0, triplets: new TripletSet() };
  if (division % 3 === 0 && gridTicks <= sixteenthTicks) l.tripletTicks = Math.trunc(division / 3);
  l.triplets = detectTriplets(laneNotes, measures, l, gridTicks);

  const buckets = new Map<string, Draft[]>();
  const laneIDs = [...laneNotes.keys()].sort((a, b) => a - b);
  const spec = (id: number): LaneSpec => lanes?.get(id) ?? { staff: id, voice: 1, stem: "", drums: false };

  for (const lane of laneIDs) {
    let quantized: QNote[] = laneNotes.get(lane)!.map((n) => {
      const qs = quantizeTick(l, n.startTick, lane, measures, gridTicks, false);
      let qe = quantizeTick(l, n.endTick, lane, measures, gridTicks, true);
      if (qe <= qs) qe = qs + (l.tripletTicks > 0 && qs % gridTicks !== 0 ? l.tripletTicks : gridTicks);
      return { start: qs, end: qe, pitch: n.pitch, tieStart: false, tieStop: false };
    });
    if (spec(lane).drums) quantized = drumLengths(quantized, division, gridTicks);
    for (const n of blockChords(quantized)) {
      let pieces = splitAcrossMeasures(n.start, n.end, measures, l, lane);
      let { tieStart, tieStop } = n;
      if (spec(lane).drums && pieces.length > 1) {
        // A drum hit isn't sustained: keep the first piece, never tie.
        pieces = pieces.slice(0, 1);
        tieStart = tieStop = false;
      }
      const pitch = speller.spell(n.pitch);
      pieces.forEach((p, i) => {
        const k = `${p.measureIdx}/${lane}`;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k)!.push({
          offsetTicks: p.offset,
          durationTicks: p.length,
          noteType: p.noteType,
          dots: p.dots,
          pitch,
          tieStart: i < pieces.length - 1 || tieStart,
          tieStop: i > 0 || tieStop,
          triplet: p.triplet,
        });
      });
    }
  }
  for (const drafts of buckets.values()) drafts.sort((a, b) => a.offsetTicks - b.offsetTicks);

  const physical = [...new Set(laneIDs.map((id) => spec(id).staff))].sort((a, b) => a - b);
  return measures.map((info, mi) => {
    const measure: Measure = {
      ID: newID(),
      Index: mi,
      Number: String(mi + 1),
      Implicit: false,
      AttributeChanges: null,
      Voices: null,
      Harmonies: null,
      Directions: null,
      Barlines: null,
      Navigation: {},
    };
    if (mi === 0) {
      const attrs: MeasureAttributes = {
        Divisions: 0,
        Key: key ? { Fifths: key.fifths } : null,
        Time: { Beats: info.num, BeatType: info.den },
        Clefs: clefs && clefs.length ? clefs : defaultClefs(physical),
        StaffCount: physical.length,
        Transpose: null,
      };
      measure.AttributeChanges = [attrs];
    }
    const measureTicks = info.endTick - info.startTick;
    const voices = [];
    for (const id of laneIDs) {
      const ls = spec(id);
      const drafts = fillRests(buckets.get(`${mi}/${id}`) ?? [], measureTicks, (offset, length) => restDrafts(l, id, mi, info, offset, length));
      if (drafts.length === 0) continue;
      let events = draftsToEvents(drafts, division, ls.staff, ls.voice);
      const bt = beatTicks(l, info);
      if (bt > 0) markTuplets(events, drafts, bt);
      if (ls.drums) events = asDrumNotes(events, ls.stem);
      events = applyBeams(events, info.num, info.den);
      voices.push({ ID: newID(), Staff: ls.staff, Number: ls.voice, Events: events });
    }
    measure.Voices = voices.length ? voices : null;
    return measure;
  });
}

function fillRests(notes: Draft[], measureTicks: number, rests: (offset: number, length: number) => Draft[]): Draft[] {
  const out: Draft[] = [];
  let cursor = 0;
  let lastOffset = -1;
  for (const n of notes) {
    if (n.offsetTicks > cursor) {
      out.push(...rests(cursor, n.offsetTicks - cursor));
      cursor = n.offsetTicks;
    }
    out.push(n);
    if (n.offsetTicks !== lastOffset) cursor = Math.max(cursor, n.offsetTicks + n.durationTicks);
    lastOffset = n.offsetTicks;
  }
  if (cursor < measureTicks) out.push(...rests(cursor, measureTicks - cursor));
  return out;
}

function restDrafts(l: Layout, lane: number, mi: number, m: MeasureInfo, offset: number, length: number): Draft[] {
  const out: Draft[] = [];
  for (const seg of segments(l, lane, mi, m, offset, offset + length)) {
    if (!seg.triplet && seg.length < l.sixteenthTicks) continue; // sub-grid slivers can't be notated
    for (const sh of shapes(l, seg)) {
      out.push({ offsetTicks: sh.offset, durationTicks: sh.length, noteType: sh.noteType, dots: sh.dots, pitch: null, tieStart: false, tieStop: false, triplet: sh.triplet });
    }
  }
  return out;
}

function draftsToEvents(drafts: Draft[], division: number, staff: number, voice: number): ScoreEvent[] {
  const seen = new Set<number>();
  return drafts.map((d) => {
    const ev: ScoreEvent = {
      ID: newID(),
      Kind: EVENT_REST,
      Start: rat(d.offsetTicks, division),
      Duration: rat(d.durationTicks, division),
      NoteType: d.noteType,
      Dots: d.dots,
      Chord: false,
      Pitch: null,
      ConcertPitch: null,
      Stem: "",
      Beams: null,
      TieStart: d.tieStart,
      TieStop: d.tieStop,
      Accidental: "",
      Voice: voice,
      Staff: staff,
      Percussion: false,
    };
    if (d.pitch) {
      ev.Kind = EVENT_NOTE;
      ev.Pitch = { ...d.pitch };
      ev.ConcertPitch = { ...d.pitch };
      if (seen.has(d.offsetTicks)) ev.Chord = true;
      seen.add(d.offsetTicks);
    }
    return ev;
  });
}

/** 3:2 time modification on triplets; a bracket over each triplet beat. */
function markTuplets(events: ScoreEvent[], drafts: Draft[], bt: number): void {
  let group: number[] = [];
  const flush = () => {
    if (group.length === 0) return;
    const first = group[0];
    const last = group[group.length - 1];
    events[first].Notations = { Tuplets: [{ Type: "start", Number: 1 }] };
    if (last === first) events[last].Notations!.Tuplets!.push({ Type: "stop", Number: 1 });
    else events[last].Notations = { Tuplets: [{ Type: "stop", Number: 1 }] };
    group = [];
  };
  let prevBeat = -1;
  drafts.forEach((d, i) => {
    if (!d.triplet) {
      flush();
      prevBeat = -1;
      return;
    }
    events[i].TimeModification = { Actual: 3, Normal: 2 };
    if (events[i].Chord) return;
    const beat = Math.floor(d.offsetTicks / bt);
    if (beat !== prevBeat) {
      flush();
      prevBeat = beat;
    }
    group.push(i);
  });
  flush();
}

function defaultClefs(staffs: number[]): ClefSpec[] {
  return staffs.map((s) => (s === 2 ? { Staff: s, Sign: "F", Line: 4 } : { Staff: s, Sign: "G", Line: 2 }));
}
