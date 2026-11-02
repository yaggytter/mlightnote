import { autoAbbreviation } from "../../domain/abbreviation";
import { midiNote, transposeFifths } from "../../domain/pitch";
import { add, compare, isZero, rat, sub, type Rational } from "../../domain/rational";
import { transposeHarmony } from "../../domain/retranspose";
import {
  EVENT_REST,
  isLeftBarline,
  isNavigationEmpty,
  type Barline,
  type CanonicalScore,
  type Direction,
  type Harmony,
  type Lyric,
  type Measure,
  type MeasureAttributes,
  type Navigation,
  type Part,
  type ScoreEvent,
  type SpanMark,
  type Transpose,
  type Voice,
} from "../../domain/types";
import { gmDrum } from "../../domain/drums";
import { withReadableClefs } from "./clefs";

// Generates the display MusicXML the notation renderer draws (APP_DESIGN.md
// §7.4 FR-VIEW-003). A port of the Go generator; the output must match its
// golden data byte for byte.

export interface DisplayOptions {
  /** Limit output to these parts, in score order. Empty = all. */
  partIds?: string[];
  /** Sounding pitch: notes use ConcertPitch, keys shift, <transpose> is omitted. */
  concertPitch?: boolean;
}

/** Fine enough for 64th-note triplets; shared by every measure. */
const EXPORT_DIVISIONS = 960;

export function generateDisplayXML(score: CanonicalScore, opts: DisplayOptions = {}): string {
  const partIds = opts.partIds ?? [];
  let parts = score.Parts ?? [];
  let groups = score.PartGroups ?? [];
  if (partIds.length > 0) {
    const want = new Set(partIds);
    parts = parts.filter((p) => want.has(p.ID));
    groups = []; // a group spanning filtered-out parts would be wrong
  }
  const out: string[] = [];
  const w = (s: string) => out.push(s);
  w(`<?xml version="1.0" encoding="UTF-8"?>\n`);
  w(`<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n`);
  w(`<score-partwise version="4.0">\n`);
  writeWork(w, score.Metadata);
  writeIdentification(w, score.Metadata);
  writePartList(w, parts, groups);
  for (const part of parts) writePart(w, part, !!opts.concertPitch);
  w(`</score-partwise>\n`);
  return out.join("");
}

