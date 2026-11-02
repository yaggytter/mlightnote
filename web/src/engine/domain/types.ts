// The canonical score model (APP_DESIGN.md §9.1, §9.4). Field names and
// shapes match the Go implementation's JSON exactly, so projects and
// .mlight files are interchangeable between the two. A Go nil pointer is
// `null`; a Go `omitempty` field is optional.
import type { Rational } from "./rational";

export interface CanonicalScore {
  Metadata: ScoreMetadata;
  PartGroups: PartGroup[] | null;
  Parts: Part[] | null;
}

export interface ScoreMetadata {
  Title: string;
  Subtitle: string;
  Movement: string;
  Composer: string;
  Arranger: string;
  Lyricist: string;
  Copyright: string;
  Software: string;
  EncodingDate: string;
}

export interface PartGroup {
  ID: string;
  Name: string;
  Symbol: string;
  Barline: string;
  OrderedPartIDs: string[] | null;
}

export interface Part {
  ID: string;
  SourceID: string;
  Name: string;
  Abbreviation: string;
  Order: number;
  Instrument: InstrumentDefinition;
  Measures: Measure[] | null;
}

export interface Transpose {
  diatonic: number;
  chromatic: number;
  octaveChange: number;
}

export interface InstrumentDefinition {
  ID: string;
  Name: string;
  Transpose: Transpose;
  MIDIChannel: number;
  MIDIProgram: number;
  MIDIBankMSB: number;
  MIDIBankLSB: number;
  IsPercussion: boolean;
}

export interface Measure {
  ID: string;
  Index: number;
  Number: string;
  Implicit: boolean;
  AttributeChanges: MeasureAttributes[] | null;
  Voices: Voice[] | null;
  Harmonies: Harmony[] | null;
  Directions: Direction[] | null;
  Barlines: Barline[] | null;
  Navigation: Navigation;
}

export interface MeasureAttributes {
  Divisions: number;
  Key: KeySignature | null;
  Time: TimeSignature | null;
  Clefs: ClefSpec[] | null;
  StaffCount: number;
  Transpose: Transpose | null;
}

export interface KeySignature {
  Fifths: number;
}

export interface TimeSignature {
  Beats: number;
  BeatType: number;
}

export interface ClefSpec {
  Staff: number;
  Sign: string;
  Line: number;
}

export interface Voice {
  ID: string;
  Staff: number;
  Number: number;
  Events: ScoreEvent[] | null;
}

export const EVENT_NOTE = 0;
export const EVENT_REST = 1;
export type EventKind = typeof EVENT_NOTE | typeof EVENT_REST;

export interface Pitch {
  Step: string;
  Alter: number;
  Octave: number;
  CentsOffset: number;
}

export interface ScoreEvent {
  ID: string;
  Kind: EventKind;
  Start: Rational;
  Duration: Rational;
  NoteType: string;
  Dots: number;
  Chord: boolean;
  Pitch: Pitch | null;
  ConcertPitch: Pitch | null;
  Stem: string;
  Beams: string[] | null;
  TieStart: boolean;
  TieStop: boolean;
  Accidental: string;
  Voice: number;
  Staff: number;
  Percussion: boolean;
  Grace?: boolean;
  GraceSlash?: boolean;
  TimeModification?: TimeModification;
  Notations?: Notations;
  Lyrics?: Lyric[];
  Unpitched?: DisplayPosition;
  Notehead?: string;
}

export interface DisplayPosition {
  Step: string;
  Octave: number;
}

export interface TimeModification {
  Actual: number;
  Normal: number;
}

export interface Notations {
  Slurs?: SpanMark[];
  Tuplets?: SpanMark[];
  Articulations?: string[];
  Ornaments?: string[];
  Fermata?: string;
  Arpeggiate?: boolean;
}

export interface SpanMark {
  Type: string;
  Number?: number;
  Placement?: string;
  Bracket?: string;
}

export interface Lyric {
  Number?: string;
  Syllabic?: string;
  Text: string;
  Extend?: boolean;
}

export interface Harmony {
  ID: string;
  Start: Rational;
  RootStep: string;
  RootAlter: number;
  Kind: string;
  KindText: string;
  BassStep: string;
  BassAlter: number;
  Inversion: number;
  Degrees: HarmonyDegree[] | null;
}

export interface HarmonyDegree {
  Value: number;
  Alter: number;
  Type: string;
}

export interface Direction {
  ID: string;
  Start: Rational;
  Staff: number;
  Type: string;
  Text: string;
  Placement: string;
  BeatUnit: string;
  PerMinute: number;
  Number?: number;
  Size?: number;
}

export interface Barline {
  Location: string;
  Style: string;
  Repeat: string;
  Times: number;
  Ending: Ending | null;
}

export interface Ending {
  Numbers: string;
  Type: string;
  Text: string;
}

export interface Navigation {
  Segno?: string;
  Coda?: string;
  DalSegno?: string;
  ToCoda?: string;
  DaCapo?: boolean;
  Fine?: boolean;
}

export type WarningSeverity = "info" | "warning" | "error";
export type WarningCode = "UNSUPPORTED_PRESERVED" | "INFERRED" | "REPAIRED" | "IGNORED_FOR_RENDERING";

export interface ImportReport {
  Warnings: ImportWarning[] | null;
}

export interface ImportWarning {
  Severity: WarningSeverity | "";
  Code: WarningCode | "";
  Message: string;
  PartID: string;
  MeasureIndex: number;
  Element: string;
}

// ---- helpers mirroring small Go methods ----

export function hasArticulation(n: Notations | undefined, name: string): boolean {
  return !!n?.Articulations?.includes(name);
}

export function isLeftBarline(b: Barline): boolean {
  return b.Location === "left";
}

export function isNavigationEmpty(n: Navigation): boolean {
  return !n.Segno && !n.Coda && !n.DalSegno && !n.ToCoda && !n.DaCapo && !n.Fine;
}

/** The attributes in force at the end of a measure (last value per field). */
export function effectiveAttributes(m: Measure): MeasureAttributes {
  const eff: MeasureAttributes = { Divisions: 0, Key: null, Time: null, Clefs: null, StaffCount: 0, Transpose: null };
  for (const a of m.AttributeChanges ?? []) {
    if (a.Divisions > 0) eff.Divisions = a.Divisions;
    if (a.Key) eff.Key = a.Key;
    if (a.Time) eff.Time = a.Time;
    if (a.StaffCount > 0) eff.StaffCount = a.StaffCount;
    if (a.Clefs && a.Clefs.length > 0) eff.Clefs = a.Clefs;
  }
  return eff;
}

export function emptyMetadata(): ScoreMetadata {
  return { Title: "", Subtitle: "", Movement: "", Composer: "", Arranger: "", Lyricist: "", Copyright: "", Software: "", EncodingDate: "" };
}

export function emptyInstrument(id: string): InstrumentDefinition {
  return {
    ID: id,
    Name: "",
    Transpose: { diatonic: 0, chromatic: 0, octaveChange: 0 },
    MIDIChannel: 0,
    MIDIProgram: 0,
    MIDIBankMSB: 0,
    MIDIBankLSB: 0,
    IsPercussion: false,
  };
}

export function emptyAttributes(): MeasureAttributes {
  return { Divisions: 0, Key: null, Time: null, Clefs: null, StaffCount: 0, Transpose: null };
}
