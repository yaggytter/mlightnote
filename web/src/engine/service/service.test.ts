import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { IndexedDBStore, openDatabase } from "../storage/db";
import { REPO_ROOT } from "../testing/golden";
import { EngineService } from "./service";

// Ports the scenarios of the Go httpapi tests onto the in-browser service.

const EDIT_FIXTURE = `<score-partwise version="3.0">
  <work><work-title>Original Title</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
  </measure></part>
</score-partwise>`;

const bytes = (s: string) => new TextEncoder().encode(s);
const testdata = (name: string) => new Uint8Array(readFileSync(path.join(REPO_ROOT, "testdata", name)));
const partNames = (xml: string) => [...xml.matchAll(/<part-name>([^<]*)<\/part-name>/g)].map((m) => m[1]);

let service: EngineService;
beforeEach(async () => {
  service = new EngineService(new IndexedDBStore(await openDatabase(new IDBFactory())));
});

const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });

describe("EngineService", () => {
  test("edit, save, download and reopen as a new project", async () => {
    const project = await service.importFile("song.xml", bytes(EDIT_FIXTURE));
    const [part] = await service.parts(project.id);

    let st = await service.command(project.id, { commandId: "c1", baseRevision: 1, type: "part.update", payload: { partId: part.id, name: "Grand Piano", volume: 0.5 } });
    expect(st).toMatchObject({ revision: 2, dirty: true, canUndo: true });
    await service.command(project.id, { commandId: "c2", baseRevision: 2, type: "score.updateMetadata", payload: { title: "新しい曲名" } });

    const render = await service.render(project.id);
    expect(render).toContain("Grand Piano");
    expect(render).toContain("新しい曲名");
    expect((await service.listProjects())[0].title).toBe("新しい曲名");

    // A stale tab gets a conflict, not a silent overwrite.
    await expectCode(service.command(project.id, { commandId: "c3", baseRevision: 1, type: "score.updateMetadata", payload: { title: "stale" } }), "REVISION_CONFLICT");

    st = await service.undo(project.id, 3);
    expect(st.metadata.title).toBe("Original Title");
    st = await service.redo(project.id, st.revision);
    expect(st.metadata.title).toBe("新しい曲名");

    st = await service.save(project.id, st.revision);
    expect(st.dirty).toBe(false);
    expect(st.savedRevision).toBe(st.revision);

    const pkg = await service.packageFile(project.id);
    expect(pkg.filename).toBe("新しい曲名.mlight");
    const reopened = await service.importFile(pkg.filename, pkg.data);
    expect(reopened.id).not.toBe(project.id);
    expect(reopened.sha256).toBe(project.sha256);
    const parts = await service.parts(reopened.id);
    expect(parts).toHaveLength(1);
    expect(parts[0].name).toBe("Grand Piano");
    expect(parts[0].mix.volume).toBe(0.5);
    const rst = await service.getProject(reopened.id);
    expect(rst.metadata.title).toBe("新しい曲名");
    expect(rst.dirty).toBe(false);
  });

  test("save refuses a revision the user didn't see", async () => {
    const project = await service.importFile("song.xml", bytes(EDIT_FIXTURE));
    await service.command(project.id, { commandId: "c1", baseRevision: 1, type: "score.updateMetadata", payload: { composer: "X" } });
    await expectCode(service.save(project.id, 1), "REVISION_CONFLICT");
    await expectCode(service.save(project.id, 0), "VALIDATION_FAILED");
  });

  test("rejects invalid commands with details, and keeps the state", async () => {
    const project = await service.importFile("song.xml", bytes(EDIT_FIXTURE));
    await expect(service.command(project.id, { commandId: "c1", baseRevision: 1, type: "score.updateMetadata", payload: { title: "x".repeat(501) } })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 422,
      details: [expect.objectContaining({ field: expect.any(String) })],
    });
    await expectCode(service.command(project.id, "not an object"), "VALIDATION_FAILED");
    await expectCode(service.undo(project.id, 1), "NOTHING_TO_UNDO");
    expect((await service.getProject(project.id)).revision).toBe(1);
  });

  test("a retried command is idempotent; a reused id with new content is rejected", async () => {
    const project = await service.importFile("song.xml", bytes(EDIT_FIXTURE));
    const cmd = { commandId: "c1", baseRevision: 1, type: "score.updateMetadata", payload: { composer: "A" } };
    await service.command(project.id, cmd);
    expect((await service.command(project.id, cmd)).revision).toBe(2);
    await expectCode(service.command(project.id, { ...cmd, payload: { composer: "B" } }), "COMMAND_ID_REUSED");
  });

  test("concurrent commands on the same revision: exactly one wins", async () => {
    const project = await service.importFile("song.xml", bytes(EDIT_FIXTURE));
    const results = await Promise.allSettled(
      ["a", "b"].map((id) => service.command(project.id, { commandId: id, baseRevision: 1, type: "score.updateMetadata", payload: { composer: id } })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "REVISION_CONFLICT" } });
  });

  test("part order and visibility drive the rendered parts per view", async () => {
    const project = await service.importFile("trio.musicxml", testdata("trio.musicxml"));
    const [fl, cl, vc] = (await service.parts(project.id)).map((p) => p.id);
    await service.command(project.id, { commandId: "r", baseRevision: 1, type: "part.reorder", payload: { partIds: [vc, fl, cl] } });
    await service.command(project.id, { commandId: "v", baseRevision: 2, type: "part.update", payload: { partId: cl, visible: false } });
    await service.command(project.id, { commandId: "p", baseRevision: 3, type: "part.update", payload: { partId: fl, printable: false } });

    expect(partNames(await service.render(project.id))).toEqual(["Cello", "Flute"]);
    expect(partNames(await service.render(project.id, { view: "print" }))).toEqual(["Cello", "Clarinet in B♭"]);
    expect(partNames(await service.render(project.id, { partIds: [fl] }))).toEqual(["Flute"]);

    const after = await service.parts(project.id);
    expect(after[0].id).toBe(vc);
    expect(after[2].mix.visible).toBe(false);
    expect(after[1].mix.printable).toBe(false);
  });

  test("with every part hidden, the view falls back to all parts", async () => {
    const project = await service.importFile("trio.musicxml", testdata("trio.musicxml"));
    const ids = (await service.parts(project.id)).map((p) => p.id);
    let rev = 1;
    for (const id of ids) await service.command(project.id, { commandId: id, baseRevision: rev++, type: "part.update", payload: { partId: id, visible: false } });
    expect(partNames(await service.render(project.id))).toHaveLength(3);
  });

  test("transposing a part rewrites the notation but not the sound", async () => {
    const project = await service.importFile("trio.musicxml", testdata("trio.musicxml"));
    const flute = (await service.parts(project.id))[0].id;
    const before = await service.playbackPlan(project.id);

    await service.command(project.id, { commandId: "t1", baseRevision: 1, type: "part.update", payload: { partId: flute, transpose: { diatonic: -1, chromatic: -2, octaveChange: 0 } } });

    const written = await service.render(project.id, { partIds: [flute] });
    expect(written).toContain("<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic>");
    expect(written).toContain("<step>D</step><octave>5</octave>");
    const concert = await service.render(project.id, { partIds: [flute], concertPitch: true });
    expect(concert).not.toContain("<transpose>");
    expect((await service.playbackPlan(project.id)).events).toEqual(before.events);
    expect((await service.parts(project.id))[0]).toMatchObject({ transposing: true, transpose: { diatonic: -1, chromatic: -2 } });
  });

  test("imports MIDI with the file name as title, and reports its warnings", async () => {
    const project = await service.importFile("synthetic.mid", testdata("synthetic.mid"));
    expect(project.title).toBe("synthetic");
    const report = await service.report(project.id);
    expect(report).toMatchObject({ sourceName: "synthetic.mid", mediaType: "audio/midi", sha256: project.sha256 });
    expect(report.warnings.length).toBe(project.warningCount);
    const plan = await service.playbackPlan(project.id);
    expect(plan.events.length).toBeGreaterThan(0);
    expect(plan.parts.some((p) => p.percussion)).toBe(true);
  });

  test("rejects what it can't read, and stores nothing", async () => {
    await expectCode(service.importFile("a.txt", bytes("hello")), "IMPORT_UNSUPPORTED_FORMAT");
    await expectCode(service.importFile("a.xml", bytes("<score-partwise><part")), "IMPORT_PARSE_FAILED");
    await expectCode(service.importFile("a.mid", bytes("MThd\0\0\0\x06\0\x02\0\x01\x01\xe0")), "IMPORT_UNSUPPORTED_MIDI_FORMAT");
    const pkg = await service.packageFile((await service.importFile("song.xml", bytes(EDIT_FIXTURE))).id);
    const corrupt = pkg.data.slice(0, pkg.data.length - 30); // cut into the central directory
    await expect(service.importFile("x.mlight", corrupt)).rejects.toMatchObject({ code: expect.stringMatching(/^PACKAGE_/) });
    expect(await service.listProjects()).toHaveLength(1);
  });

  test("deletes a project; unknown and malformed ids are not found", async () => {
    const project = await service.importFile("song.xml", bytes(EDIT_FIXTURE));
    await service.deleteProject(project.id);
    expect(await service.listProjects()).toEqual([]);
    await expectCode(service.getProject(project.id), "PROJECT_NOT_FOUND");
    await expectCode(service.deleteProject("../etc"), "PROJECT_NOT_FOUND");
    await expectCode(service.render("nope"), "PROJECT_NOT_FOUND");
  });

  test("lists projects oldest first", async () => {
    let t = 0;
    service = new EngineService(new IndexedDBStore(await openDatabase(new IDBFactory())), () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)));
    await service.importFile("b.xml", bytes(EDIT_FIXTURE.replace("Original Title", "B")));
    await service.importFile("a.xml", bytes(EDIT_FIXTURE.replace("Original Title", "A")));
    expect((await service.listProjects()).map((p) => p.title)).toEqual(["B", "A"]);
  });
});
