import { describe, expect, test } from "vitest";
import { presetIdFor, suggestedPreset, TRANSPOSITION_PRESETS } from "./transpositions";

describe("transposition presets", () => {
  test("every preset is distinct", () => {
    const keys = TRANSPOSITION_PRESETS.map((p) => JSON.stringify(p.transpose));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("matches a transposition to its preset, or reports custom", () => {
    expect(presetIdFor({ diatonic: -1, chromatic: -2, octaveChange: 0 })).toBe("Bb");
    expect(presetIdFor({ diatonic: 0, chromatic: 0, octaveChange: 0 })).toBe("C");
    expect(presetIdFor({ diatonic: -6, chromatic: -11, octaveChange: 0 })).toBe("custom");
  });

  test("suggests what players of an instrument usually read", () => {
    expect(suggestedPreset(71)?.id).toBe("Bb"); // clarinet
    expect(suggestedPreset(65)?.id).toBe("Eb"); // alto sax
    expect(suggestedPreset(60)?.id).toBe("F"); // horn
    expect(suggestedPreset(33)?.id).toBe("8vb"); // electric bass
    expect(suggestedPreset(0)).toBeUndefined(); // piano
  });
});
