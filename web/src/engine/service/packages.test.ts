import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, test } from "vitest";
import { IndexedDBStore, openDatabase } from "../storage/db";
import { firstDifference, firstLineDifference, fixtures, goldenJSON, goldenRaw, goldenText, normalize } from "../testing/golden";
import { EngineService } from "./service";

// A .mlight saved by the former Go server opens here and shows and plays
// exactly what the server showed for that edited project.
const withPackages = fixtures().filter((f) => goldenRaw(f, "package.mlight"));

describe("Go-saved .mlight files open unchanged", () => {
  test.each(withPackages.map((f) => [f.name, f]))("%s", async (_name, f) => {
    const service = new EngineService(new IndexedDBStore(await openDatabase(new IDBFactory())));

    const project = await service.importFile("saved.mlight", goldenRaw(f, "package.mlight")!);

    expect(firstLineDifference(await service.render(project.id), goldenText(f, "edited-display.xml"))).toBeNull();
    const { events, measures, clicks, totalSeconds } = await service.playbackPlan(project.id);
    expect(firstDifference(normalize({ events, measures, clicks, totalSeconds }), normalize(goldenJSON(f, "edited-plan.json")))).toBeNull();
    expect((await service.getProject(project.id)).dirty).toBe(false);
  });
});
