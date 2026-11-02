import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { sequentialIDs, setIDSource } from "../../domain/ids";
import type { CanonicalScore } from "../../domain/types";
import { firstLineDifference, fixtures, goldenJSON, goldenText, hasGolden } from "../../testing/golden";
import { generateDisplayXML } from "./generator";

let restore: () => void;
beforeEach(() => {
  restore = setIDSource(sequentialIDs());
});
afterEach(() => restore());

// Generated from the Go canonical model, so this checks the generator on
// its own — independent of the importers.
describe("display MusicXML matches the Go implementation", () => {
  test.each(fixtures().map((f) => [f.name, f]))("%s", (_name, f) => {
    const score = goldenJSON(f, "canonical.json") as CanonicalScore;
    expect(firstLineDifference(generateDisplayXML(score), goldenText(f, "display.xml"))).toBeNull();
    expect(firstLineDifference(generateDisplayXML(score, { concertPitch: true }), goldenText(f, "display-concert.xml"))).toBeNull();
    (score.Parts ?? []).forEach((p, i) => {
      if (!hasGolden(f, `display-part${i}.xml`)) return;
      expect(firstLineDifference(generateDisplayXML(score, { partIds: [p.ID] }), goldenText(f, `display-part${i}.xml`))).toBeNull();
    });
  });
});
