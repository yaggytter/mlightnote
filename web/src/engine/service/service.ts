import { applyOverlay, partMix } from "../domain/overlay";
import type { CanonicalScore } from "../domain/types";
import { applyCommand, EditError, newState, redo, undo, ValidationError, type Command, type State } from "../editing/commands";
import { generateDisplayXML } from "../exporters/displayxml/generator";
import { MLIGHT_MIME_TYPE, MlightError, readMlight, writeMlight } from "../mlight/archive";
import { generatePlan } from "../playback/plan";
import type { ProjectMeta, ProjectStore, Tx } from "../storage/db";
import { sha256Hex } from "../util/sha256";
import { editingError, internal, notFound, ServiceError } from "./errors";
import { baseTitle, detectMediaType, MAX_IMPORT_BYTES, parseScore, tooLarge, unsupportedFormat, type Parsed } from "./importing";
import {
  mixDTO,
  partSummaries,
  projectSummary,
  reportDTO,
  safeFilename,
  shownParts,
  stateDTO,
  type PartSummaryDTO,
  type PlaybackPlanDTO,
  type ProjectStateDTO,
  type ProjectSummaryDTO,
  type ReportDTO,
} from "./views";

// The 13 API operations of the Go server (internal/httpapi), running in the
// browser over IndexedDB. Inputs and outputs are plain data so the whole
// service can sit behind a Worker's postMessage.

export interface RenderQuery {
  partIds?: string[];
  concertPitch?: boolean;
  view?: "print";
}

export interface PackageFile {
  filename: string;
  data: Uint8Array;
}

/** Matches Go storage.ValidID: a malformed id is simply "not found". */
const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
/** The render request's part limit (§12.3), as the Go server. */
const MAX_PARTS_PER_REQUEST = 100;

interface Loaded {
  meta: ProjectMeta;
  score: CanonicalScore;
  state: State;
}

