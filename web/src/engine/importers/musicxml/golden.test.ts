import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { sequentialIDs, setIDSource } from "../../domain/ids";
import { decodeXMLBytes } from "../../xml/tree";
import { firstDifference, fixtures, goldenJSON, normalize, sourceBytes } from "../../testing/golden";
import { extractMXL, looksLikeMXL } from "./mxl";
import { parseMusicXML } from "./parser";

const xmlFixtures = fixtures().filter((f) => !f.source.endsWith(".mid"));

let restore: () => void;
beforeEach(() => {
  restore = setIDSource(sequentialIDs());
});
afterEach(() => restore());

describe("MusicXML import matches the Go implementation", () => {
  test.each(xmlFixtures.map((f) => [f.name, f]))("%s", (_name, f) => {
    let data = sourceBytes(f);
    if (looksLikeMXL(data)) data = extractMXL(data);
    const { score, report } = parseMusicXML(decodeXMLBytes(data));
    if (!score.Metadata.Title) score.Metadata.Title = f.source.split("/").pop()!.replace(/\.[^.]+$/, "");

    expect(firstDifference(normalize(score), normalize(goldenJSON(f, "canonical.json")))).toBeNull();
    expect(firstDifference(normalize(report), normalize(goldenJSON(f, "report.json")))).toBeNull();
  });
});
