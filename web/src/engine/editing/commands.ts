import { emptyOverlay, type EditOverlay, type MetadataOverride, type PartOverride } from "../domain/overlay";
import type { CanonicalScore, Transpose } from "../domain/types";
import { sha256Hex } from "../util/sha256";

// Typed edit commands over the EditOverlay, with revisions and snapshot
// undo/redo (APP_DESIGN.md §7.7 FR-EDIT-002). A port of the Go editing
// package; the JSON shape of State matches it.

export const MAX_HISTORY = 100;
const MAX_TEXT = 500;

export const TYPE_UPDATE_METADATA = "score.updateMetadata";
export const TYPE_UPDATE_PART = "part.update";
export const TYPE_REORDER_PARTS = "part.reorder";
/** Several part updates as one undoable step (the mixer's bulk actions). */
export const TYPE_UPDATE_PARTS = "part.updateMany";

export class EditError extends Error {
  constructor(
    readonly code: "REVISION_CONFLICT" | "COMMAND_ID_REUSED" | "NOTHING_TO_UNDO" | "NOTHING_TO_REDO",
    message: string,
  ) {
    super(message);
  }
}

/** A rejected field, reported in the error envelope's details (§12.1). */
export class ValidationError extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`editing: ${field}: ${reason}`);
  }
}

export interface Command {
  commandId: string;
  baseRevision: number;
  type: string;
  payload: unknown;
}

export interface HistoryEntry {
  commandId: string;
  type: string;
  before: EditOverlay;
  after: EditOverlay;
}

export interface State {
  revision: number;
  savedRevision: number;
  overlay: EditOverlay;
  undo: HistoryEntry[] | null;
  redo: HistoryEntry[] | null;
  commands: Record<string, { payloadHash: string; revision: number }>;
}

export function newState(): State {
  return { revision: 1, savedRevision: 1, overlay: emptyOverlay(), undo: null, redo: null, commands: {} };
}

export function isDirty(s: State): boolean {
  return s.revision !== s.savedRevision;
}

function payloadHash(cmd: Command): string {
  return sha256Hex(`${cmd.type}\u0000${JSON.stringify(cmd.payload ?? null)}`);
}

function cloneOverlay(o: EditOverlay): EditOverlay {
  const out: EditOverlay = { metadata: { ...o.metadata }, parts: {} };
  for (const [k, v] of Object.entries(o.parts ?? {})) out.parts[k] = { ...v };
  if (o.partOrder && o.partOrder.length > 0) out.partOrder = [...o.partOrder];
  return out;
}

/** Applies cmd; a retry with the same id and payload is a no-op (§7.7). */
export function applyCommand(state: State, score: CanonicalScore, cmd: Command): State {
  const hash = payloadHash(cmd);
  const rec = state.commands[cmd.commandId];
  if (rec) {
    if (rec.payloadHash === hash) return state;
    throw new EditError("COMMAND_ID_REUSED", "editing: command id reused with a different payload");
  }
  if (!cmd.commandId) throw new ValidationError("commandId", "必須です");
  if (cmd.baseRevision !== state.revision) throw new EditError("REVISION_CONFLICT", "editing: base revision is stale");

  const after = applyToOverlay(cloneOverlay(state.overlay), score, cmd);
  const undo = [...(state.undo ?? []), { commandId: cmd.commandId, type: cmd.type, before: state.overlay, after }].slice(-MAX_HISTORY);
  const revision = state.revision + 1;
  return { ...state, overlay: after, undo, redo: null, revision, commands: { ...state.commands, [cmd.commandId]: { payloadHash: hash, revision } } };
}

export function undo(state: State, baseRevision: number): State {
  if (baseRevision !== state.revision) throw new EditError("REVISION_CONFLICT", "editing: base revision is stale");
  const stack = state.undo ?? [];
  if (stack.length === 0) throw new EditError("NOTHING_TO_UNDO", "editing: nothing to undo");
  const entry = stack[stack.length - 1];
  return { ...state, undo: stack.slice(0, -1), redo: [...(state.redo ?? []), entry], overlay: cloneOverlay(entry.before), revision: state.revision + 1 };
}

export function redo(state: State, baseRevision: number): State {
  if (baseRevision !== state.revision) throw new EditError("REVISION_CONFLICT", "editing: base revision is stale");
  const stack = state.redo ?? [];
  if (stack.length === 0) throw new EditError("NOTHING_TO_REDO", "editing: nothing to redo");
  const entry = stack[stack.length - 1];
  return { ...state, redo: stack.slice(0, -1), undo: [...(state.undo ?? []), entry], overlay: cloneOverlay(entry.after), revision: state.revision + 1 };
}

// ---- payload decoding: strict like Go's DisallowUnknownFields ----

type FieldType = "string" | "int" | "float" | "bool" | "transpose" | "strings" | "list";

function malformed(): never {
  throw new ValidationError("payload", "形式が不正です");
}

function decode<T>(payload: unknown, fields: Record<string, FieldType>): T {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) malformed();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    const type = fields[k];
    if (!type) malformed();
    if (v === null) continue; // JSON null leaves a Go pointer field unset
    out[k] = checkType(v, type);
  }
  return out as T;
}