type Write = (s: string) => void;

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Go's %g for a float64 (shortest form; exponent from 1e6 or below 1e-4). */
export function goG(x: number): string {
  if (x === 0) return "0";
  const abs = Math.abs(x);
  if (abs >= 1e21 || abs < 1e-4 || abs >= 1e6) {
    const [m, e] = x.toExponential().split("e");
    const exp = Number(e);
    return `${m}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  return String(x);
}

function toDivisions(r: Rational): number {
  return Math.trunc((r.numerator * EXPORT_DIVISIONS) / r.denominator);
}

function writeWork(w: Write, m: CanonicalScore["Metadata"]) {
  if (m.Title) w(`  <work><work-title>${esc(m.Title)}</work-title></work>\n`);
  const line = m.Movement || m.Subtitle;
  if (line) w(`  <movement-title>${esc(line)}</movement-title>\n`);
}

function writeIdentification(w: Write, m: CanonicalScore["Metadata"]) {
  const hasCreator = m.Composer || m.Arranger || m.Lyricist;
  if (!hasCreator && !m.Copyright && !m.Software) return;
  w("  <identification>\n");
  if (m.Composer) w(`    <creator type="composer">${esc(m.Composer)}</creator>\n`);
  if (m.Arranger) w(`    <creator type="arranger">${esc(m.Arranger)}</creator>\n`);
  if (m.Lyricist) w(`    <creator type="lyricist">${esc(m.Lyricist)}</creator>\n`);
  if (m.Copyright) w(`    <rights>${esc(m.Copyright)}</rights>\n`);
  if (m.Software || m.EncodingDate) {
    w("    <encoding>\n");
    if (m.Software) w(`      <software>${esc(m.Software)}</software>\n`);
    if (m.EncodingDate) w(`      <encoding-date>${esc(m.EncodingDate)}</encoding-date>\n`);
    w("    </encoding>\n");
  }
  w("  </identification>\n");
}

/** The label for systems after the first (auto-derived in multi-part scores). */
export function partAbbreviation(part: Part, partsShown: number): string {
  if (part.Abbreviation !== "" || partsShown < 2) return part.Abbreviation;
  return autoAbbreviation(part.Name);
}

function writePartList(w: Write, parts: Part[], groups: NonNullable<CanonicalScore["PartGroups"]>) {
  w("  <part-list>\n");
  for (const g of groups) {
    w(`    <part-group type="start">\n`);
    if (g.Symbol) w(`      <group-symbol>${esc(g.Symbol)}</group-symbol>\n`);
    if (g.Barline) w(`      <group-barline>${esc(g.Barline)}</group-barline>\n`);
    w("    </part-group>\n");
  }
  for (const part of parts) {
    w(`    <score-part id="${esc(part.ID)}">\n      <part-name>${esc(part.Name)}</part-name>\n`);
    const abbr = partAbbreviation(part, parts.length);
    if (abbr) w(`      <part-abbreviation>${esc(abbr)}</part-abbreviation>\n`);
    writeDrumInstruments(w, part);
    w("    </score-part>\n");
  }
  for (let i = 0; i < groups.length; i++) w(`    <part-group type="stop"/>\n`);
  w("  </part-list>\n");
}

function drumInstrumentID(partID: string, key: number): string {
  return `${esc(partID)}-I${key}`;
}

function writeDrumInstruments(w: Write, part: Part) {
  const keys = new Set<number>();
  for (const m of part.Measures ?? []) for (const v of m.Voices ?? []) for (const e of v.Events ?? []) if (e.Unpitched && e.Pitch) keys.add(midiNote(e.Pitch));
  const sorted = [...keys].sort((a, b) => a - b);
  for (const k of sorted) w(`      <score-instrument id="${drumInstrumentID(part.ID, k)}"><instrument-name>${esc(gmDrum(k).Name)}</instrument-name></score-instrument>\n`);
  for (const k of sorted) w(`      <midi-instrument id="${drumInstrumentID(part.ID, k)}"><midi-channel>10</midi-channel><midi-unpitched>${k + 1}</midi-unpitched></midi-instrument>\n`);
}

function writePart(w: Write, part: Part, concert: boolean) {
  w(`  <part id="${esc(part.ID)}">\n`);
  let transpose = part.Instrument.Transpose;
  for (const m of withReadableClefs(part)) {
    for (const a of m.AttributeChanges ?? []) if (a.Transpose) transpose = a.Transpose;
    writeMeasure(w, m, concert, transpose, part.ID);
  }
  w("  </part>\n");
}

interface Anchor {
  start: Rational;
  write: (offset: Rational) => void;
}

function writeMeasure(w: Write, m: Measure, concert: boolean, transpose: Transpose, partID: string) {
  w(`    <measure number="${esc(m.Number)}"${m.Implicit ? ` implicit="yes"` : ""}>\n`);
  (m.AttributeChanges ?? []).forEach((a, i) => writeAttributes(w, a, i === 0, concert, transpose));
  for (const bl of m.Barlines ?? []) if (isLeftBarline(bl)) writeBarline(w, bl);
  writeSound(w, { Segno: m.Navigation.Segno, Coda: m.Navigation.Coda });

  // Chord symbols and directions are woven into the first voice at their
  // position (with <offset> inside a note), so each lands on its beat.
  const anchors: Anchor[] = [
    ...(m.Harmonies ?? []).map((h) => {
      const shown = concert ? transposeHarmony(h, transpose) : h;
      return { start: h.Start, write: (off: Rational) => writeHarmony(w, shown, off) };
    }),
    ...(m.Directions ?? []).map((d) => ({ start: d.Start, write: (off: Rational) => writeDirection(w, d, off) })),
  ].sort((a, b) => compare(a.start, b.start));
  const flush = (at: Rational, end?: Rational) => {
    while (anchors.length > 0) {
      const it = anchors[0];
      if (end && compare(it.start, at) > 0 && compare(it.start, end) >= 0) return;
      anchors.shift();
      it.write(sub(it.start, at));
    }
  };

  let cursor = rat(0);
  (m.Voices ?? []).forEach((voice, vi) => {
    if (!isZero(cursor)) w(`      <backup><duration>${toDivisions(cursor)}</duration></backup>\n`);
    let voiceCursor = rat(0);
    for (const e of voice.Events ?? []) {
      if (vi === 0 && !e.Chord) flush(voiceCursor, add(voiceCursor, e.Duration));
      writeNote(w, e, voice, concert, partID);
      if (!e.Chord) voiceCursor = add(voiceCursor, e.Duration);
    }
    if (vi === 0) flush(voiceCursor);
    cursor = voiceCursor;
  });
  flush(cursor); // a measure with no voices

  const nav = m.Navigation;
  writeSound(w, { DalSegno: nav.DalSegno, ToCoda: nav.ToCoda, DaCapo: nav.DaCapo, Fine: nav.Fine });
  for (const bl of m.Barlines ?? []) if (!isLeftBarline(bl)) writeBarline(w, bl);
  w("    </measure>\n");
}

function writeBarline(w: Write, bl: Barline) {
  let s = `      <barline location="${isLeftBarline(bl) ? "left" : "right"}">`;
  if (bl.Style) s += `<bar-style>${esc(bl.Style)}</bar-style>`;
  if (bl.Ending) s += `<ending number="${esc(bl.Ending.Numbers)}" type="${esc(bl.Ending.Type)}">${esc(bl.Ending.Text)}</ending>`;
  if (bl.Repeat) s += `<repeat direction="${esc(bl.Repeat)}"${bl.Times > 0 ? ` times="${bl.Times}"` : ""}/>`;
  w(s + "</barline>\n");
}

function writeSound(w: Write, n: Navigation) {
  if (isNavigationEmpty(n)) return;
  let s = "      <sound";
  for (const [name, v] of [["segno", n.Segno], ["coda", n.Coda], ["dalsegno", n.DalSegno], ["tocoda", n.ToCoda]] as const) {
    if (v) s += ` ${name}="${esc(v)}"`;
  }
  if (n.DaCapo) s += ` dacapo="yes"`;
  if (n.Fine) s += ` fine="yes"`;
  w(s + "/>\n");
}

function writeAttributes(w: Write, a: MeasureAttributes, isFirst: boolean, concert: boolean, transpose: Transpose) {
  w("      <attributes>\n");
  if (isFirst) w(`        <divisions>${EXPORT_DIVISIONS}</divisions>\n`);
  if (a.Key) w(`        <key><fifths>${concert ? transposeFifths(a.Key.Fifths, transpose.chromatic) : a.Key.Fifths}</fifths></key>\n`);
  if (a.Time) w(`        <time><beats>${a.Time.Beats}</beats><beat-type>${a.Time.BeatType}</beat-type></time>\n`);
  if (a.StaffCount > 0) w(`        <staves>${a.StaffCount}</staves>\n`);
  for (const c of a.Clefs ?? []) w(`        <clef number="${c.Staff}"><sign>${esc(c.Sign)}</sign><line>${c.Line}</line></clef>\n`);
  if (a.Transpose && !concert) {
    const t = a.Transpose;
    w(`        <transpose><diatonic>${t.diatonic}</diatonic><chromatic>${t.chromatic}</chromatic>${t.octaveChange !== 0 ? `<octave-change>${t.octaveChange}</octave-change>` : ""}</transpose>\n`);
  }
  w("      </attributes>\n");
}

function writeOffset(w: Write, offset: Rational) {
  if (!isZero(offset)) w(`        <offset>${toDivisions(offset)}</offset>\n`);
}

function writeHarmony(w: Write, h: Harmony, offset: Rational) {
  w("      <harmony>\n");
  w(`        <root><root-step>${esc(h.RootStep)}</root-step>${h.RootAlter !== 0 ? `<root-alter>${h.RootAlter}</root-alter>` : ""}</root>\n`);
  w(`        <kind>${esc(h.Kind)}</kind>\n`);
  if (h.BassStep) w(`        <bass><bass-step>${esc(h.BassStep)}</bass-step>${h.BassAlter !== 0 ? `<bass-alter>${h.BassAlter}</bass-alter>` : ""}</bass>\n`);
  for (const d of h.Degrees ?? []) {
    w(`        <degree><degree-value>${d.Value}</degree-value><degree-alter>${d.Alter}</degree-alter><degree-type>${esc(d.Type)}</degree-type></degree>\n`);
  }
  writeOffset(w, offset);
  w("      </harmony>\n");
}

function numberAttr(n: number | undefined): string {
  return n && n > 0 ? ` number="${n}"` : "";
}

/** Keeps a model string usable as an element name (letters, digits, "-"). */
function xmlName(s: string, fallback: string): string {
  const name = s.replace(/[^A-Za-z0-9-]/g, "");
  if (name === "" || name[0] === "-" || /[0-9]/.test(name[0])) return fallback;
  return name;
}

function writeDirection(w: Write, d: Direction, offset: Rational) {
  w(`      <direction${d.Placement ? ` placement="${esc(d.Placement)}"` : ""}>\n        <direction-type>\n`);
  switch (d.Type) {
    case "rehearsal":
      w(`          <rehearsal>${esc(d.Text)}</rehearsal>\n`);
      break;
    case "metronome":
      w(`          <metronome><beat-unit>${esc(d.BeatUnit)}</beat-unit><per-minute>${goG(d.PerMinute)}</per-minute></metronome>\n`);
      break;
    case "words":
      w(`          <words>${esc(d.Text)}</words>\n`);
      break;
    case "dynamics":
      w(`          <dynamics><${xmlName(d.Text, "other-dynamics")}/></dynamics>\n`);
      break;
    case "wedge":
      w(`          <wedge type="${esc(d.Text)}"${numberAttr(d.Number)}/>\n`);
      break;
    case "pedal":
      w(`          <pedal type="${esc(d.Text)}" line="yes"/>\n`);
      break;
    case "octave-shift":
      w(`          <octave-shift type="${esc(d.Text)}"${numberAttr(d.Number)}${d.Size && d.Size > 0 ? ` size="${d.Size}"` : ""}/>\n`);
      break;
    case "segno":
      w("          <segno/>\n");
      break;
    case "coda":
      w("          <coda/>\n");
      break;
  }
  w("        </direction-type>\n");
  writeOffset(w, offset);
  if (d.Staff > 0) w(`        <staff>${d.Staff}</staff>\n`);
  w("      </direction>\n");
}

function writeNote(w: Write, e: ScoreEvent, voice: Voice, concert: boolean, partID: string) {
  const pitch = concert && e.ConcertPitch ? e.ConcertPitch : e.Pitch;
  w("      <note>\n");
  if (e.Grace) w(e.GraceSlash ? `        <grace slash="yes"/>\n` : "        <grace/>\n");
  if (e.Chord) w("        <chord/>\n");
  if (e.Kind === EVENT_REST) w("        <rest/>\n");
  else if (e.Unpitched) w(`        <unpitched><display-step>${esc(e.Unpitched.Step)}</display-step><display-octave>${e.Unpitched.Octave}</display-octave></unpitched>\n`);
  else if (pitch) w(`        <pitch><step>${esc(pitch.Step)}</step>${pitch.Alter !== 0 ? `<alter>${pitch.Alter}</alter>` : ""}<octave>${pitch.Octave}</octave></pitch>\n`);
  if (!e.Grace) w(`        <duration>${toDivisions(e.Duration)}</duration>\n`);
  if (e.Unpitched && e.Pitch) w(`        <instrument id="${drumInstrumentID(partID, midiNote(e.Pitch))}"/>\n`);
  w(`        <voice>${voice.Number}</voice>\n`);
  if (e.NoteType) w(`        <type>${esc(e.NoteType)}</type>\n`);
  for (let i = 0; i < e.Dots; i++) w("        <dot/>\n");
  if (e.Accidental && !concert && !e.Unpitched) w(`        <accidental>${esc(e.Accidental)}</accidental>\n`);
  if (e.TimeModification) {
    w(`        <time-modification><actual-notes>${e.TimeModification.Actual}</actual-notes><normal-notes>${e.TimeModification.Normal}</normal-notes></time-modification>\n`);
  }
  if (e.Stem) w(`        <stem>${esc(e.Stem)}</stem>\n`);
  if (e.Notehead) w(`        <notehead>${esc(e.Notehead)}</notehead>\n`);
  w(`        <staff>${voice.Staff}</staff>\n`);
  (e.Beams ?? []).forEach((b, i) => w(`        <beam number="${i + 1}">${esc(b)}</beam>\n`));
  writeNotations(w, e);
  for (const l of e.Lyrics ?? []) writeLyric(w, l);
  w("      </note>\n");
}

function writeSpan(w: Write, element: string, m: SpanMark) {
  let s = `          <${element} type="${esc(m.Type)}"${numberAttr(m.Number)}`;
  if (m.Placement) s += ` placement="${esc(m.Placement)}"`;
  if (m.Bracket) s += ` bracket="${esc(m.Bracket)}"`;
  w(s + "/>\n");
}

const OTHER_ELEMENT: Record<string, string> = { ornaments: "other-ornament", articulations: "other-articulation" };

function writeNamedChildren(w: Write, container: string, names: string[] | undefined) {
  if (!names || names.length === 0) return;
  w(`          <${container}>${names.map((n) => `<${xmlName(n, OTHER_ELEMENT[container])}/>`).join("")}</${container}>\n`);
}

function writeNotations(w: Write, e: ScoreEvent) {
  const n = e.Notations;
  if (!e.TieStart && !e.TieStop && !n) return;
  w("        <notations>\n");
  if (e.TieStop) w(`          <tied type="stop"/>\n`);
  if (e.TieStart) w(`          <tied type="start"/>\n`);
  if (n) {
    for (const s of n.Slurs ?? []) writeSpan(w, "slur", s);
    for (const t of n.Tuplets ?? []) writeSpan(w, "tuplet", t);
    writeNamedChildren(w, "ornaments", n.Ornaments);
    writeNamedChildren(w, "articulations", n.Articulations);
    if (n.Fermata) w(`          <fermata type="${esc(n.Fermata)}"/>\n`);
    if (n.Arpeggiate) w("          <arpeggiate/>\n");
  }
  w("        </notations>\n");
}

function writeLyric(w: Write, l: Lyric) {
  let s = `        <lyric${l.Number ? ` number="${esc(l.Number)}"` : ""}>`;
  if (l.Syllabic) s += `<syllabic>${esc(l.Syllabic)}</syllabic>`;
  s += `<text>${esc(l.Text)}</text>`;
  if (l.Extend) s += "<extend/>";
  w(s + "</lyric>\n");
}
