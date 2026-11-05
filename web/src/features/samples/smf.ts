// Writes a sample song as a Standard MIDI File (format 1): a conductor
// track (title, tempo, time and key signature) and one track per hand.
// The app then imports it like any .mid the user drops in (§7.1).
import { measureTicks, parseMeasure, TICKS_PER_QUARTER } from "./notes";
import type { SampleSong, SampleTrack } from "./songs";

const MICROSECONDS_PER_MINUTE = 60_000_000;
const MIDI_CLOCKS_PER_CLICK = 24;
const THIRTY_SECONDS_PER_QUARTER = 8;
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const PROGRAM_CHANGE = 0xc0;
const utf8 = new TextEncoder();

interface TimedEvent {
  tick: number;
  /** At the same tick, note-offs (0) go before everything else (1). */
  order: number;
  bytes: number[];
}

function variableLength(value: number): number[] {
  const out = [value & 0x7f];
  for (let v = value >>> 7; v > 0; v >>>= 7) out.unshift((v & 0x7f) | 0x80);
  return out;
}

function meta(type: number, data: number[]): number[] {
  return [0xff, type, ...variableLength(data.length), ...data];
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function trackChunk(events: TimedEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const e of sorted) {
    body.push(...variableLength(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  body.push(0, ...meta(0x2f, []));
  return [...utf8.encode("MTrk"), ...u32(body.length), ...body];
}

function conductorTrack(song: SampleSong): TimedEvent[] {
  const tempo = Math.round(MICROSECONDS_PER_MINUTE / song.bpm);
  const keyByte = song.keyFifths < 0 ? 256 + song.keyFifths : song.keyFifths;
  const at0 = (bytes: number[]): TimedEvent => ({ tick: 0, order: 1, bytes });
  return [
    at0(meta(0x03, [...utf8.encode(song.title)])),
    at0(meta(0x51, [(tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff])),
    at0(meta(0x58, [song.beats, Math.log2(song.beatType), MIDI_CLOCKS_PER_CLICK, THIRTY_SECONDS_PER_QUARTER])),
    at0(meta(0x59, [keyByte, song.minor ? 1 : 0])),
  ];
}

function noteTrack(track: SampleTrack, channel: number, ticksPerMeasure: number): TimedEvent[] {
  const events: TimedEvent[] = [
    { tick: 0, order: 1, bytes: meta(0x03, [...utf8.encode(track.name)]) },
    { tick: 0, order: 1, bytes: [PROGRAM_CHANGE | channel, track.program] },
  ];
  track.measures.forEach((measure, i) => {
    let tick = i * ticksPerMeasure;
    for (const token of parseMeasure(measure)) {
      for (const pitch of token.pitches) {
        events.push({ tick, order: 1, bytes: [NOTE_ON | channel, pitch, track.velocity] });
        events.push({ tick: tick + token.ticks, order: 0, bytes: [NOTE_OFF | channel, pitch, 0] });
      }
      tick += token.ticks;
    }
  });
  return events;
}

/** The song as .mid bytes. */
export function sampleMidi(song: SampleSong): Uint8Array<ArrayBuffer> {
  const ticksPerMeasure = measureTicks(song.beats, song.beatType);
  const tracks = [conductorTrack(song), ...song.tracks.map((t, i) => noteTrack(t, i, ticksPerMeasure))];
  const header = [...utf8.encode("MThd"), ...u32(6), 0, 1, 0, tracks.length, TICKS_PER_QUARTER >> 8, TICKS_PER_QUARTER & 0xff];
  return Uint8Array.from([...header, ...tracks.flatMap(trackChunk)]);
}

/** The song as a File, ready for the same import path as a dropped file. */
export function sampleFile(song: SampleSong): File {
  return new File([sampleMidi(song)], `${song.title}.mid`, { type: "audio/midi" });
}
