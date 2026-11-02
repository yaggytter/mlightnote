import { newID } from "../../domain/ids";
import { applyTranspose, NO_TRANSPOSE } from "../../domain/pitch";
import { add, fromDivisions, rat, type Rational } from "../../domain/rational";
import {
  EVENT_NOTE,
  EVENT_REST,
  emptyInstrument,
  emptyMetadata,
  isNavigationEmpty,
  type Barline,
  type CanonicalScore,
  type ClefSpec,
  type Direction,
  type Harmony,
  type ImportReport,
  type ImportWarning,
  type Measure,
  type MeasureAttributes,
  type Navigation,
  type Part,
  type PartGroup,
  type ScoreEvent,
  type Transpose,
  type Voice,
} from "../../domain/types";
import { attr, child, childNames, elements, floatChild, intChild, ownText, parseXML, text, type XElement } from "../../xml/tree";
import {
  BACKUP_ELEMENT,
  backupCursor,
  drumKeys,
  hasUnpitched,
  inferNavigation,
  mapBarline,
  mapNotations,
  mapUnpitched,
  mergeSound,
  readSound,
  renumberDuplicateMeasures,
  summarizeBackupRepairs,
} from "./helpers";

export class MusicXMLError extends Error {}

export interface ImportResult {
  score: CanonicalScore;
  report: ImportReport;
}

/**
 * Parses a score-partwise MusicXML document into the canonical score
 * model, with an import report of anything inferred or repaired. A port of
 * the Go importer; outputs are checked against its golden data.
 */
