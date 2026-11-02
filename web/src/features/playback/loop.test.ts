import { describe, expect, test } from "vitest";
import { loopLabel, loopRange, NO_LOOP, setLoopEnd, setLoopStart, toggleLoop } from "./loop";

const measures = [0, 1, 2, 3].map((i) => ({
  index: i,
  number: String(i + 1),
  startSeconds: i * 2,
  endSeconds: i * 2 + 2,
}));

describe("A-B loop", () => {
  test("A then B loops the measures in between, inclusive", () => {
    const loop = setLoopEnd(setLoopStart(NO_LOOP, 1), 2);
    expect(loopRange(loop, measures)).toEqual({
      startSeconds: 2,
      endSeconds: 6,
    });
    expect(loopLabel(loop, measures)).toBe("2–3小節");
  });

  test("a B before A swaps them; an A after B drags B along", () => {
    expect(setLoopEnd(setLoopStart(NO_LOOP, 2), 0)).toMatchObject({
      a: 0,
      b: 2,
    });
    expect(setLoopStart({ a: 0, b: 1, enabled: true }, 3)).toMatchObject({
      a: 3,
      b: 3,
    });
  });

  test("L with no range loops the current measure, then toggles it off and on", () => {
    const on = toggleLoop(NO_LOOP, 2);
    expect(loopRange(on, measures)).toEqual({ startSeconds: 4, endSeconds: 6 });
    const off = toggleLoop(on, 0);
    expect(loopRange(off, measures)).toBeNull();
    expect(loopLabel(off, measures)).toBe("3小節"); // the range is kept while off
    expect(toggleLoop(off, 0).enabled).toBe(true);
  });
});
