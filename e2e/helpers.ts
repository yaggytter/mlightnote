import { expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Real-world songs for the tests that need long, dense scores. They are not
// in the repository (copyright): put them in samplefiles/ or point
// MLIGHTNOTE_SAMPLES_DIR at them; without them those tests are skipped.
const SAMPLE_DIR = process.env.MLIGHTNOTE_SAMPLES_DIR ?? path.resolve(__dirname, "..", "samplefiles");

/** Finds a sample by extension; the on-disk names are NFD-normalized. */
export function sample(ext: string, contains = ""): string | null {
  if (!fs.existsSync(SAMPLE_DIR)) return null;
  const f = fs.readdirSync(SAMPLE_DIR).find((n) => n.endsWith(ext) && n.includes(contains));
  return f ? path.join(SAMPLE_DIR, f) : null;
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
