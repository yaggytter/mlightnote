import type { Transpose } from "../../shared/transpositions";
import { callEngine } from "./engine";
import { announce } from "./sync";

export interface ScoreMetadata {
  title: string;
  subtitle: string;
  movement: string;
  composer: string;
  arranger: string;
  lyricist: string;
  copyright: string;
}

export interface ProjectState {
  id: string;
  revision: number;
  savedRevision: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  metadata: ScoreMetadata;
}

export interface ProjectSummary {
  id: string;
  title: string;
  sourceName: string;
  size: number;
  createdAt: string;
  warningCount: number;
}

export type MetadataPatch = Partial<ScoreMetadata>;

export interface PartPatch {
  name?: string;
  abbreviation?: string;
  program?: number;
  volume?: number;
  pan?: number;
  muted?: boolean;
  solo?: boolean;
  visible?: boolean;
  printable?: boolean;
  transpose?: Transpose;
}

export type EditCommand =
  | { type: "score.updateMetadata"; payload: MetadataPatch }
  | { type: "part.update"; payload: PartPatch & { partId: string } }
  | { type: "part.reorder"; payload: { partIds: string[] } }
  /** Several parts at once, undone as one step (mixer bulk actions). */
  | { type: "part.updateMany"; payload: { updates: (PartPatch & { partId: string })[] } };

/** Lets other tabs know the project moved to a new revision. */
async function announced(result: Promise<ProjectState>): Promise<ProjectState> {
  const state = await result;
  announce({ kind: "updated", projectId: state.id, revision: state.revision });
  return state;
}

export function fetchProjectState(id: string): Promise<ProjectState> {
  return callEngine("getProject", [id]);
}

export function listProjects(): Promise<ProjectSummary[]> {
  return callEngine("listProjects", []);
}

/** Permanently deletes a project and everything stored for it. */
export async function deleteProject(id: string): Promise<void> {
  await callEngine("deleteProject", [id]);
  announce({ kind: "deleted", projectId: id });
}

// Each command carries a fresh ID so a retry of the same request is
// idempotent, and the revision the tab last saw so a stale tab gets a
// conflict instead of overwriting (§7.7 FR-EDIT-002).
export function sendCommand(id: string, baseRevision: number, command: EditCommand): Promise<ProjectState> {
  return announced(callEngine("command", [id, { commandId: crypto.randomUUID(), baseRevision, ...command }]));
}

export function undo(id: string, baseRevision: number): Promise<ProjectState> {
  return announced(callEngine("undo", [id, baseRevision]));
}

export function redo(id: string, baseRevision: number): Promise<ProjectState> {
  return announced(callEngine("redo", [id, baseRevision]));
}

export function save(id: string, targetRevision: number): Promise<ProjectState> {
  return announced(callEngine("save", [id, targetRevision]));
}

/** Saves the current revision as a .mlight file on the user's machine. */
export async function downloadPackage(id: string): Promise<void> {
  const pkg = await callEngine("packageFile", [id]);
  const url = URL.createObjectURL(new Blob([pkg.data as Uint8Array<ArrayBuffer>], { type: "application/vnd.mlightnote.project+zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = pkg.filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoked later: the click only starts the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
