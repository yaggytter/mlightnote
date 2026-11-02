import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { importFile, sample, trackExternalRequests, waitForScore } from "./helpers";

const xml = sample("score.xml");
const mid = sample("score.mid");

test.describe("MusicXML score", () => {
  test.skip(!xml, "samplefiles/score.xml not present");

  test("renders real notation with chord symbols and makes no external requests", async ({ page }) => {
    const external = trackExternalRequests(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await importFile(page, xml!);

    const texts = await page.locator(".score-viewer__canvas svg text").allTextContents();
    expect(texts).toContain("E(9)"); // chord extension from <degree>
    expect(texts).toContain("パート 1"); // readable fallback for an empty part-name
    await page.locator(".part-picker summary").click();
    await expect(page.locator(".part-picker__menu label")).toContainText(["フルスコア（全パート）", "パート 1"]);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("plays, then Shift+Space stops back at zero", async ({ page }) => {
    await importFile(page, xml!);
    const time = page.locator(".playback-controls__time");
    await expect(time).toHaveText("0:00 / 5:00"); // 660 beats at ♩=132

    await page.getByRole("button", { name: "再生" }).click();
    await expect(time).not.toHaveText(/^0:00 /, { timeout: 5_000 });
    await expect(page.getByRole("button", { name: "一時停止" })).toBeVisible();

    await page.keyboard.press("Shift+Space");
    await expect(time).toHaveText("0:00 / 5:00");
  });

  test("print output has exactly as many pages as the preview", async ({ page }) => {
    await importFile(page, xml!);
    await page.getByRole("button", { name: "印刷…" }).click();
    await expect(page.getByRole("button", { name: "印刷", exact: true })).toBeEnabled({ timeout: 45_000 });

    const previewPages = await page.locator(".print-view__pages svg").count();
    const pdf = await page.pdf({ preferCSSPageSize: true });
    const pdfPages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

    expect(previewPages).toBeGreaterThan(1);
    expect(pdfPages).toBe(previewPages);
  });
});

test.describe("Format 0 band MIDI", () => {
  const band = sample("band.mid");
  test.skip(!band, "samplefiles/band.mid not present");

  test("splits into one part per channel and renders", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await importFile(page, band!);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.locator(".part-picker summary").click();
    await expect(page.locator(".part-picker__menu label")).toHaveCount(13); // full score + 12 channels
    await expect(page.locator(".part-picker__menu label", { hasText: "ドラム" })).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});

test.describe("MIDI score", () => {
  test.skip(!mid, "samplefiles/score.mid not present");

  test("transcribes to a grand staff and plays at the file's tempo", async ({ page }) => {
    await importFile(page, mid!);
    await expect(page.locator(".playback-controls__time")).toHaveText("0:00 / 5:00");
    const texts = await page.locator(".score-viewer__canvas svg text").allTextContents();
    expect(texts.some((t) => t.includes("132"))).toBe(true); // tempo mark from the FF51 meta event
  });

  test("playback cursor follows the audio and seeks by measure", async ({ page }, testInfo) => {
    await importFile(page, mid!);
    const cursor = page.getByTestId("score-cursor");
    await expect(cursor).toHaveAttribute("data-measure", "1");

    // ←/→ step by measure; the cursor jumps to that measure's start.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(cursor).toHaveAttribute("data-measure", "3");
    await expect(page.locator(".playback-controls__time")).toHaveText("0:03 / 5:00"); // 2 bars of 4/4 at ♩=132
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(cursor).toHaveAttribute("data-measure", "1");

    // While playing, the cursor moves across the measure.
    const x = () => cursor.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
    const before = await x();
    await page.getByRole("button", { name: "再生" }).click();
    await expect.poll(x, { timeout: 5_000 }).toBeGreaterThan(before + 20);
    await page.getByRole("button", { name: "一時停止" }).click();
    await page.screenshot({ path: testInfo.outputPath("cursor.png") });

    // Clicking a measure seeks to its start.
    const box = await page.locator(".score-cursor__measure").boundingBox();
    await page.mouse.click(box!.x + box!.width + 40, box!.y + box!.height / 2);
    await expect(cursor).toHaveAttribute("data-measure", "2");
    await expect(page.locator(".playback-controls__time")).toHaveText("0:01 / 5:00");
  });

  test("follow mode scrolls a late measure into view, and the cursor tracks zoom", async ({ page }, testInfo) => {
    await importFile(page, mid!);
    await page.getByRole("button", { name: "拡大" }).click();
    await page.locator(".playback-controls__seek").fill("200");
    await page.getByRole("button", { name: "再生" }).click();
    const highlight = page.locator(".score-cursor__measure");
    const onScreen = async () => {
      const box = await highlight.boundingBox();
      return box !== null && box.y >= 0 && box.y + box.height <= 1000;
    };
    await expect.poll(onScreen, { timeout: 5_000 }).toBe(true);
    await page.getByRole("button", { name: "一時停止" }).click();
    await page.screenshot({ path: testInfo.outputPath("follow.png") });
  });
});

test.describe("multiple parts", () => {
  const trio = path.join(__dirname, "..", "testdata", "trio.musicxml");

  test("labels every part beside the score, and abbreviates it on later systems", async ({ page }) => {
    await importFile(page, trio);
    await expect(page.locator(".staff-labels__label")).toHaveText(["Flute", "Clarinet in B♭", "Cello"]);
    // Zoomed in, the score wraps onto more systems; those use abbreviations.
    for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "拡大" }).click();
    await expect.poll(() => page.locator(".score-viewer__canvas svg text").allTextContents()).toEqual(
      expect.arrayContaining(["Fl.", "Cl. in B♭", "Vc."]),
    );
    await page.getByText("パート名ラベル").click();
    await expect(page.locator(".staff-labels__label")).toHaveCount(0);
  });

  test("a part can be written for a transposing instrument", async ({ page }) => {
    await importFile(page, trio);
    // Match by the card heading: every card's sound menu also lists "Flute" etc.
    const card = (name: string) => page.locator(".inspector__part").filter({ has: page.locator("legend", { hasText: new RegExp(`^${name}$`) }) });
    const flute = card("Flute");
    const clarinet = card("Clarinet in B♭");
    // The clarinet's transposition comes from the file and maps to the B♭ preset.
    await expect(clarinet.getByLabel("移調（記譜）")).toHaveValue("Bb");

    // The written-pitch XML itself is checked by the engine's service tests.
    await flute.getByLabel("移調（記譜）").selectOption("Bb");
    await expect(flute.getByLabel("移調（記譜）")).toHaveValue("Bb");
    await expect(page.locator(".workspace__status")).toHaveText("未保存の変更あり");
    await waitForScore(page);

    await page.keyboard.press("Control+z");
    await expect(flute.getByLabel("移調（記譜）")).toHaveValue("C");
  });

  test("shows any chosen set of parts", async ({ page }) => {
    await importFile(page, trio);
    const partNames = () => page.locator(".score-viewer__canvas svg text").allTextContents();
    expect(await partNames()).toEqual(expect.arrayContaining(["Flute", "Clarinet in B♭", "Cello"]));

    await page.locator(".part-picker summary").click();
    await page.getByRole("checkbox", { name: "Clarinet in B♭" }).uncheck();
    await expect(page.locator(".part-picker summary")).toHaveText("表示パート: 2パート");
    await expect.poll(async () => (await partNames()).includes("Clarinet in B♭")).toBe(false);
    expect(await partNames()).toEqual(expect.arrayContaining(["Flute", "Cello"]));

    await page.getByRole("checkbox", { name: "フルスコア（全パート）" }).check();
    await expect(page.locator(".part-picker summary")).toHaveText("表示パート: フルスコア");
  });

  test("reordering and hiding parts changes the full score; undo restores it", async ({ page }) => {
    await importFile(page, trio);
    const partNames = async () => {
      const texts = await page.locator(".score-viewer__canvas svg text").allTextContents();
      return texts.filter((t) => ["Flute", "Clarinet in B♭", "Cello"].includes(t));
    };
    await expect.poll(partNames).toEqual(["Flute", "Clarinet in B♭", "Cello"]);

    await page.getByRole("button", { name: "Celloを上へ" }).click();
    await expect.poll(partNames).toEqual(["Flute", "Cello", "Clarinet in B♭"]);
    await page.locator(".inspector__part", { hasText: "Clarinet in B♭" }).getByRole("checkbox", { name: "表示" }).uncheck();
    await expect.poll(partNames).toEqual(["Flute", "Cello"]);

    await page.keyboard.press("Control+z");
    await expect.poll(partNames).toEqual(["Flute", "Cello", "Clarinet in B♭"]);
    await page.keyboard.press("Control+z");
    await expect.poll(partNames).toEqual(["Flute", "Clarinet in B♭", "Cello"]);
  });

  test("print preview adds page numbers, header, and footer", async ({ page }) => {
    await importFile(page, trio);
    await page.getByRole("button", { name: "印刷…" }).click();
    await expect(page.getByRole("button", { name: "印刷", exact: true })).toBeEnabled({ timeout: 45_000 });
    await page.getByLabel("ヘッダー").fill("第1楽章");
    await page.getByLabel("フッター").fill("練習用");
    const decorations = page.locator(".print-view__pages svg .page-decoration");
    await expect(decorations).toHaveText(["第1楽章", "練習用", "1 / 1"]);
    await page.getByLabel("ページ番号").uncheck();
    await expect(decorations).toHaveText(["第1楽章", "練習用"]);
  });
});

test.describe("repeats", () => {
  const repeats = path.join(__dirname, "..", "testdata", "repeats.musicxml");

  test("the cursor follows repeats, voltas, and D.S. al Fine", async ({ page }, testInfo) => {
    await importFile(page, repeats);
    await page.screenshot({ path: testInfo.outputPath("repeats.png") });
    const cursor = page.getByTestId("score-cursor");
    await expect(cursor).toHaveAttribute("data-measure", "1");
    await expect(page.locator(".playback-controls__time")).toHaveText("0:00 / 0:10"); // 10 bars at ♩=240

    // Record every measure the cursor visits.
    await cursor.evaluate((el) => {
      const seen: string[] = [el.getAttribute("data-measure") ?? ""];
      (window as unknown as { visited: string[] }).visited = seen;
      new MutationObserver(() => seen.push(el.getAttribute("data-measure") ?? "")).observe(el, { attributes: true, attributeFilter: ["data-measure"] });
    });
    await page.getByLabel("テンポ").selectOption("200");
    await page.getByRole("button", { name: "再生" }).click();
    await expect(page.getByRole("button", { name: "一時停止" })).toBeVisible();
    await expect(page.getByRole("button", { name: "再生" })).toBeVisible({ timeout: 10_000 }); // stops at Fine
    const visited = await page.evaluate(() => (window as unknown as { visited: string[] }).visited);
    // …then, stopped at the end, the cursor returns to the start.
    expect(visited).toEqual(["1", "2", "3", "2", "4", "5", "6", "7", "5", "6", "1"]);
  });
});

test.describe("transport", () => {
  test.skip(!mid, "samplefiles/score.mid not present");

  test("L loops the current measure, M toggles the metronome, tempo scales the clock", async ({ page }, testInfo) => {
    await importFile(page, mid!);
    const cursor = page.getByTestId("score-cursor");
    const time = page.locator(".playback-controls__time");
    await expect(cursor).toHaveAttribute("data-measure", "1"); // playback plan loaded

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight"); // measure 3: 3.64s–5.45s at ♩=132
    await page.keyboard.press("l");
    await expect(page.locator(".transport-options__loop")).toHaveText("3小節");
    await page.keyboard.press("m");
    await expect(page.getByRole("button", { name: "メトロノーム" })).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: testInfo.outputPath("transport.png"), clip: { x: 0, y: 100, width: 1400, height: 400 } });

    await page.getByRole("button", { name: "再生" }).click();
    await page.waitForTimeout(3_000); // longer than the 1.8s measure: must have wrapped
    await expect(cursor).toHaveAttribute("data-measure", "3");
    await expect(time).toHaveText(/^0:0[345] /);

    // Loop off and 200% tempo: 2s of real time covers well over 3s of score.
    await page.keyboard.press("l");
    await expect(page.locator(".transport-options__loop")).toHaveText("3小節（オフ）");
    await page.getByLabel("テンポ").selectOption("200");
    await page.waitForTimeout(2_000);
    await expect(cursor).not.toHaveAttribute("data-measure", "3");
    await page.getByRole("button", { name: "一時停止" }).click();
    const [m, sec] = (await time.textContent())!.split(" / ")[0].split(":").map(Number);
    expect(m * 60 + sec).toBeGreaterThanOrEqual(7);
  });
});

