import { newID } from "../../domain/ids";
import { rat } from "../../domain/rational";
import { emptyInstrument, emptyMetadata, type CanonicalScore, type ClefSpec, type ImportReport, type ImportWarning, type InstrumentDefinition, type Part } from "../../domain/types";
import { GM_PROGRAM_NAMES } from "../../../shared/gm";
import { detectKey, type Key } from "./key";
import { buildMeasures, collectTimeSignatures, computeMeasureBoundaries, type MeasureInfo } from "./measures";
import { pairNotes, type RawNote } from "./notes";
import { EventKind, MIDIError, type MIDIEvent, type MIDIFile } from "./smf";
import { DRUM_LANES, splitDrumLanes, type LaneSpec } from "./voicing";

// SMF → canonical score (port of Go importers/midi Transcribe). The order
// of newID() calls matches Go exactly so golden IDs line up.

/** The notated grid: 16 = sixteenth notes. */
const QUANTIZE_DIVISION = 16;
const PERCUSSION_CHANNEL = 9;
const MIDDLE_C = 60;
const BASS_CLEF_MEDIAN = 55;
const GRAND_STAFF_LOW = 55;
const GRAND_STAFF_HIGH = 67;
const PIANO_PROGRAM_MAX = 7;

interface Source {
  track: number;
  channel: number;
  program: number;
  notes: RawNote[];
}

const isPercussion = (s: Source) => s.channel === PERCUSSION_CHANNEL;

function info(message: string, element = ""): ImportWarning {
  return { Severity: "info", Code: "INFERRED", Message: message, PartID: "", MeasureIndex: 0, Element: element };
}

export function transcribe(file: MIDIFile): { score: CanonicalScore; report: ImportReport } {
  const gridTicks = Math.trunc((file.division * 4) / QUANTIZE_DIVISION);
  if (gridTicks <= 0) throw new MIDIError(`midi: quantize division ${QUANTIZE_DIVISION} is finer than the file's PPQ resolution`);

  const boundaries = computeMeasureBoundaries(collectTimeSignatures(file), fileEndTick(file), file.division);
  const warnings: ImportWarning[] = [];
  const sources = noteSources(file);
  if (sources.length === 0) throw new MIDIError("midi: no note-on events found in any track");

  const allNotes = sources.filter((s) => !isPercussion(s)).flatMap((s) => s.notes);
  let key: Key | null = null;
  const detected = detectKey(file, allNotes);
  if (detected) {
    key = detected.key;
    if (!detected.declared) {
      const sign = key.fifths >= 0 ? `+${key.fifths}` : `${key.fifths}`;
      warnings.push(info(`MIDIに調号が無いため、音の分布から調を推定しました（調号 ${sign}、${key.minor ? "短調" : "長調"}）。`, "key"));
    }
  }

  const parts: Part[] = [];
  if (isTwoHandPiano(sources)) {
    const staves = new Map([
      [1, sources[0].notes],
      [2, sources[1].notes],
    ]);
    parts.push(buildPart(staves, null, null, sourceInstrument(sources[0]), "パート 1", boundaries, gridTicks, file.division, key));
    warnings.push(info("2つのトラックを大譜表（1パート2段）として統合しました。"));
  } else {
    const perTrack = sourcesPerTrack(sources);
    const names = uniqueNames(sources.map((s) => partName(file, s, perTrack)));
    sources.forEach((src, i) => {
      const { staves, lanes, clefs } = staffLayout(src);
      const partKey = isPercussion(src) ? null : key; // a drum staff carries no key signature
      parts.push(buildPart(staves, lanes, clefs, sourceInstrument(src), names[i], boundaries, gridTicks, file.division, partKey));
    });
    if (sources.length > 1 && perTrack.size < sources.length) {
      warnings.push(info(`1つのトラックに複数のチャンネルがあったため、チャンネルごとに${sources.length}パートへ分けました。`));
    }
  }

  for (const part of parts) addTempoDirections(part, file, boundaries);

  return {
    score: { Metadata: emptyMetadata(), PartGroups: null, Parts: parts },
    report: { Warnings: warnings.length ? warnings : null },
  };
}

/** Tempo meta events become metronome directions on every part. */
function addTempoDirections(part: Part, file: MIDIFile, measures: MeasureInfo[]): void {
  const partMeasures = part.Measures ?? [];
  for (const tr of file.tracks) {
    for (const e of tr.events) {
      if (e.kind !== EventKind.Tempo || e.tempoUSPQ <= 0) continue;
      const mi = measures.findIndex((m) => e.tick >= m.startTick && e.tick < m.endTick);
      if (mi < 0 || mi >= partMeasures.length) continue;
      const bpm = 60_000_000 / e.tempoUSPQ;
      const m = partMeasures[mi];
      m.Directions = [
        ...(m.Directions ?? []),
        {
          ID: newID(),
          Start: rat(e.tick - measures[mi].startTick, file.division),
          Staff: 1,
          Type: "metronome",
          Text: "",
          Placement: "above",
          BeatUnit: "quarter",
          PerMinute: Math.trunc(bpm * 100 + 0.5) / 100,
        },
      ];
    }
  }
}