function checkType(v: unknown, type: FieldType): unknown {
  switch (type) {
    case "string":
      if (typeof v !== "string") malformed();
      return v;
    case "int":
      if (typeof v !== "number" || !Number.isInteger(v)) malformed();
      return v;
    case "float":
      if (typeof v !== "number" || !Number.isFinite(v)) malformed();
      return v;
    case "bool":
      if (typeof v !== "boolean") malformed();
      return v;
    case "strings":
      if (!Array.isArray(v) || v.some((s) => typeof s !== "string")) malformed();
      return [...v];
    case "list":
      if (!Array.isArray(v)) malformed();
      return [...v];
    case "transpose": {
      const t = decode<Partial<Transpose>>(v, { diatonic: "int", chromatic: "int", octaveChange: "int" });
      return { diatonic: t.diatonic ?? 0, chromatic: t.chromatic ?? 0, octaveChange: t.octaveChange ?? 0 };
    }
  }
}

const METADATA_FIELDS = ["title", "subtitle", "movement", "composer", "arranger", "lyricist", "copyright"] as const;
const PART_FIELDS: Record<string, FieldType> = {
  partId: "string",
  name: "string",
  abbreviation: "string",
  program: "int",
  volume: "float",
  pan: "float",
  muted: "bool",
  solo: "bool",
  visible: "bool",
  printable: "bool",
  transpose: "transpose",
};

function checkText(field: string, v: string | undefined): void {
  if (v === undefined) return;
  if ([...v].length > MAX_TEXT || /[\uD800-\uDFFF]/.test(v.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""))) {
    throw new ValidationError(field, `${MAX_TEXT}文字以内の文字列で指定してください`);
  }
}

function validatePart(p: PartOverride): void {
  checkText("name", p.name);
  checkText("abbreviation", p.abbreviation);
  if (p.name !== undefined && p.name === "") throw new ValidationError("name", "空にはできません");
  if (p.program !== undefined && (p.program < 0 || p.program > 127)) throw new ValidationError("program", "0〜127で指定してください");
  if (p.volume !== undefined && (p.volume < 0 || p.volume > 1)) throw new ValidationError("volume", "0〜1で指定してください");
  if (p.pan !== undefined && (p.pan < -1 || p.pan > 1)) throw new ValidationError("pan", "-1〜1で指定してください");
  const t = p.transpose;
  if (t && (t.diatonic < -7 || t.diatonic > 7 || t.chromatic < -11 || t.chromatic > 11 || t.octaveChange < -2 || t.octaveChange > 2)) {
    throw new ValidationError("transpose", "移調は1オクターブ以内の音程と±2オクターブで指定してください");
  }
}

function applyPartPatch(o: EditOverlay, parts: NonNullable<CanonicalScore["Parts"]>, payload: unknown): EditOverlay {
  const p = decode<PartOverride & { partId?: string }>(payload, PART_FIELDS);
  const part = parts.find((x) => x.ID === p.partId);
  if (!part) throw new ValidationError("partId", "このプロジェクトに存在しないパートです");
  validatePart(p);
  if (p.transpose && part.Instrument.IsPercussion) throw new ValidationError("transpose", "打楽器パートには移調を設定できません");
  const cur: PartOverride = { ...(o.parts[part.ID] ?? {}) };
  for (const k of ["name", "abbreviation", "program", "volume", "pan", "muted", "solo", "visible", "printable", "transpose"] as const) {
    if (p[k] !== undefined) (cur as Record<string, unknown>)[k] = k === "transpose" ? { ...p.transpose! } : p[k];
  }
  o.parts[part.ID] = cur;
  return o;
}

function applyToOverlay(o: EditOverlay, score: CanonicalScore, cmd: Command): EditOverlay {
  const parts = score.Parts ?? [];
  switch (cmd.type) {
    case TYPE_UPDATE_METADATA: {
      const p = decode<MetadataOverride>(cmd.payload, Object.fromEntries(METADATA_FIELDS.map((f) => [f, "string" as const])));
      for (const f of METADATA_FIELDS) checkText(f, p[f]);
      for (const f of METADATA_FIELDS) if (p[f] !== undefined) o.metadata[f] = p[f];
      return o;
    }
    case TYPE_UPDATE_PART:
      return applyPartPatch(o, parts, cmd.payload);
    case TYPE_UPDATE_PARTS: {
      const { updates } = decode<{ updates?: unknown[] }>(cmd.payload, { updates: "list" });
      if (!updates || updates.length === 0 || updates.length > parts.length) {
        throw new ValidationError("updates", "1つ以上、パート数以下の更新を指定してください");
      }
      const ids = updates.map((u) => (u as { partId?: unknown }).partId);
      if (new Set(ids).size !== ids.length) throw new ValidationError("updates", "同じパートを2回指定することはできません");
      // o is already a private copy; a failure part-way throws before it is kept.
      return updates.reduce<EditOverlay>((acc, u) => applyPartPatch(acc, parts, u), o);
    }
    case TYPE_REORDER_PARTS: {
      const p = decode<{ partIds?: string[] }>(cmd.payload, { partIds: "strings" });
      const ids = p.partIds ?? [];
      const known = new Set(parts.map((x) => x.ID));
      const isPermutation = ids.length === parts.length && new Set(ids).size === ids.length && ids.every((id) => known.has(id));
      if (!isPermutation) throw new ValidationError("partIds", "すべてのパートを重複なく1回ずつ指定してください");
      o.partOrder = [...ids];
      return o;
    }
    default:
      throw new ValidationError("type", "未対応のコマンドです");
  }
}
