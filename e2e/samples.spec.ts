import { expect, test } from "@playwright/test";
import { trackExternalRequests, waitForScore } from "./helpers";

// The built-in sample songs (APP_DESIGN.md FR-IMP-005) need no files, so
// this runs everywhere, CI included.
test.describe("sample songs", () => {
  test("a first-time visitor can open a sample song and play it", async ({ page }) => {
    const external = trackExternalRequests(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "サンプル曲で試す" })).toBeVisible();
    await expect(page.locator(".samples__open")).toHaveCount(4);
    await page.getByRole("button", { name: /サンプル曲「メヌエット ト長調」/ }).click();
    await waitForScore(page);

    await expect(page.locator(".workspace__title")).toHaveText("メヌエット ト長調");
    const time = page.locator(".playback-controls__time");
    await expect(time).toHaveText("0:00 / 0:25"); // 16 measures of 3/4 at ♩=112
    await page.getByRole("button", { name: "再生" }).click();
    await expect(time).not.toHaveText(/^0:00 /, { timeout: 5_000 });
    await page.getByRole("button", { name: "一時停止" }).click();
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("each sample song opens as its own project", async ({ page }) => {
    for (const title of ["きらきら星", "歓喜の歌", "エリーゼのために"]) {
      await page.goto("/");
      await page.getByRole("button", { name: new RegExp(`サンプル曲「${title}」`) }).click();
      await waitForScore(page);
      await expect(page.locator(".workspace__title")).toHaveText(title);
    }
    await page.goto("/");
    await expect(page.locator(".library__title")).toContainText(["エリーゼのために", "歓喜の歌", "きらきら星"]);
  });
});