function fileEndTick(file: MIDIFile): number {
  let max = 0;
  for (const tr of file.tracks) for (const e of tr.events) if (e.tick > max) max = e.tick;
  return max;
}

/** Every (track, channel) with notes, in track then channel order. */
function noteSources(file: MIDIFile): Source[] {
  const out: Source[] = [];
  file.tracks.forEach((tr, ti) => {
    const byChannel = new Map<number, MIDIEvent[]>();
    const program = new Map<number, number>();
    for (const e of tr.events) {
      if (e.kind === EventKind.NoteOn || e.kind === EventKind.NoteOff) {
        if (!byChannel.has(e.channel)) byChannel.set(e.channel, []);
        byChannel.get(e.channel)!.push(e);
      } else if (e.kind === EventKind.ProgramChange && !program.has(e.channel)) {
        program.set(e.channel, e.program);
      }
    }
    for (const ch of [...byChannel.keys()].sort((a, b) => a - b)) {
      const notes = pairNotes(byChannel.get(ch)!);
      if (notes.length > 0) out.push({ track: ti, channel: ch, program: program.get(ch) ?? 0, notes });
    }
  });
  return out;
}

function sourcesPerTrack(sources: Source[]): Map<number, number> {
  const n = new Map<number, number>();
  for (const s of sources) n.set(s.track, (n.get(s.track) ?? 0) + 1);
  return n;
}

function trackName(events: MIDIEvent[]): string {
  return events.find((e) => e.kind === EventKind.TrackName && e.text !== "")?.text ?? "";
}

function programName(program: number): string {
  return GM_PROGRAM_NAMES[program] ?? GM_PROGRAM_NAMES[0];
}

function partName(file: MIDIFile, s: Source, perTrack: Map<number, number>): string {
  if (perTrack.get(s.track) === 1) {
    const name = trackName(file.tracks[s.track].events);
    if (name !== "") return name;
  }
  return isPercussion(s) ? "ドラム" : programName(s.program);
}

function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    return count > 1 ? `${n} ${count}` : n;
  });
}

interface StaffLayout {
  staves: Map<number, RawNote[]>;
  lanes: Map<number, LaneSpec> | null;
  clefs: ClefSpec[];
}

/** A piano spanning both registers gets a grand staff; otherwise one staff. */
function staffLayout(s: Source): StaffLayout {
  if (isPercussion(s)) return { staves: splitDrumLanes(s.notes), lanes: DRUM_LANES, clefs: [{ Staff: 1, Sign: "percussion", Line: 2 }] };
  const low = s.notes.some((n) => n.pitch < GRAND_STAFF_LOW);
  const high = s.notes.some((n) => n.pitch >= GRAND_STAFF_HIGH);
  if (s.program <= PIANO_PROGRAM_MAX && low && high) {
    const staves = new Map<number, RawNote[]>();
    for (const n of s.notes) {
      const staff = n.pitch < MIDDLE_C ? 2 : 1;
      if (!staves.has(staff)) staves.set(staff, []);
      staves.get(staff)!.push(n);
    }
    return { staves, lanes: null, clefs: [{ Staff: 1, Sign: "G", Line: 2 }, { Staff: 2, Sign: "F", Line: 4 }] };
  }
  const pitches = s.notes.map((n) => n.pitch).sort((a, b) => a - b);
  const clef = pitches[Math.floor(pitches.length / 2)] < BASS_CLEF_MEDIAN ? { Staff: 1, Sign: "F", Line: 4 } : { Staff: 1, Sign: "G", Line: 2 };
  return { staves: new Map([[1, s.notes]]), lanes: null, clefs: [clef] };
}

function isTwoHandPiano(sources: Source[]): boolean {
  return sources.length === 2 && sources[0].track !== sources[1].track && !isPercussion(sources[0]) && !isPercussion(sources[1]);
}

function sourceInstrument(s: Source): InstrumentDefinition {
  return { ...emptyInstrument(newID()), MIDIChannel: s.channel, MIDIProgram: s.program, IsPercussion: isPercussion(s) };
}

function buildPart(
  staves: Map<number, RawNote[]>,
  lanes: Map<number, LaneSpec> | null,
  clefs: ClefSpec[] | null,
  inst: InstrumentDefinition,
  name: string,
  measures: MeasureInfo[],
  gridTicks: number,
  division: number,
  key: Key | null,
): Part {
  // Go evaluates the composite literal's ID before calling buildMeasures.
  const id = newID();
  return { ID: id, SourceID: "", Name: name, Abbreviation: "", Order: 0, Instrument: inst, Measures: buildMeasures(staves, lanes, clefs, measures, gridTicks, division, key) };
}
