import { describe, expect, test } from "vitest";
import type { CanonicalScore } from "../domain/types";
import { firstDifference, fixtures, goldenJSON, normalize } from "../testing/golden";
import { generatePlan } from "./plan";

describe("playback plan matches the Go implementation", () => {
  test.each(fixtures().map((f) => [f.name, f]))("%s", (_name, f) => {
    const plan = generatePlan(goldenJSON(f, "canonical.json") as CanonicalScore);
    expect(firstDifference(normalize(plan), normalize(goldenJSON(f, "plan.json")))).toBeNull();
  });
});

describe("dynamics lookup", () => {
  test("a dynamics mark named like an Object property is not a known level", () => {
    const score = {
      Metadata: {},
      PartGroups: null,
      Parts: [
        {
          ID: "p",
          Instrument: { Transpose: { diatonic: 0, chromatic: 0, octaveChange: 0 } },
          Measures: [
            {
              Index: 0,
              Number: "1",
              Navigation: {},
              Directions: [{ Type: "dynamics", Text: "toString", Start: { numerator: 0, denominator: 1 } }],
              Voices: [{ Staff: 1, Events: [{ Kind: 0, Staff: 1, Start: { numerator: 0, denominator: 1 }, Duration: { numerator: 4, denominator: 1 }, Pitch: { Step: "C", Alter: 0, Octave: 4 } }] }],
            },
          ],
        },
      ],
    } as unknown as CanonicalScore;
    expect(generatePlan(score).events?.[0].velocity).toBe(80);
  });
});
