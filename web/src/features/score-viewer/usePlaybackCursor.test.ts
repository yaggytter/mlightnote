import { describe, expect, test } from "vitest";
import { measureAt, type MeasureTiming } from "../../services/api/playback";
import { cursorPosition, FOLLOW_GAP_PX, followScrollTop, headroomAbove, measureIndexAtPoint, stepMeasure } from "./usePlaybackCursor";

const measures: MeasureTiming[] = [
  { index: 0, number: "1", startSeconds: 0, endSeconds: 2 },
  { index: 1, number: "2", startSeconds: 2, endSeconds: 4 },
  { index: 2, number: "3", startSeconds: 4, endSeconds: 6 },
];
const rects = [
  { x: 0, y: 0, width: 100, height: 50 },
  { x: 100, y: 0, width: 200, height: 50 },
  { x: 0, y: 80, width: 100, height: 50 },
];

describe("measureAt", () => {
  test("finds the sounding measure and clamps past the end", () => {
    expect(measureAt(measures, 0)).toBe(0);
    expect(measureAt(measures, 2)).toBe(1);
    expect(measureAt(measures, 5.9)).toBe(2);
    expect(measureAt(measures, 99)).toBe(2);
    expect(measureAt([], 1)).toBe(-1);
  });
});

describe("cursorPosition", () => {
  test("interpolates x across the measure by elapsed time", () => {
    const pos = cursorPosition(measures, rects, 3);
    expect(pos?.index).toBe(1);
    expect(pos?.x).toBe(200);
  });

  test("moves to the next system's box", () => {
    expect(cursorPosition(measures, rects, 4)?.rect.y).toBe(80);
  });

  test("returns null before the score has been laid out", () => {
    expect(cursorPosition(measures, [], 1)).toBeNull();
  });
});

describe("measureIndexAtPoint", () => {
  test("hits the box under the point, misses the gap between systems", () => {
    expect(measureIndexAtPoint(rects, 150, 10)).toBe(1);
    expect(measureIndexAtPoint(rects, 50, 90)).toBe(2);
    expect(measureIndexAtPoint(rects, 50, 65)).toBe(-1);
  });
});

describe("stepMeasure", () => {
  test("→ goes to the next measure, stopping at the last", () => {
    expect(stepMeasure(measures, 1, 1)).toBe(1);
    expect(stepMeasure(measures, 5, 1)).toBe(2);
  });

  test("← restarts the current measure, or goes back when already at its start", () => {
    expect(stepMeasure(measures, 3, -1)).toBe(1);
    expect(stepMeasure(measures, 2.1, -1)).toBe(0);
    expect(stepMeasure(measures, 0, -1)).toBe(0);
  });
});

describe("followScrollTop", () => {
  // The scroller shows 0–800; a toolbar covers 0–50 and the transport 700–800.
  const visible = { top: 50, bottom: 700 };

  test("leaves the view alone while the measure is fully in the clear band", () => {
    expect(followScrollTop({ top: 60, bottom: 690 }, visible, 1000)).toBeNull();
  });

  test("brings the next system up to just under the toolbar, not a third of the way down", () => {
    // A system that runs under the transport is scrolled so its top sits a
    // small gap below the toolbar: the whole clear band shows what comes next.
    expect(followScrollTop({ top: 600, bottom: 800 }, visible, 1000)).toBe(1000 + 600 - 50 - FOLLOW_GAP_PX);
  });

  test("a measure hidden under the toolbar counts as out of view", () => {
    expect(followScrollTop({ top: 20, bottom: 200 }, visible, 1000)).toBe(1000 + 20 - 50 - FOLLOW_GAP_PX);
  });

  test("a system taller than the band stays put once its top is aligned", () => {
    const top = visible.top + FOLLOW_GAP_PX;
    expect(followScrollTop({ top, bottom: top + 2000 }, visible, 1000)).toBeNull();
  });

  test("never scrolls above the start", () => {
    expect(followScrollTop({ top: -100, bottom: 0 }, visible, 30)).toBe(0);
  });
});

describe("headroomAbove", () => {
  // Two systems: 100–200 and 300–420 (the second starts with chord names above it).
  const systems = [
    { x: 0, y: 100, width: 300, height: 100 },
    { x: 300, y: 100, width: 300, height: 100 },
    { x: 0, y: 300, width: 300, height: 120 },
  ];

  test("keeps the space up to the previous system", () => {
    expect(headroomAbove(systems, systems[2], 500)).toBe(100);
  });

  test("measures the first system from the top, capped", () => {
    expect(headroomAbove(systems, systems[0], 500)).toBe(100);
    expect(headroomAbove(systems, systems[0], 40)).toBe(40);
  });

  test("ignores measures on the same system and empty boxes", () => {
    const withEmpty = [...systems, { x: 0, y: 0, width: 0, height: 0 }];
    expect(headroomAbove(withEmpty, systems[1], 500)).toBe(100);
  });
});
