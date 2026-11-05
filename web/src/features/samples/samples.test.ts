import { describe, expect, test } from "vitest";
import { parseMIDI } from "../../engine/importers/midi/smf";
import { transcribe } from "../../engine/importers/midi/transcribe";
import { measureTicks, midiPitch, parseMeasure, parseToken } from "./notes";
import { sampleFile, sampleMidi } from "./smf";
import { SAMPLE_SONGS } from "./songs";

describe("sample notation", () => {
  test("reads pitch names as MIDI note numbers", () => {
    expect(midiPitch("C4")).toBe(60);
    expect(midiPitch("F#5")).toBe(78);
    expect(midiPitch("Bb3")).toBe(58);
    expect(midiPitch("A0")).toBe(21);
  });

  test("reads rests, chords, and dotted durations", () => {
    expect(parseToken("r:e")).toEqual({ pitches: [], ticks: 240 });
    expect(parseToken("G3+B3+D4:h")).toEqual({ pitches: [55, 59, 62], ticks: 960 });
    expect(parseToken("A4:q.")).toEqual({ pitches: [69], ticks: 720 });
  });

  test("rejects a malformed token instead of guessing", () => {
    expect(() => parseToken("H4:q")).toThrow("音名を読めません");
    expect(() => parseToken("C4:x")).toThrow("音価を読めません");
    expect(() => parseToken("C4")).toThrow("書式が違います");
  });
});

describe.each(SAMPLE_SONGS.map((s) => [s.title, s] as const))("%s", (_title, song) => {
  const ticksPerMeasure = measureTicks(song.beats, song.beatType);

  test("every measure of both hands fills its time signature exactly", () => {
    const [right, left] = song.tracks;
    expect(left.measures).toHaveLength(right.measures.length);
    for (const track of song.tracks) {
      track.measures.forEach((measure, i) => {
        const ticks = parseMeasure(measure).reduce((sum, t) => sum + t.ticks, 0);
        expect({ track: track.name, measure: i + 1, ticks }).toEqual({ track: track.name, measure: i + 1, ticks: ticksPerMeasure });
      });
    }
  });

  test("imports as one grand-staff piano part with its key, time, and length", () => {
    const { score } = transcribe(parseMIDI(sampleMidi(song)));

    const parts = score.Parts ?? [];
    expect(parts).toHaveLength(1);
    const measures = parts[0].Measures ?? [];
    expect(measures).toHaveLength(song.tracks[0].measures.length);
    const first = measures[0].AttributeChanges?.[0];
    expect(first?.Time).toEqual({ Beats: song.beats, BeatType: song.beatType });
    expect(first?.Key?.Fifths).toBe(song.keyFifths);
    expect(first?.StaffCount).toBe(2);
  });

  test("is offered as a .mid named after the song", () => {
    const file = sampleFile(song);
    expect(file.name).toBe(`${song.title}.mid`);
    expect(file.type).toBe("audio/midi");
  });
});
