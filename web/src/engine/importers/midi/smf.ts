// Standard MIDI File parsing (APP_DESIGN.md §7.3 FR-MIDI-001). Lengths are
// bounds-checked against the chunk, never trusted. Format 2 and SMPTE
// division are rejected with specific errors the UI explains.

export class MIDIError extends Error {
  constructor(
    message: string,
    readonly code: "SMPTE_DIVISION" | "UNSUPPORTED_FORMAT" | "INVALID" = "INVALID",
  ) {
    super(message);
  }
}

export const enum EventKind {
  NoteOn,
  NoteOff,
  ProgramChange,
  Tempo,
  TimeSignature,
  TrackName,
  KeySignature,
  EndOfTrack,
}

export interface MIDIEvent {
  tick: number;
  kind: EventKind;
  channel: number;
  note: number;
  velocity: number;
  program: number;
  tempoUSPQ: number;
  timeSigNum: number;
  timeSigDen: number;
  keyFifths: number;
  keyMinor: boolean;
  text: string;
}

export interface Track {
  events: MIDIEvent[];
}

export interface MIDIFile {
  format: number;
  division: number;
  tracks: Track[];
}

function event(tick: number, kind: EventKind, fields: Partial<MIDIEvent> = {}): MIDIEvent {
  return { tick, kind, channel: 0, note: 0, velocity: 0, program: 0, tempoUSPQ: 0, timeSigNum: 0, timeSigDen: 0, keyFifths: 0, keyMinor: false, text: "", ...fields };
}

function u32(d: Uint8Array, i: number): number {
  return ((d[i] << 24) >>> 0) + (d[i + 1] << 16) + (d[i + 2] << 8) + d[i + 3];
}

function tag(d: Uint8Array, i: number): string {
  return String.fromCharCode(d[i], d[i + 1], d[i + 2], d[i + 3]);
}

export function parseMIDI(data: Uint8Array): MIDIFile {
  if (data.length < 14 || tag(data, 0) !== "MThd") throw new MIDIError("midi: missing MThd header");
  const headerLen = u32(data, 4);
  if (headerLen < 6 || 8 + headerLen > data.length) throw new MIDIError("midi: invalid header length");
  const format = (data[8] << 8) | data[9];
  const ntrks = (data[10] << 8) | data[11];
  const division = (data[12] << 8) | data[13];
  if (format !== 0 && format !== 1) throw new MIDIError("midi: only SMF format 0 and 1 are supported", "UNSUPPORTED_FORMAT");
  if (division & 0x8000) throw new MIDIError("midi: SMPTE division is not supported", "SMPTE_DIVISION");
  const file: MIDIFile = { format, division, tracks: [] };
  let pos = 8 + headerLen;
  for (let t = 0; t < ntrks; t++) {
    if (pos + 8 > data.length) throw new MIDIError(`midi: truncated file before track ${t}`);
    if (tag(data, pos) !== "MTrk") throw new MIDIError(`midi: expected MTrk at track ${t}`);
    const trackLen = u32(data, pos + 4);
    const start = pos + 8;
    const end = start + trackLen;
    if (end > data.length) throw new MIDIError(`midi: track ${t} length exceeds file bounds`);
    try {
      file.tracks.push(parseTrack(data.subarray(start, end)));
    } catch (e) {
      throw new MIDIError(`midi: track ${t}: ${e instanceof Error ? e.message : String(e)}`);
    }
    pos = end;
  }
  return file;
}

function readVLQ(data: Uint8Array, pos: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    if (pos + i >= data.length) throw new Error("truncated variable-length quantity");
    const b = data[pos + i];
    value = value * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) return [value, i + 1];
  }
  throw new Error("variable-length quantity exceeds 4 bytes");
}

const utf8 = new TextDecoder("utf-8");

function parseTrack(data: Uint8Array): Track {
  const track: Track = { events: [] };
  let tick = 0;
  let running = 0;
  let pos = 0;
  while (pos < data.length) {
    const [delta, n] = readVLQ(data, pos);
    pos += n;
    tick += delta;
    if (pos >= data.length) throw new Error(`truncated event at tick ${tick}`);
    let status = data[pos];
    if (status < 0x80) {
      status = running;
    } else {
      pos++;
      if (status !== 0xf0 && status !== 0xf7) running = status;
    }
    if (status === 0xff) {
      if (pos >= data.length) throw new Error(`truncated meta event at tick ${tick}`);
      const metaType = data[pos++];
      const [length, m] = readVLQ(data, pos);
      pos += m;
      if (pos + length > data.length) throw new Error(`meta event length exceeds track bounds at tick ${tick}`);
      appendMeta(track, tick, metaType, data.subarray(pos, pos + length));
      pos += length;
    } else if (status === 0xf0 || status === 0xf7) {
      const [length, m] = readVLQ(data, pos);
      pos += m;
      if (pos + length > data.length) throw new Error(`sysex length exceeds track bounds at tick ${tick}`);
      pos += length;
    } else {
      const hi = status & 0xf0;
      const channel = status & 0x0f;
      const dataLen = hi === 0xc0 || hi === 0xd0 ? 1 : 2;
      if (pos + dataLen > data.length) throw new Error(`channel event truncated at tick ${tick}`);
      appendChannel(track, tick, hi, channel, data.subarray(pos, pos + dataLen));
      pos += dataLen;
    }
  }
  return track;
}

function appendChannel(track: Track, tick: number, hi: number, channel: number, d: Uint8Array) {
  if (hi === 0x90) track.events.push(event(tick, d[1] === 0 ? EventKind.NoteOff : EventKind.NoteOn, { channel, note: d[0], velocity: d[1] }));
  else if (hi === 0x80) track.events.push(event(tick, EventKind.NoteOff, { channel, note: d[0], velocity: d[1] }));
  else if (hi === 0xc0) track.events.push(event(tick, EventKind.ProgramChange, { channel, program: d[0] }));
}

function appendMeta(track: Track, tick: number, type: number, p: Uint8Array) {
  switch (type) {
    case 0x51:
      if (p.length === 3) track.events.push(event(tick, EventKind.Tempo, { tempoUSPQ: (p[0] << 16) | (p[1] << 8) | p[2] }));
      break;
    case 0x58:
      if (p.length === 4) track.events.push(event(tick, EventKind.TimeSignature, { timeSigNum: p[0], timeSigDen: 2 ** p[1] }));
      break;
    case 0x59:
      if (p.length === 2) track.events.push(event(tick, EventKind.KeySignature, { keyFifths: p[0] > 127 ? p[0] - 256 : p[0], keyMinor: p[1] === 1 }));
      break;
    case 0x03:
      track.events.push(event(tick, EventKind.TrackName, { text: utf8.decode(p) }));
      break;
    case 0x2f:
      track.events.push(event(tick, EventKind.EndOfTrack));
      break;
  }
}
