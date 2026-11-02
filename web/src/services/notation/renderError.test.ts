import { describe, expect, test } from "vitest";
import { describeRenderError } from "./renderError";

describe("describeRenderError", () => {
  test("shows the engine's reason from a thrown plain object", () => {
    expect(describeRenderError({ code: "BadArguments", message: "Beams can only be applied to notes shorter than a quarter note." })).toBe(
      "楽譜を描画できませんでした（描画エンジンのエラー：BadArguments: Beams can only be applied to notes shorter than a quarter note.）。",
    );
  });
  test("uses Error messages and strings as they are", () => {
    expect(describeRenderError(new Error("boom"))).toContain("boom");
    expect(describeRenderError("bad xml")).toContain("bad xml");
  });
  test("falls back to a plain message when nothing useful was thrown", () => {
    expect(describeRenderError({})).toBe("楽譜を描画できませんでした。");
    expect(describeRenderError(undefined)).toBe("楽譜を描画できませんでした。");
  });
});
