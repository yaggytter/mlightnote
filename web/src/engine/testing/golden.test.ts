import { describe, expect, test } from "vitest";
import { firstDifference, fixtures, goldenJSON, normalize } from "./golden";

describe("golden comparison harness", () => {
  const trio = fixtures().find((f) => f.source === "testdata/trio.musicxml")!;
  const golden = goldenJSON(trio, "canonical.json") as { Parts: { Measures: { Voices: { Events: { Pitch: { Octave: number } | null }[] }[] }[] }[] };

  test("the golden data is really loaded", () => {
    expect(golden.Parts).toHaveLength(3);
    expect(golden.Parts[0].Measures).toHaveLength(2);
  });

  test("a single changed pitch is detected", () => {
    const changed = structuredClone(golden);
    const note = changed.Parts[0].Measures[1].Voices[0].Events.find((e) => e.Pitch)!;
    note.Pitch!.Octave += 1;
    expect(firstDifference(normalize(changed), normalize(golden))).toMatch(/Octave/);
  });

  test("zero values and absent fields compare equal (Go omitempty)", () => {
    expect(firstDifference(normalize({ a: 0, b: [], c: null, d: 1 }), normalize({ d: 1 }))).toBeNull();
  });
});
