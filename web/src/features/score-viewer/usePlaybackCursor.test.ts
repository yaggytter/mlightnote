import { describe, expect, test } from "vitest";
import { measureAt, type MeasureTiming } from "../../services/api/playback";
import { cursorPosition, measureIndexAtPoint, stepMeasure } from "./usePlaybackCursor";

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
