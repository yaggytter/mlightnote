import { describe, expect, it } from "vitest";
import { clampZoom, ZOOM_MAX, ZOOM_MIN } from "./ViewToolbar";
import { pageFormatFor } from "../printing/PrintView";

describe("clampZoom", () => {
  it("keeps zoom within the 25%–400% range from APP_DESIGN.md §7.4", () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(clampZoom(1.1000000001)).toBe(1.1);
  });
});

describe("pageFormatFor", () => {
  it("maps paper and orientation to the renderer's page format", () => {
    expect(pageFormatFor("A4", "portrait")).toBe("A4_P");
    expect(pageFormatFor("Letter", "landscape")).toBe("Letter_L");
  });
});

import { partSelectionLabel, togglePart } from "./PartPicker";

describe("togglePart", () => {
  const all = ["a", "b", "c"];
  it("unchecking a part from the full score shows every other part", () => {
    expect(togglePart([], "b", all)).toEqual(["a", "c"]);
  });
  it("keeps score order and collapses all-or-nothing back to the full score", () => {
    expect(togglePart(["c"], "a", all)).toEqual(["a", "c"]);
    expect(togglePart(["a", "c"], "b", all)).toEqual([]);
    expect(togglePart(["a"], "a", all)).toEqual([]);
  });
  it("labels the selection", () => {
    const parts = all.map((id) => ({ id, name: id.toUpperCase() })) as never[];
    expect(partSelectionLabel([], parts)).toBe("フルスコア");
    expect(partSelectionLabel(["b"], parts)).toBe("B");
    expect(partSelectionLabel(["a", "b"], parts)).toBe("2パート");
  });
});

import { movePart } from "../editor/Inspector";

describe("movePart", () => {
  it("swaps with the neighbour and ignores moves past either end", () => {
    expect(movePart(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(movePart(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(movePart(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});