test.describe("editing and .mlight", () => {
  test.skip(!xml, "samplefiles/score.xml not present");

  test("the line under the title (movement title) can be edited and cleared", async ({ page }) => {
    await importFile(page, xml!);
    const texts = () => page.locator(".score-viewer__canvas svg text").allTextContents();
    const field = page.getByLabel("サブタイトル（タイトルの下の行）");
    await expect(field).not.toHaveValue("");
    const original = await field.inputValue();
    await expect.poll(async () => (await texts()).includes(original)).toBe(true);

    await field.fill("Version B");
    await field.press("Enter");
    await expect.poll(async () => (await texts()).includes("Version B")).toBe(true);
    expect((await texts()).includes(original)).toBe(false);

    await field.fill("");
    await field.press("Enter");
    await expect.poll(async () => (await texts()).includes("Version B")).toBe(false);
    expect((await texts()).includes(original)).toBe(false);
  });

  test("edit, undo, save, download, and reopen preserves edits", async ({ page }, testInfo) => {
    await importFile(page, xml!);
    const status = page.locator(".workspace__status");
    await expect(status).toHaveText("保存済み");

    const title = page.getByLabel("曲名");
    await title.fill("E2E 曲名");
    await title.blur();
    await expect(status).toHaveText("未保存の変更あり");
    await expect(page.locator(".workspace__title")).toHaveText("E2E 曲名");

    const name = page.getByLabel("パート名");
    await name.fill("ピアノ");
    await name.blur();
    await expect(page.locator(".inspector__part legend")).toHaveText("ピアノ");
    await page.locator(".workspace__title").click();
    await page.keyboard.press("Control+z");
    await expect(page.locator(".inspector__part legend")).toHaveText("パート 1");

    await page.getByLabel("ミュート").check();
    await expect(page.getByLabel("ミュート")).toBeEnabled();
    await page.keyboard.press("Control+s");
    await expect(status).toHaveText("保存済み");

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByText(".mlightをダウンロード").click()]);
    expect(download.suggestedFilename()).toBe("E2E 曲名.mlight");
    const pkg = testInfo.outputPath("saved.mlight");
    await download.saveAs(pkg);
    expect(fs.statSync(pkg).size).toBeGreaterThan(1000);

    await page.getByRole("button", { name: "閉じる" }).click();
    await expect(page.locator(".library__title").first()).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles(pkg);
    await waitForScore(page);
    await expect(page.locator(".workspace__title")).toHaveText("E2E 曲名");
    await expect(page.getByLabel("ミュート")).toBeChecked();
    await expect(status).toHaveText("保存済み");
  });

  test("import report lists the inferred part name", async ({ page }) => {
    await importFile(page, xml!);
    await page.getByRole("button", { name: "レポート" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("INFERRED");
    await expect(dialog).toContainText("SHA-256");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("a non-score upload is rejected with a readable error", async ({ page }, testInfo) => {
    const bogus = testInfo.outputPath("notes.xml");
    fs.writeFileSync(bogus, "not a score at all");
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles(bogus);
    await expect(page.getByRole("alert")).toContainText("対応していないファイル形式");
  });
});

test.describe("home page", () => {
  test("the user manual opens from the bottom of the home page", async ({ page }) => {
    await page.goto("/");
    const manual = page.locator(".manual");
    await expect(manual.getByRole("heading", { name: "7. キーボードショートカット" })).toBeHidden();
    await page.getByText("使い方マニュアル").click();
    await expect(manual.getByRole("heading", { name: "7. キーボードショートカット" })).toBeVisible();
    await expect(manual.locator("kbd").first()).toHaveText("Space");
  });
});

test.describe("project library", () => {
  const trio = path.join(__dirname, "..", "testdata", "trio.musicxml");

  test("deletes a project after confirmation, and keeps it when cancelled", async ({ page }) => {
    // Two copies, so the list isn't empty after one is deleted; count rather
    // than assume, since a shared server may hold other tests' projects.
    for (let i = 0; i < 2; i++) {
      await importFile(page, trio);
      await page.getByRole("button", { name: "閉じる" }).click();
    }
    const trios = page.locator(".library__item", { hasText: "Trio Fixture" });
    await expect(trios.first()).toBeVisible();
    const before = await trios.count();

    page.once("dialog", (d) => void d.dismiss());
    await trios.first().getByRole("button", { name: "「Trio Fixture」を削除" }).click();
    await expect(trios).toHaveCount(before);

    page.once("dialog", (d) => {
      expect(d.message()).toContain("Trio Fixture");
      void d.accept();
    });
    await trios.first().getByRole("button", { name: "「Trio Fixture」を削除" }).click();
    await expect(trios).toHaveCount(before - 1);

    await page.reload(); // gone on the server, not just in the list
    await expect(page.locator(".library__title").first()).toBeVisible();
    await expect(page.locator(".library__item", { hasText: "Trio Fixture" })).toHaveCount(before - 1);
  });
});

test.describe("two tabs", () => {
  const trio = path.join(__dirname, "..", "testdata", "trio.musicxml");

  test("an edit in one tab shows up in the other", async ({ page, context }) => {
    await importFile(page, trio);
    const other = await context.newPage();
    await other.goto("/");
    await other.locator(".library__open", { hasText: "Trio Fixture" }).click();
    await waitForScore(other);

    const title = page.getByLabel("曲名");
    await title.fill("タブAで変更");
    await title.blur();
    await expect(page.locator(".workspace__title")).toHaveText("タブAで変更");

    await expect(other.locator(".workspace__title")).toHaveText("タブAで変更");
    await expect(other.getByRole("alert")).toContainText("別のタブでの変更を読み込みました");
    // The other tab now edits from the new revision, without a conflict.
    await other.getByLabel("作曲", { exact: true }).fill("タブB");
    await other.getByLabel("作曲", { exact: true }).blur();
    await expect(other.locator(".workspace__status")).toHaveText("未保存の変更あり");
    await expect(other.getByRole("alert")).toBeHidden();
  });
});

test.describe("mixer", () => {
  const trio = path.join(__dirname, "..", "testdata", "trio.musicxml");

  test("controls every part from one panel; a fader move is one undo step", async ({ page }) => {
    await importFile(page, trio);
    await page.locator(".workspace__title").click();
    await page.keyboard.press("x");
    const mixer = page.getByRole("region", { name: "ミキサー" });
    await expect(mixer.locator(".mixer__strip")).toHaveCount(4); // three parts and the master

    // Keyboard moves on a fader: heard while moving, recorded once on release.
    const flute = mixer.getByLabel("Flute 音量");
    await flute.focus();
    await page.keyboard.down("ArrowDown");
    await page.keyboard.up("ArrowDown");
    await expect(flute).toHaveValue("0.79");
    await expect(page.locator(".workspace__status")).toHaveText("未保存の変更あり");
    await expect(page.locator(".inspector__part").first()).toContainText("音量 79");

    // Mute and solo from the strip, then undo both with one bulk reset.
    await mixer.getByLabel("Cello ミュート").click();
    await expect(mixer.getByLabel("Cello ミュート")).toHaveAttribute("aria-pressed", "true");
    await mixer.getByLabel("Flute ソロ").click();
    await expect(mixer.getByLabel("Flute ソロ")).toHaveAttribute("aria-pressed", "true");
    await mixer.getByRole("button", { name: "すべてリセット" }).click();
    await expect(mixer.getByLabel("Cello ミュート")).toHaveAttribute("aria-pressed", "false");
    await expect(mixer.getByLabel("Flute ソロ")).toHaveAttribute("aria-pressed", "false");
    await expect(flute).toHaveValue("0.8");

    await page.locator(".workspace__title").click();
    await page.keyboard.press("Control+z"); // the reset was one step
    await expect(mixer.getByLabel("Cello ミュート")).toHaveAttribute("aria-pressed", "true");
    await expect(mixer.getByLabel("Flute ソロ")).toHaveAttribute("aria-pressed", "true");

    // The panel stays open across reloads, and X closes it.
    await page.reload();
    await page.locator(".library__open", { hasText: "Trio Fixture" }).click();
    await waitForScore(page);
    await expect(mixer).toBeVisible();
    await page.locator(".workspace__title").click();
    await page.keyboard.press("x");
    await expect(mixer).toBeHidden();
  });
});