export class EngineService {
  constructor(
    private readonly store: ProjectStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** A new project from MusicXML, .mxl, MIDI or .mlight; nothing is kept on failure. */
  async importFile(filename: string, data: Uint8Array): Promise<ProjectSummaryDTO> {
    if (data.length > MAX_IMPORT_BYTES) throw tooLarge();
    const mediaType = detectMediaType(data);
    if (mediaType === "") throw unsupportedFormat();
    if (mediaType === MLIGHT_MIME_TYPE) return this.importPackage(data);

    const parsed = parseScore(mediaType, data);
    // MIDI has no title field (and some MusicXML omits it): the file name is a better heading.
    if (!parsed.score.Metadata.Title) parsed.score.Metadata.Title = baseTitle(filename);
    return this.create(filename, mediaType, data, parsed, newState());
  }

  private async importPackage(data: Uint8Array): Promise<ProjectSummaryDTO> {
    let pkg;
    try {
      pkg = readMlight(data);
    } catch (e) {
      throw packageError(e);
    }
    const state = { ...newState(), overlay: pkg.overlay };
    return this.create(pkg.source.filename, pkg.source.mediaType, pkg.source.data, { score: pkg.score, report: pkg.report }, state);
  }

  private async create(sourceName: string, mediaType: string, original: Uint8Array, parsed: Parsed, state: State): Promise<ProjectSummaryDTO> {
    const title = applyOverlay(state.overlay, parsed.score).Metadata.Title;
    // The package's own project id is never reused (§7.8 "Open Package").
    const meta: ProjectMeta = {
      id: crypto.randomUUID(),
      title: title || sourceName,
      sourceName,
      mediaType,
      sha256: sha256Hex(original),
      size: original.length,
      createdAt: this.now().toISOString(),
      warningCount: (parsed.report.Warnings ?? []).length,
    };
    await this.guard("保存に失敗しました。", () =>
      this.store.run("readwrite", async (tx) => {
        await tx.put(meta.id, "original", original);
        await tx.put(meta.id, "score", parsed.score);
        await tx.put(meta.id, "report", parsed.report);
        await tx.put(meta.id, "state", state);
        await tx.putMeta(meta);
      }),
    );
    return projectSummary(meta);
  }

  listProjects(): Promise<ProjectSummaryDTO[]> {
    return this.guard("一覧の取得に失敗しました。", () =>
      this.store.run("readonly", async (tx) => {
        const all = await tx.listMeta();
        return [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(projectSummary);
      }),
    );
  }

  getProject(id: string): Promise<ProjectStateDTO> {
    return this.read(id, ({ score, state }) => stateDTO(id, score, state));
  }

  command(id: string, body: unknown): Promise<ProjectStateDTO> {
    return this.mutate(id, (score, state) => applyCommand(state, score, decodeCommand(body)));
  }

  undo(id: string, baseRevision: number): Promise<ProjectStateDTO> {
    return this.mutate(id, (_score, state) => undo(state, requireRevision(baseRevision, "baseRevision")));
  }

  redo(id: string, baseRevision: number): Promise<ProjectStateDTO> {
    return this.mutate(id, (_score, state) => redo(state, requireRevision(baseRevision, "baseRevision")));
  }

  /**
   * Marks the revision the user saw as saved. Every edit is already stored,
   * so saving records the point to return to; if another tab has moved on,
   * the save is refused rather than saving something unseen (§7.8, §13.2).
   */
  save(id: string, targetRevision: number): Promise<ProjectStateDTO> {
    return this.mutate(id, (_score, state) => {
      if (!Number.isInteger(targetRevision) || targetRevision === 0) throw new ValidationError("targetRevision", "必須です");
      if (targetRevision !== state.revision) throw new EditError("REVISION_CONFLICT", "editing: base revision is stale");
      return { ...state, savedRevision: state.revision };
    });
  }

  /** The current revision as a .mlight file (§7.8 "Download Package"). */
  async packageFile(id: string): Promise<PackageFile> {
    const { loaded, original, report } = await this.guard("パッケージの作成に失敗しました。", () =>
      this.store.run("readonly", async (tx) => {
        const l = await load(tx, id);
        return { loaded: l, original: await tx.get(id, "original"), report: await tx.get(id, "report") };
      }),
    );
    if (!original) throw internal("パッケージの作成に失敗しました。");
    const { meta, score, state } = loaded;
    const data = writeMlight({
      projectId: id,
      revision: state.revision,
      createdAt: meta.createdAt,
      updatedAt: this.now().toISOString(),
      score,
      overlay: state.overlay,
      report: report ?? { Warnings: null },
      source: { id: "source-1", filename: meta.sourceName, mediaType: meta.mediaType, data: original },
      extra: new Map(),
    });
    return { filename: `${safeFilename(applyOverlay(state.overlay, score).Metadata.Title)}.mlight`, data };
  }

  report(id: string): Promise<ReportDTO> {
    return this.guard("レポートの読み込みに失敗しました。", () =>
      this.store.run("readonly", async (tx) => {
        const meta = await getMeta(tx, id);
        return reportDTO(meta, (await tx.get(id, "report")) ?? { Warnings: null });
      }),
    );
  }

  parts(id: string): Promise<PartSummaryDTO[]> {
    return this.read(id, ({ score, state }) => partSummaries(applyOverlay(state.overlay, score), state.overlay));
  }

  /** Display MusicXML for the view (§7.4 FR-VIEW-003). */
  async render(id: string, query: RenderQuery = {}): Promise<string> {
    if ((query.partIds ?? []).length > MAX_PARTS_PER_REQUEST) {
      throw new ServiceError(400, "RENDER_TOO_MANY_PARTS", "指定できるパート数の上限を超えています。");
    }
    const { score, state } = await this.read(id, (l) => l);
    const applied = applyOverlay(state.overlay, score);
    const partIds = query.partIds?.length ? query.partIds : shownParts(applied, state.overlay, query.view === "print");
    try {
      return generateDisplayXML(applied, { partIds, concertPitch: query.concertPitch === true });
    } catch {
      throw internal("譜面の生成に失敗しました。");
    }
  }

  async playbackPlan(id: string): Promise<PlaybackPlanDTO> {
    const { score, state } = await this.read(id, (l) => l);
    const applied = applyOverlay(state.overlay, score);
    const plan = generatePlan(applied);
    return {
      ...plan,
      events: plan.events ?? [],
      measures: plan.measures ?? [],
      clicks: plan.clicks ?? [],
      parts: (applied.Parts ?? []).map((p) => mixDTO(p.ID, partMix(state.overlay, p))),
      revision: state.revision,
    };
  }

  /** Permanently removes a project; the UI confirms first. */
  async deleteProject(id: string): Promise<{ deleted: string }> {
    await this.guard("削除に失敗しました。", () =>
      this.store.run("readwrite", async (tx) => {
        await getMeta(tx, id);
        await tx.deleteProject(id);
      }),
    );
    return { deleted: id };
  }

  private read<T>(id: string, fn: (l: Loaded) => T): Promise<T> {
    return this.guard("読み込みに失敗しました。", () => this.store.run("readonly", async (tx) => fn(await load(tx, id))));
  }

  /** Read-modify-write in one transaction, so concurrent edits serialize. */
  private mutate(id: string, fn: (score: CanonicalScore, state: State) => State): Promise<ProjectStateDTO> {
    return this.guard("編集内容の保存に失敗しました。", () =>
      this.store.run("readwrite", async (tx) => {
        const { meta, score, state } = await load(tx, id);
        const prevTitle = applyOverlay(state.overlay, score).Metadata.Title;
        let next: State;
        try {
          next = fn(score, state);
        } catch (e) {
          throw editingError(e);
        }
        await tx.put(id, "state", next);
        const title = applyOverlay(next.overlay, score).Metadata.Title;
        if (title !== prevTitle && title !== "") await tx.putMeta({ ...meta, title });
        return stateDTO(id, score, next);
      }),
    );
  }

  /** Storage failures become the generic error; service errors pass through. */
  private async guard<T>(message: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw internal(message);
    }
  }
}

async function getMeta(tx: Tx, id: string): Promise<ProjectMeta> {
  if (!VALID_ID.test(id)) throw notFound();
  const meta = await tx.getMeta(id);
  if (!meta) throw notFound();
  return meta;
}

async function load(tx: Tx, id: string): Promise<Loaded> {
  const meta = await getMeta(tx, id);
  const score = await tx.get(id, "score");
  if (!score) throw notFound();
  const state = (await tx.get(id, "state")) ?? newState();
  return { meta, score, state: { ...state, overlay: { ...state.overlay, parts: state.overlay.parts ?? {} } } };
}

function requireRevision(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new ValidationError(field, "必須です");
  return v;
}

/** The request body as a Command; wrong types fail like Go's json.Unmarshal. */
function decodeCommand(body: unknown): Command {
  const b = body as Partial<Command> | null;
  const ok =
    typeof b === "object" &&
    b !== null &&
    (b.commandId === undefined || typeof b.commandId === "string") &&
    (b.baseRevision === undefined || Number.isInteger(b.baseRevision)) &&
    (b.type === undefined || typeof b.type === "string");
  if (!ok) throw new ValidationError("body", "JSONとして解析できません");
  return { commandId: b.commandId ?? "", baseRevision: b.baseRevision ?? 0, type: b.type ?? "", payload: b.payload ?? null };
}

function packageError(e: unknown): ServiceError {
  const kind = e instanceof MlightError ? e.kind : "CORRUPT";
  switch (kind) {
    case "NEWER_VERSION":
      return new ServiceError(422, "PACKAGE_REQUIRES_NEWER_APP", "このファイルは新しいバージョンのMLightNoteで作成されています。対応するバージョンで開いてください。");
    case "LIMIT_EXCEEDED":
      return new ServiceError(413, "PACKAGE_TOO_LARGE", "パッケージがサイズ上限を超えています。");
    case "UNSAFE_ENTRY":
      return new ServiceError(422, "PACKAGE_REJECTED", "安全でない内容を含むため、このパッケージは開けません。");
    default:
      return new ServiceError(422, "PACKAGE_CORRUPT", "パッケージが破損しているか、整合性検証に失敗しました。");
  }
}