export function parseMusicXML(xmlText: string): ImportResult {
  let doc: XElement;
  try {
    doc = parseXML(xmlText);
  } catch (e) {
    throw new MusicXMLError(`musicxml: decode: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    return build(doc);
  } catch (e) {
    throw new MusicXMLError(`musicxml: decode: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function build(doc: XElement): ImportResult {
  const score: CanonicalScore = { Metadata: buildMetadata(doc), PartGroups: null, Parts: null };
  const warnings: ImportWarning[] = [];
  const partList = child(doc, "part-list");
  const scoreParts = elements(partList, "score-part");

  const nameByID = new Map<string, string>();
  const scorePartByID = new Map<string, XElement>();
  scoreParts.forEach((sp, i) => {
    const id = attr(sp, "id");
    scorePartByID.set(id, sp);
    let name = text(sp, "part-name");
    if (name === "") {
      name = `パート ${i + 1}`;
      warnings.push({ Severity: "info", Code: "INFERRED", Message: "part-name が空だったため、連番の仮名称を割り当てました。", PartID: id, MeasureIndex: 0, Element: "part-name" });
    }
    nameByID.set(id, name);
  });

  score.PartGroups = buildPartGroups(partList);

  const parts: Part[] = [];
  elements(doc, "part").forEach((px, order) => {
    const sp = scorePartByID.get(attr(px, "id"));
    const instruments = elements(sp, "midi-instrument");
    const [part, partWarnings] = buildPart(px, order, nameByID.get(attr(px, "id")) ?? "", drumKeys(instruments));
    part.Abbreviation = text(sp, "part-abbreviation");
    if (instruments.length > 0) {
      const program = intChild(instruments[0], "midi-program");
      const channel = intChild(instruments[0], "midi-channel");
      if (program >= 1 && program <= 128) part.Instrument.MIDIProgram = program - 1; // MusicXML is 1-based
      if (channel >= 1 && channel <= 16) {
        part.Instrument.MIDIChannel = channel - 1;
        part.Instrument.IsPercussion = channel === 10;
      }
    }
    part.Instrument.IsPercussion = part.Instrument.IsPercussion || hasUnpitched(part);
    parts.push(part);
    warnings.push(...partWarnings);
  });
  score.Parts = parts.length ? parts : null;

  const renumbered = renumberDuplicateMeasures(parts);
  if (renumbered) {
    score.Parts = renumbered;
    warnings.push({ Severity: "info", Code: "INFERRED", Message: "小節番号が重複していたため、先頭から順に振り直しました。", PartID: "", MeasureIndex: 0, Element: "measure/@number" });
  }
  return { score, report: { Warnings: warnings.length ? warnings : null } };
}

function buildMetadata(doc: XElement): CanonicalScore["Metadata"] {
  const meta = emptyMetadata();
  const identification = child(doc, "identification");
  const encoding = child(identification, "encoding");
  meta.Title = text(child(doc, "work"), "work-title");
  meta.Movement = text(doc, "movement-title");
  meta.Copyright = text(identification, "rights");
  meta.Software = text(encoding, "software");
  meta.EncodingDate = text(encoding, "encoding-date");
  for (const c of elements(identification, "creator")) {
    const type = attr(c, "type");
    if (type === "composer") meta.Composer = ownText(c);
    else if (type === "arranger") meta.Arranger = ownText(c);
    else if (type === "lyricist") meta.Lyricist = ownText(c);
  }
  return meta;
}

function buildPartGroups(partList: XElement | undefined): PartGroup[] | null {
  const groups = elements(partList, "part-group")
    .filter((pg) => attr(pg, "type") === "start")
    .map((pg): PartGroup => ({ ID: newID(), Name: "", Symbol: text(pg, "group-symbol"), Barline: text(pg, "group-barline"), OrderedPartIDs: null }));
  return groups.length ? groups : null;
}

function buildPart(px: XElement, order: number, name: string, drums: Map<string, number>): [Part, ImportWarning[]] {
  const part: Part = { ID: newID(), SourceID: attr(px, "id"), Name: name, Abbreviation: "", Order: order, Instrument: emptyInstrument(""), Measures: null };
  const state = { divisions: 1, transpose: { ...NO_TRANSPOSE } as Transpose };
  const warnings: ImportWarning[] = [];
  const measures: Measure[] = [];
  elements(px, "measure").forEach((mx, i) => {
    const [measure, mWarnings] = buildMeasure(mx, i, state, drums);
    if (i === 0) part.Instrument.Transpose = { ...state.transpose };
    measures.push(measure);
    warnings.push(...mWarnings);
  });
  part.Measures = measures.length ? measures : null;
  return [part, summarizeBackupRepairs(warnings, attr(px, "id"))];
}

const MEASURE_ITEMS = new Set(["attributes", "note", "backup", "forward", "direction", "harmony", "barline", "sound"]);

function buildMeasure(mx: XElement, index: number, state: { divisions: number; transpose: Transpose }, drums: Map<string, number>): [Measure, ImportWarning[]] {
  const measure: Measure = {
    ID: newID(),
    Index: index,
    Number: attr(mx, "number"),
    Implicit: attr(mx, "implicit") === "yes",
    AttributeChanges: null,
    Voices: null,
    Harmonies: null,
    Directions: null,
    Barlines: null,
    Navigation: {},
  };
  const attributes: MeasureAttributes[] = [];
  const harmonies: Harmony[] = [];
  const directions: Direction[] = [];
  const barlines: Barline[] = [];
  const voiceEvents = new Map<string, ScoreEvent[]>();
  const voiceOrder: [number, number][] = [];
  const lastStart = new Map<string, Rational>();
  let cursor = rat(0);
  let soundNav: Navigation = {};
  let clamped = false;

  for (const item of mx.children) {
    if (typeof item === "string" || !MEASURE_ITEMS.has(item.name)) continue;
    switch (item.name) {
      case "attributes": {
        const attrs = mapAttributes(item, state);
        const t = child(item, "transpose");
        if (t) {
          state.transpose = { diatonic: intChild(t, "diatonic"), chromatic: intChild(t, "chromatic"), octaveChange: intChild(t, "octave-change") };
          attrs.Transpose = { ...state.transpose };
        }
        attributes.push(attrs);
        break;
      }
      case "note": {
        const staff = intChild(item, "staff") || 1;
        const voice = intChild(item, "voice") || 1;
        const key = `${staff}/${voice}`;
        const duration = safeDivisions(intChild(item, "duration"), state.divisions) ?? rat(0);
        const isChord = elements(item, "chord").length > 0;
        const start = isChord ? (lastStart.get(key) ?? cursor) : cursor;
        const event = mapNote(item, start, duration, staff, voice, isChord, state.transpose, drums);
        if (!voiceEvents.has(key)) {
          voiceEvents.set(key, []);
          voiceOrder.push([staff, voice]);
        }
        voiceEvents.get(key)!.push(event);
        if (!isChord) {
          cursor = add(cursor, duration);
          lastStart.set(key, start);
        }
        break;
      }
      case "backup": {
        const d = safeDivisions(intChild(item, "duration"), state.divisions);
        if (d) [cursor, clamped] = backupCursor(cursor, d, clamped);
        break;
      }
      case "forward": {
        const d = safeDivisions(intChild(item, "duration"), state.divisions);
        if (d) cursor = add(cursor, d);
        break;
      }
      case "harmony": {
        let start = cursor;
        const off = intChild(item, "offset");
        if (off !== 0) {
          const d = safeDivisions(off, state.divisions);
          if (d) start = add(cursor, d);
        }
        harmonies.push(mapHarmony(item, start));
        break;
      }
      case "direction": {
        const d = mapDirection(item, cursor, state.divisions);
        if (d) directions.push(d);
        const sound = child(item, "sound");
        if (sound) soundNav = mergeSound(soundNav, readSound(sound));
        break;
      }
      case "sound":
        soundNav = mergeSound(soundNav, readSound(item));
        break;
      case "barline": {
        const bl = mapBarline(item);
        if (bl) barlines.push(bl);
        break;
      }
    }
  }
  const warnings: ImportWarning[] = [];
  if (clamped) warnings.push({ Severity: "", Code: "", Message: "", PartID: "", MeasureIndex: index, Element: BACKUP_ELEMENT });

  measure.AttributeChanges = attributes.length ? attributes : null;
  measure.Harmonies = harmonies.length ? harmonies : null;
  measure.Directions = directions.length ? directions : null;
  measure.Barlines = barlines.length ? barlines : null;
  measure.Navigation = isNavigationEmpty(soundNav) ? inferNavigation(directions) : soundNav;
  const voices: Voice[] = voiceOrder.map(([staff, voice]) => ({ ID: newID(), Staff: staff, Number: voice, Events: voiceEvents.get(`${staff}/${voice}`)! }));
  measure.Voices = voices.length ? voices : null;
  return [measure, warnings];
}

function safeDivisions(duration: number, divisions: number): Rational | null {
  return divisions === 0 ? null : fromDivisions(duration, divisions);
}

function mapAttributes(ax: XElement, state: { divisions: number }): MeasureAttributes {
  const attrs: MeasureAttributes = { Divisions: 0, Key: null, Time: null, Clefs: null, StaffCount: 0, Transpose: null };
  const divisions = intChild(ax, "divisions");
  if (divisions > 0) {
    state.divisions = divisions;
    attrs.Divisions = divisions;
  }
  const keys = elements(ax, "key");
  if (keys.length > 0) attrs.Key = { Fifths: intChild(keys[0], "fifths") };
  const times = elements(ax, "time");
  if (times.length > 0) attrs.Time = { Beats: intChild(times[0], "beats"), BeatType: intChild(times[0], "beat-type") };
  const staves = intChild(ax, "staves");
  if (staves > 0) attrs.StaffCount = staves;
  const clefs: ClefSpec[] = elements(ax, "clef").map((c) => {
    const m = /^\s*[+-]?\d+/.exec(attr(c, "number"));
    return { Staff: m ? Number.parseInt(m[0], 10) : 1, Sign: text(c, "sign"), Line: intChild(c, "line") };
  });
  if (clefs.length) attrs.Clefs = clefs;
  return attrs;
}

function mapNote(n: XElement, start: Rational, duration: Rational, staff: number, voice: number, isChord: boolean, transpose: Transpose, drums: Map<string, number>): ScoreEvent {
  const event: ScoreEvent = {
    ID: newID(),
    Kind: EVENT_NOTE,
    Start: start,
    Duration: duration,
    NoteType: text(n, "type"),
    Dots: elements(n, "dot").length,
    Chord: isChord,
    Pitch: null,
    ConcertPitch: null,
    Stem: text(n, "stem"),
    Beams: null,
    TieStart: false,
    TieStop: false,
    Accidental: text(n, "accidental"),
    Voice: voice,
    Staff: staff,
    Percussion: false,
  };
  const beams = elements(n, "beam").map((b) => ownText(b));
  if (beams.length) event.Beams = beams;
  const notations = elements(n, "notations");
  for (const block of notations) {
    for (const tied of elements(block, "tied")) {
      if (attr(tied, "type") === "start") event.TieStart = true;
      else if (attr(tied, "type") === "stop") event.TieStop = true;
    }
  }
  const mapped = mapNotations(notations);
  if (mapped) event.Notations = mapped;
  const grace = child(n, "grace");
  if (grace) {
    event.Grace = true;
    if (attr(grace, "slash") === "yes") event.GraceSlash = true;
  }
  const tm = child(n, "time-modification");
  if (tm) {
    const actual = intChild(tm, "actual-notes");
    const normal = intChild(tm, "normal-notes");
    if (actual > 0 && normal > 0) event.TimeModification = { Actual: actual, Normal: normal };
  }
  const lyrics = elements(n, "lyric")
    .map((l) => ({ l, text: elements(l, "text").map(ownText).join(""), extend: elements(l, "extend").length > 0 }))
    .filter((x) => x.text !== "" || x.extend)
    .map(({ l, text: t, extend }) => {
      const lyric: NonNullable<ScoreEvent["Lyrics"]>[number] = { Text: t };
      if (attr(l, "number")) lyric.Number = attr(l, "number");
      if (text(l, "syllabic")) lyric.Syllabic = text(l, "syllabic");
      if (extend) lyric.Extend = true;
      return lyric;
    });
  if (lyrics.length) event.Lyrics = lyrics;

  if (child(n, "rest")) {
    event.Kind = EVENT_REST;
    return event;
  }
  if (text(n, "notehead")) event.Notehead = text(n, "notehead");
  const unpitched = child(n, "unpitched");
  if (unpitched) {
    mapUnpitched(event, unpitched, child(n, "instrument"), drums);
    return event;
  }
  const pitch = child(n, "pitch");
  if (pitch) {
    event.Pitch = { Step: text(pitch, "step"), Alter: intChild(pitch, "alter"), Octave: intChild(pitch, "octave"), CentsOffset: 0 };
    event.ConcertPitch = applyTranspose(event.Pitch, transpose);
  }
  return event;
}

function mapHarmony(hx: XElement, start: Rational): Harmony {
  const root = elements(hx, "root")[0];
  const bass = elements(hx, "bass")[0];
  const degrees = elements(hx, "degree").map((d) => ({ Value: intChild(d, "degree-value"), Alter: intChild(d, "degree-alter"), Type: text(d, "degree-type") }));
  return {
    ID: newID(),
    Start: start,
    RootStep: root ? text(root, "root-step") : "",
    RootAlter: root ? intChild(root, "root-alter") : 0,
    Kind: ownText(child(hx, "kind")),
    KindText: "",
    BassStep: bass ? text(bass, "bass-step") : "",
    BassAlter: bass ? intChild(bass, "bass-alter") : 0,
    Inversion: 0,
    Degrees: degrees.length ? degrees : null,
  };
}

function mapDirection(dx: XElement, cursor: Rational, divisions: number): Direction | null {
  let start = cursor;
  const offset = intChild(dx, "offset");
  if (offset !== 0) {
    const d = safeDivisions(offset, divisions);
    if (d) start = add(cursor, d);
  }
  const base: Direction = { ID: newID(), Start: start, Staff: intChild(dx, "staff"), Type: "", Text: "", Placement: attr(dx, "placement"), BeatUnit: "", PerMinute: 0 };
  for (const t of elements(dx, "direction-type")) {
    const rehearsal = text(t, "rehearsal");
    const metronome = child(t, "metronome");
    const dynamics = child(t, "dynamics");
    const wedge = child(t, "wedge");
    const pedal = child(t, "pedal");
    const octave = child(t, "octave-shift");
    const words = text(t, "words");
    if (rehearsal !== "") return { ...base, Type: "rehearsal", Text: rehearsal };
    if (metronome) return { ...base, Type: "metronome", BeatUnit: text(metronome, "beat-unit"), PerMinute: floatChild(metronome, "per-minute") };
    if (dynamics && childNames(dynamics).length > 0) return { ...base, Type: "dynamics", Text: childNames(dynamics)[0] };
    if (wedge && attr(wedge, "type") !== "") return withSpan({ ...base, Type: "wedge", Text: attr(wedge, "type") }, wedge);
    if (pedal && attr(pedal, "type") !== "") return { ...base, Type: "pedal", Text: attr(pedal, "type") };
    if (octave && attr(octave, "type") !== "") {
      const d = withSpan({ ...base, Type: "octave-shift", Text: attr(octave, "type") }, octave);
      const size = Number.parseInt(attr(octave, "size") || "0", 10);
      if (size) d.Size = size;
      return d;
    }
    if (child(t, "segno")) return { ...base, Type: "segno" };
    if (child(t, "coda")) return { ...base, Type: "coda" };
    if (words !== "") return { ...base, Type: "words", Text: words };
  }
  return null;
}

function withSpan(d: Direction, el: XElement): Direction {
  const n = Number.parseInt(attr(el, "number") || "0", 10);
  if (n) d.Number = n;
  return d;
}
