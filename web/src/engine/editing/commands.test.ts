import { describe, expect, test } from "vitest";
import type { CanonicalScore } from "../domain/types";
import { applyCommand, EditError, isDirty, MAX_HISTORY, newState, redo, undo, ValidationError, type Command } from "./commands";

const score = {
  Metadata: {},
  Parts: [
    { ID: "fl", Name: "Flute", Instrument: { IsPercussion: false } },
    { ID: "dr", Name: "Drums", Instrument: { IsPercussion: true } },
  ],
} as unknown as CanonicalScore;

const cmd = (commandId: string, baseRevision: number, type: string, payload: unknown): Command => ({ commandId, baseRevision, type, payload });

describe("edit commands", () => {
  test("apply bumps the revision and marks the state dirty without touching the input", () => {
    const s0 = newState();
    const s1 = applyCommand(s0, score, cmd("c1", 1, "part.update", { partId: "fl", name: "Fl." }));
    expect(s1.revision).toBe(2);
    expect(isDirty(s1)).toBe(true);
    expect(s1.overlay.parts.fl.name).toBe("Fl.");
    expect(s0.revision).toBe(1);
    expect(s0.overlay.parts.fl).toBeUndefined();
  });

  test("a stale base revision is a conflict", () => {
    const s1 = applyCommand(newState(), score, cmd("c1", 1, "score.updateMetadata", { title: "A" }));
    expect(() => applyCommand(s1, score, cmd("c2", 1, "score.updateMetadata", { title: "B" }))).toThrow(EditError);
  });

  test("retrying a command is a no-op; reusing its id with another payload is rejected", () => {
    const c = cmd("c1", 1, "score.updateMetadata", { title: "A" });
    const s1 = applyCommand(newState(), score, c);
    expect(applyCommand(s1, score, c)).toBe(s1);
    expect(() => applyCommand(s1, score, { ...c, payload: { title: "B" } })).toThrow(/reused/);
  });

  test.each([
    ["unknown field", "part.update", { partId: "fl", colour: "red" }, "payload"],
    ["wrong type", "part.update", { partId: "fl", volume: "loud" }, "payload"],
    ["non-integer program", "part.update", { partId: "fl", program: 1.5 }, "payload"],
    ["unknown part", "part.update", { partId: "zz", name: "x" }, "partId"],
    ["empty name", "part.update", { partId: "fl", name: "" }, "name"],
    ["program out of range", "part.update", { partId: "fl", program: 128 }, "program"],
    ["pan out of range", "part.update", { partId: "fl", pan: 2 }, "pan"],
    ["transpose out of range", "part.update", { partId: "fl", transpose: { chromatic: 40 } }, "transpose"],
    ["transposing drums", "part.update", { partId: "dr", transpose: { diatonic: -1, chromatic: -2 } }, "transpose"],
    ["text too long", "score.updateMetadata", { title: "あ".repeat(501) }, "title"],
    ["reorder missing a part", "part.reorder", { partIds: ["fl"] }, "partIds"],
    ["reorder with a duplicate", "part.reorder", { partIds: ["fl", "fl"] }, "partIds"],
    ["unknown command", "part.delete", {}, "type"],
  ])("rejects %s", (_label, type, payload, field) => {
    try {
      applyCommand(newState(), score, cmd("c", 1, type, payload));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).field).toBe(field);
    }
  });

  test("undo and redo restore snapshots and bump the revision", () => {
    let s = applyCommand(newState(), score, cmd("c1", 1, "score.updateMetadata", { title: "A" }));
    s = undo(s, s.revision);
    expect(s.overlay.metadata.title).toBeUndefined();
    s = redo(s, s.revision);
    expect(s.overlay.metadata.title).toBe("A");
    expect(s.revision).toBe(4);
    expect(() => redo(s, s.revision)).toThrow(/nothing to redo/);
  });

  test("a new command clears redo, and history is capped", () => {
    let s = newState();
    for (let i = 0; i < MAX_HISTORY + 5; i++) s = applyCommand(s, score, cmd(`c${i}`, s.revision, "score.updateMetadata", { title: String(i) }));
    expect(s.undo).toHaveLength(MAX_HISTORY);
    s = undo(s, s.revision);
    s = applyCommand(s, score, cmd("new", s.revision, "score.updateMetadata", { title: "x" }));
    expect(s.redo).toBeNull();
  });
});

describe("part.updateMany (mixer bulk actions)", () => {
  test("updates several parts as one undo step", () => {
    const s0 = applyCommand(newState(), score, cmd("c1", 1, "part.update", { partId: "fl", muted: true, volume: 0.3 }));
    const s1 = applyCommand(s0, score, cmd("c2", 2, "part.updateMany", { updates: [{ partId: "fl", muted: false, volume: 0.8 }, { partId: "dr", solo: false, pan: 0 }] }));
    expect(s1.overlay.parts.fl).toMatchObject({ muted: false, volume: 0.8 });
    expect(s1.overlay.parts.dr).toMatchObject({ solo: false, pan: 0 });

    const back = undo(s1, s1.revision);
    expect(back.overlay.parts.fl).toMatchObject({ muted: true, volume: 0.3 });
    expect(back.overlay.parts.dr).toBeUndefined();
  });

  test("is all-or-nothing: one invalid update rejects the whole command", () => {
    const s0 = newState();
    expect(() => applyCommand(s0, score, cmd("c1", 1, "part.updateMany", { updates: [{ partId: "fl", volume: 0.5 }, { partId: "dr", volume: 2 }] }))).toThrow(ValidationError);
    expect(s0.overlay.parts.fl).toBeUndefined();
  });

  test.each([
    ["no updates", { updates: [] }],
    ["unknown part", { updates: [{ partId: "zz", muted: true }] }],
    ["a part twice", { updates: [{ partId: "fl", muted: true }, { partId: "fl", solo: true }] }],
    ["not a list", { updates: { partId: "fl" } }],
    ["unknown field", { updates: [{ partId: "fl" }], extra: 1 }],
  ])("rejects %s", (_name, payload) => {
    expect(() => applyCommand(newState(), score, cmd("c1", 1, "part.updateMany", payload))).toThrow(ValidationError);
  });
});
