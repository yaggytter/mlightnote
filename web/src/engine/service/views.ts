import { autoAbbreviation } from "../domain/abbreviation";
import { applyOverlay, partMix, type EditOverlay, type PartMix } from "../domain/overlay";
import type { CanonicalScore, ImportReport, Transpose } from "../domain/types";
import { isDirty, type State } from "../editing/commands";
import type { Plan } from "../playback/plan";
import type { ProjectMeta } from "../storage/db";

// The response shapes of the Go API (httpapi DTOs), field for field, so the
// UI's types stay as they are.

export interface ProjectSummaryDTO {
  id: string;
  title: string;
  sourceName: string;
  sha256: string;
  size: number;
  createdAt: string;
  warningCount: number;
}

export interface ProjectStateDTO {
  id: string;
  revision: number;
  savedRevision: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  metadata: { title: string; subtitle: string; movement: string; composer: string; arranger: string; lyricist: string; copyright: string };
}

export interface PartMixDTO {
  partId: string;
  program: number;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  visible: boolean;
  printable: boolean;
  percussion?: boolean;
}

export interface PartSummaryDTO {
  id: string;
  name: string;
  abbreviation: string;
  autoAbbreviation: string;
  order: number;
  transposing: boolean;
  transpose: Transpose;
  percussion: boolean;
  measureCount: number;
  mix: PartMixDTO;
}

export interface PlaybackPlanDTO extends Plan {
  events: NonNullable<Plan["events"]>;
  measures: NonNullable<Plan["measures"]>;
  clicks: NonNullable<Plan["clicks"]>;
  parts: PartMixDTO[];
  revision: number;
}

export interface WarningDTO {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  partId?: string;
  measureIndex: number;
  element?: string;
}

export interface ReportDTO {
  sourceName: string;
  mediaType: string;
  sha256: string;
  size: number;
  warnings: WarningDTO[];
}

export function projectSummary(p: ProjectMeta): ProjectSummaryDTO {
  return { id: p.id, title: p.title, sourceName: p.sourceName, sha256: p.sha256, size: p.size, createdAt: p.createdAt, warningCount: p.warningCount };
}

export function stateDTO(id: string, score: CanonicalScore, state: State): ProjectStateDTO {
  const m = applyOverlay(state.overlay, score).Metadata;
  return {
    id,
    revision: state.revision,
    savedRevision: state.savedRevision,
    dirty: isDirty(state),
    canUndo: (state.undo ?? []).length > 0,
    canRedo: (state.redo ?? []).length > 0,
    metadata: { title: m.Title, subtitle: m.Subtitle, movement: m.Movement, composer: m.Composer, arranger: m.Arranger, lyricist: m.Lyricist, copyright: m.Copyright },
  };
}

export function mixDTO(partId: string, m: PartMix): PartMixDTO {
  return {
    partId,
    program: m.Program,
    volume: m.Volume,
    pan: m.Pan,
    muted: m.Muted,
    solo: m.Solo,
    visible: m.Visible,
    printable: m.Printable,
    ...(m.Percussion ? { percussion: true } : {}),
  };
}

/** Applied score → the parts list (Go handleListParts). */
export function partSummaries(score: CanonicalScore, overlay: EditOverlay): PartSummaryDTO[] {
  return (score.Parts ?? []).map((p) => {
    const t = p.Instrument.Transpose;
    return {
      id: p.ID,
      name: p.Name,
      abbreviation: p.Abbreviation,
      autoAbbreviation: autoAbbreviation(p.Name),
      order: p.Order,
      transposing: t.chromatic !== 0 || t.octaveChange !== 0,
      transpose: t,
      percussion: p.Instrument.IsPercussion,
      measureCount: (p.Measures ?? []).length,
      mix: mixDTO(p.ID, partMix(overlay, p)),
    };
  });
}

/**
 * The default part set when none is chosen: visible parts on screen,
 * printable ones for print. Empty means all, which is also the fallback
 * when every part is off, so the view never renders an empty score.
 */
export function shownParts(score: CanonicalScore, overlay: EditOverlay, print: boolean): string[] {
  const parts = score.Parts ?? [];
  const ids = parts.filter((p) => (print ? partMix(overlay, p).Printable : partMix(overlay, p).Visible)).map((p) => p.ID);
  return ids.length === parts.length ? [] : ids;
}

export function reportDTO(meta: ProjectMeta, report: ImportReport): ReportDTO {
  return {
    sourceName: meta.sourceName,
    mediaType: meta.mediaType,
    sha256: meta.sha256,
    size: meta.size,
    warnings: (report.Warnings ?? []).map((w) => ({
      severity: w.Severity || "info",
      code: w.Code,
      message: w.Message,
      ...(w.PartID ? { partId: w.PartID } : {}),
      measureIndex: w.MeasureIndex,
      ...(w.Element ? { element: w.Element } : {}),
    })),
  };
}

const FORBIDDEN_FILENAME_CHARS = '/\\:*?"<>|';
const MAX_FILENAME_CHARS = 100;

/** A user-editable title made safe as a download file name (Go safeFilename). */
export function safeFilename(title: string): string {
  const kept = [...title].filter((c) => !/\p{Cc}/u.test(c) && !FORBIDDEN_FILENAME_CHARS.includes(c)).join("");
  const out = kept.trim();
  if (out === "") return "score";
  return [...out].slice(0, MAX_FILENAME_CHARS).join("");
}
