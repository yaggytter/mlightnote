import { expect, test } from "@playwright/test";
import path from "node:path";

// Smoke test of the running site (`make deploy`): the production build
// behind nginx, with its CSP — which the dev-server E2E suite can't
// exercise (e.g. loading the engine Worker).
// A score from testdata/ (in the repository), so the smoke test always runs.
const SCORE = path.resolve(__dirname, "..", "testdata", "trio.musicxml");

test("the deployed app imports, renders, and plays a score with no errors", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });

  // "./" so that a base URL with a path (the public site) is kept.
  await page.goto("./");
  await expect(page.getByText("使い方マニュアル")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(SCORE);
  await expect
    .poll(() => page.evaluate(() => document.querySelector(".score-viewer__canvas svg")?.querySelectorAll("path").length ?? 0), { timeout: 45_000 })
    .toBeGreaterThan(100);
  await page.getByRole("button", { name: "再生" }).click();
  await expect(page.locator(".playback-controls__time")).not.toHaveText(/^0:00 /, { timeout: 5_000 });
  await page.getByRole("button", { name: "一時停止" }).click();

  // Stored in the browser (the engine Worker's IndexedDB): still listed after a reload.
  await page.getByRole("button", { name: "閉じる" }).click();
  await page.reload();
  await expect(page.locator(".library__item").first()).toBeVisible();

  expect(problems).toEqual([]);
});

test("the build ships the third-party licence notices", async ({ request }) => {
  // Relative to the base URL, like the link in the in-app manual.
  const response = await request.get("third-party-licenses.txt");
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text).toContain("opensheetmusicdisplay");
  expect(text).toContain("vexflow");
});
