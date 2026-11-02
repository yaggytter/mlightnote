import type { PartMix } from "./playback";
import type { Transpose } from "../../shared/transpositions";
import { callEngine } from "./engine";

export interface PartSummary {
  id: string;
  name: string;
  abbreviation: string;
  /** Shown on systems after the first when abbreviation is empty. */
  autoAbbreviation?: string;
  order: number;
  transposing: boolean;
  /** Written-to-sounding interval in effect (MusicXML <transpose>). */
  transpose?: Transpose;
  percussion?: boolean;
  measureCount: number;
  mix: PartMix;
}

export interface RenderQuery {
  /** Part IDs to include; empty or undefined renders the full score. */
  partIds?: string[];
  concertPitch?: boolean;
  /** "print" picks the printable parts when no partIds are given. */
  view?: "print";
}

export function fetchRenderMusicXml(projectId: string, query: RenderQuery = {}): Promise<string> {
  return callEngine("render", [projectId, query]);
}

export function fetchParts(projectId: string): Promise<PartSummary[]> {
  return callEngine("parts", [projectId]);
}
