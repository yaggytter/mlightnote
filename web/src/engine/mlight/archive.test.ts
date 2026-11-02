import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { describe, expect, test } from "vitest";
import { emptyOverlay } from "../domain/overlay";
import { firstDifference, fixtures, goldenJSON, goldenRaw, normalize, sourceBytes } from "../testing/golden";
import { sha256Hex } from "../util/sha256";
import { looksLikeMlight, MlightError, readMlight, writeMlight, type MlightPackage } from "./archive";

const withPackages = fixtures().filter((f) => goldenRaw(f, "package.mlight"));

describe("reading .mlight files written by the Go version", () => {
  test("golden packages exist", () => {
    expect(withPackages.length).toBeGreaterThanOrEqual(3);
  });

  test.each(withPackages.map((f) => [f.name, f]))("%s", (_name, f) => {
    const data = goldenRaw(f, "package.mlight")!;
    expect(looksLikeMlight(data)).toBe(true);

    const pkg = readMlight(data);

    const state = goldenJSON(f, "edit-state.json") as { revision: number; overlay: unknown };
    expect(firstDifference(normalize(pkg.score), normalize(goldenJSON(f, "canonical.json")))).toBeNull();
    expect(firstDifference(normalize(pkg.overlay), normalize(state.overlay))).toBeNull();
    expect(firstDifference(normalize(pkg.report), normalize(goldenJSON(f, "report.json")))).toBeNull();
    expect(pkg.revision).toBe(state.revision);
    expect(pkg.createdAt).toBe("2026-09-25T00:00:00Z");
    expect(sha256Hex(pkg.source.data)).toBe(sha256Hex(sourceBytes(f)));
  });
});

function samplePackage(): MlightPackage {
  return {
    projectId: "p1",
    revision: 3,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T01:00:00.000Z",
    score: { Metadata: { Title: "T", Subtitle: "", Movement: "", Composer: "", Arranger: "", Lyricist: "", Copyright: "", Software: "", EncodingDate: "" }, PartGroups: null, Parts: null },
    overlay: { ...emptyOverlay(), metadata: { title: "Edited" } },
    report: { Warnings: null },
    source: { id: "source-1", filename: "a.musicxml", mediaType: "application/vnd.recordare.musicxml+xml", data: strToU8("<score-partwise/>") },
    extra: new Map([["extensions/future.json", strToU8("{}")]]),
  };
}

/** Rebuilds a written package with one change, keeping entry order. */
function rezip(data: Uint8Array, change: (files: Record<string, Uint8Array>) => Record<string, Uint8Array>): Uint8Array {
  const files = change(unzipSync(data));
  const input: Zippable = {};
  for (const [name, bytes] of Object.entries(files)) input[name] = [bytes, { level: name === "mimetype" ? 0 : 6 }];
  return zipSync(input);
}

const expectKind = (fn: () => unknown, kind: string) => expect(fn).toThrow(expect.objectContaining({ kind }));

describe("writeMlight / readMlight", () => {
  test("round-trips every field, including unknown optional entries", () => {
    const pkg = samplePackage();

    const back = readMlight(writeMlight(pkg));

    expect(back.projectId).toBe("p1");
    expect(back.revision).toBe(3);
    expect(back.overlay.metadata.title).toBe("Edited");
    expect(new TextDecoder().decode(back.source.data)).toBe("<score-partwise/>");
    expect([...back.extra.keys()]).toEqual(["extensions/future.json"]);
  });

  test("is deterministic and starts with an uncompressed mimetype", () => {
    const a = writeMlight(samplePackage());
    expect(writeMlight(samplePackage())).toEqual(a);
    expect(new TextDecoder().decode(a.subarray(30, 38))).toBe("mimetype");
  });

  test("rejects a tampered entry", () => {
    const data = rezip(writeMlight(samplePackage()), (f) => ({ ...f, "score/canonical-score.json": strToU8('{"Parts":[]}') }));
    expectKind(() => readMlight(data), "CORRUPT");
  });

  test("rejects an undeclared entry", () => {
    const data = rezip(writeMlight(samplePackage()), (f) => ({ ...f, "extra.bin": strToU8("x") }));
    expectKind(() => readMlight(data), "CORRUPT");
  });

  test.each(["../evil.json", "a/./b", "dir/", "trailing.", "C:/x"])("rejects the unsafe path %s", (name) => {
    const data = rezip(writeMlight(samplePackage()), (f) => ({ ...f, [name]: strToU8("x") }));
    expect(() => readMlight(data)).toThrow(MlightError);
  });

  test("rejects a package from a newer major version", () => {
    const data = rezip(writeMlight(samplePackage()), (f) => {
      const m = JSON.parse(new TextDecoder().decode(f["manifest.json"]));
      return { ...f, "manifest.json": strToU8(JSON.stringify({ ...m, schemaVersion: "2.0.0" })) };
    });
    expectKind(() => readMlight(data), "NEWER_VERSION");
  });

  test("rejects a manifest with unknown fields", () => {
    const data = rezip(writeMlight(samplePackage()), (f) => {
      const m = JSON.parse(new TextDecoder().decode(f["manifest.json"]));
      return { ...f, "manifest.json": strToU8(JSON.stringify({ ...m, surprise: true })) };
    });
    expectKind(() => readMlight(data), "CORRUPT");
  });

  test("rejects a ZIP whose first entry isn't the stored mimetype", () => {
    const data = zipSync({ "manifest.json": strToU8("{}"), mimetype: strToU8("application/vnd.mlightnote.project+zip") });
    expectKind(() => readMlight(data), "NOT_MLIGHT");
    expect(looksLikeMlight(data)).toBe(false);
  });

  test("rejects an archive over the size limit before inflating it", () => {
    const data = writeMlight(samplePackage());
    expectKind(() => readMlight(data, { maxEntries: 1000, maxUncompressed: 100, maxRatio: 200 }), "LIMIT_EXCEEDED");
  });
});
