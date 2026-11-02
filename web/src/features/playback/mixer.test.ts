import { describe, expect, it } from "vitest";
import type { PartMix } from "../../services/api/playback";
import { applyDraft, DEFAULT_VOLUME, meterFraction, panLabel, resetAll, unmuteAll, unsoloAll, volumeDb } from "./mixer";

const mix = (partId: string, patch: Partial<PartMix> = {}): PartMix => ({ partId, program: 0, volume: DEFAULT_VOLUME, pan: 0, muted: false, solo: false, ...patch });

describe("mixer", () => {
  it("overlays a draft without changing the stored mix", () => {
    const stored = [mix("a"), mix("b")];
    const shown = applyDraft(stored, { b: { volume: 0.2 } });
    expect(shown[1].volume).toBe(0.2);
    expect(shown[0]).toBe(stored[0]);
    expect(stored[1].volume).toBe(DEFAULT_VOLUME);
  });

  it("bulk actions touch only the parts that need it", () => {
    const mixes = [mix("a", { muted: true }), mix("b", { solo: true }), mix("c", { pan: 0.5 }), mix("d")];
    expect(unmuteAll(mixes)).toEqual([{ partId: "a", muted: false }]);
    expect(unsoloAll(mixes)).toEqual([{ partId: "b", solo: false }]);
    expect(resetAll(mixes).map((u) => u.partId)).toEqual(["a", "b", "c"]);
    expect(resetAll([mix("d")])).toEqual([]);
  });

  it("meters on a decibel scale", () => {
    expect(meterFraction(0)).toBe(0);
    expect(meterFraction(1)).toBe(1);
    expect(meterFraction(2)).toBe(1);
    expect(meterFraction(0.5)).toBeCloseTo(1 - 6.02 / 48, 2);
    expect(meterFraction(0.0001)).toBe(0);
  });

  it("labels volume in dB and pan by side", () => {
    expect(volumeDb(1)).toBe("0.0 dB");
    expect(volumeDb(0.5)).toBe("−6.0 dB");
    expect(volumeDb(0)).toBe("−∞ dB");
    expect(panLabel(0)).toBe("C");
    expect(panLabel(-0.25)).toBe("L25");
    expect(panLabel(1)).toBe("R100");
  });
});
