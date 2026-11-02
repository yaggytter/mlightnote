import { describe, expect, test } from "vitest";
import { EventKind, MIDIError, parseMIDI } from "./smf";

function smf(format: number, division: number, tracks: number[][]): Uint8Array {
  const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const bytes = [0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, format, 0, tracks.length, (division >> 8) & 0xff, division & 0xff];
  for (const t of tracks) bytes.push(0x4d, 0x54, 0x72, 0x6b, ...u32(t.length), ...t);
  return new Uint8Array(bytes);
}

const END = [0x00, 0xff, 0x2f, 0x00];

describe("parseMIDI", () => {
  test("reads notes, running status, and velocity-zero note-offs", () => {
    // note-on C4, then (running status) velocity 0 after a quarter = note-off
    const data = smf(0, 480, [[0x00, 0x90, 60, 100, 0x83, 0x60, 60, 0, ...END]]);

    const file = parseMIDI(data);

    expect(file.division).toBe(480);
    const kinds = file.tracks[0].events.map((e) => [e.kind, e.tick]);
    expect(kinds).toContainEqual([EventKind.NoteOn, 0]);
    expect(kinds).toContainEqual([EventKind.NoteOff, 480]);
  });

  test("rejects SMPTE division", () => {
    expect(() => parseMIDI(smf(0, 0x8000 | 0x1e, [END]))).toThrow(expect.objectContaining({ code: "SMPTE_DIVISION" }));
  });

  test("rejects format 2", () => {
    expect(() => parseMIDI(smf(2, 480, [END]))).toThrow(expect.objectContaining({ code: "UNSUPPORTED_FORMAT" }));
  });

  test("rejects a track chunk that runs past the end of the file", () => {
    const data = smf(0, 480, [[0x00, 0x90, 60, 100, ...END]]);
    expect(() => parseMIDI(data.slice(0, data.length - 3))).toThrow(MIDIError);
  });

  test("rejects data that isn't a MIDI file", () => {
    expect(() => parseMIDI(new TextEncoder().encode("<score-partwise/>"))).toThrow(MIDIError);
  });
});
