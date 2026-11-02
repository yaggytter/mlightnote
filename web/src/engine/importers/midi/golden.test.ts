import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { sequentialIDs, setIDSource } from "../../domain/ids";
import { firstDifference, fixtures, goldenJSON, normalize, sourceBytes } from "../../testing/golden";
import { parseMIDI } from "./smf";
import { transcribe } from "./transcribe";

const midiFixtures = fixtures().filter((f) => f.source.endsWith(".mid"));

let restore: () => void;
beforeEach(() => {
  restore = setIDSource(sequentialIDs());
});
afterEach(() => restore());

describe("MIDI transcription matches the Go implementation", () => {
  test("covers the MIDI fixture in testdata/", () => {
    expect(midiFixtures.map((f) => f.source)).toContain("testdata/synthetic.mid");
  });

  test.each(midiFixtures.map((f) => [f.name, f]))("%s", (_name, f) => {
    const { score, report } = transcribe(parseMIDI(sourceBytes(f)));
    if (!score.Metadata.Title) score.Metadata.Title = f.source.split("/").pop()!.replace(/\.[^.]+$/, "");

    expect(firstDifference(normalize(score), normalize(goldenJSON(f, "canonical.json")))).toBeNull();
    expect(firstDifference(normalize(report), normalize(goldenJSON(f, "report.json")))).toBeNull();
  });
});
