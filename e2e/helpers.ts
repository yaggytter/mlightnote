import { expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Real-world songs for the tests that need long, dense scores. They are not
// in the repository (copyright): put them in samplefiles/ or point
// MLIGHTNOTE_SAMPLES_DIR at them; without them those tests are skipped.
// The tests check details of the maintainer's own files (length, tempo,
// part count), so other songs under these names will not pass them.
const SAMPLE_DIR = process.env.MLIGHTNOTE_SAMPLES_DIR ?? path.resolve(__dirname, "..", "samplefiles");

/**
 * The sample files, by role:
 * - score.xml: a long MusicXML song (165 measures, ♩=132, a chord symbol with
 *   an added 9th, an empty part-name, a subtitle)
 * - score.mid: the same song as MIDI (two tracks, ♩=132 from a tempo event)
 * - band.mid: a Format 0 band MIDI with 12 channels, one of them drums
 */
export type SampleName = "score.xml" | "score.mid" | "band.mid";

/** The path of a sample file, or null when it is not there. */
export function sample(name: SampleName): string | null {
  const file = path.join(SAMPLE_DIR, name);
  return fs.existsSync(file) ? file : null;
}

export async function importFile(page: Page, file: string): Promise<void> {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(file);
  await waitForScore(page);
}

export async function waitForScore(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.querySelector(".score-viewer__canvas svg")?.querySelectorAll("path").length ?? 0), { timeout: 45_000 })
    .toBeGreaterThan(30); // staff lines, clefs, and noteheads: enough to be real notation
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Records every request to a host other than localhost (§17.4, §19.3-7). */
export function trackExternalRequests(page: Page): string[] {
  const external: string[] = [];
  page.on("request", (req) => {
    const { hostname, protocol } = new URL(req.url());
    if ((protocol === "http:" || protocol === "https:") && !LOOPBACK.has(hostname)) {
      external.push(req.url());
    }
  });
  return external;
}
