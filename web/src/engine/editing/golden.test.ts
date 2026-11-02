import { describe, expect, test } from "vitest";
import type { CanonicalScore } from "../domain/types";
import { applyOverlay } from "../domain/overlay";
import { generateDisplayXML } from "../exporters/displayxml/generator";
import { generatePlan } from "../playback/plan";
import { firstDifference, firstLineDifference, fixtures, goldenJSON, goldenText, hasGolden, normalize } from "../testing/golden";
import { applyCommand, newState, redo, undo, type Command, type State } from "./commands";

function withoutHashes(s: unknown): unknown {
  const st = structuredClone(s) as State;
  for (const rec of Object.values(st.commands ?? {})) rec.payloadHash = "";
  return st;
}

describe("the Go edit script replays to the same state and output", () => {
  test.each(fixtures().map((f) => [f.name, f]))("%s", (_name, f) => {
    const score = goldenJSON(f, "canonical.json") as CanonicalScore;
    let state = newState();
    for (const cmd of goldenJSON(f, "edit-commands.json") as Command[]) state = applyCommand(state, score, cmd);
    state = redo(undo(state, state.revision), state.revision + 1);
    expect(firstDifference(normalize(withoutHashes(state)), normalize(withoutHashes(goldenJSON(f, "edit-state.json"))))).toBeNull();

    const edited = applyOverlay(state.overlay, score);
    expect(firstLineDifference(generateDisplayXML(edited), goldenText(f, "edited-display.xml"))).toBeNull();
    expect(firstLineDifference(generateDisplayXML(edited, { concertPitch: true }), goldenText(f, "edited-display-concert.xml"))).toBeNull();
    (edited.Parts ?? []).forEach((p, i) => {
      if (hasGolden(f, `edited-display-part${i}.xml`)) {
        expect(firstLineDifference(generateDisplayXML(edited, { partIds: [p.ID] }), goldenText(f, `edited-display-part${i}.xml`))).toBeNull();
      }
    });
    expect(firstDifference(normalize(generatePlan(edited)), normalize(goldenJSON(f, "edited-plan.json")))).toBeNull();
  });
});
