import { retranspose } from "./retranspose";
import type { CanonicalScore, Part, PartGroup, Transpose } from "./types";

// Every user edit as a diff over the immutable imported score (APP_DESIGN.md
// §2.3, §9.8). JSON shape matches the Go EditOverlay.
export interface MetadataOverride {
  title?: string;
  subtitle?: string;
  movement?: string;
  composer?: string;
  arranger?: string;
  lyricist?: string;
  copyright?: string;
}

export interface PartOverride {
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

export interface EditOverlay {
  metadata: MetadataOverride;
  parts: Record<string, PartOverride>;
  partOrder?: string[];
}

export interface PartMix {
  Program: number;
  Volume: number;
  Pan: number;
  Muted: boolean;
  Solo: boolean;
  Visible: boolean;
  Printable: boolean;
  Percussion: boolean;
}

export const DEFAULT_PART_MIX: PartMix = { Program: 0, Volume: 0.8, Pan: 0, Muted: false, Solo: false, Visible: true, Printable: true, Percussion: false };

export function emptyOverlay(): EditOverlay {
  return { metadata: {}, parts: {} };
}

/** A copy of score with the overlay applied; score itself is not modified. */
export function applyOverlay(o: EditOverlay, score: CanonicalScore): CanonicalScore {
  const md = o.metadata ?? {};
  const Metadata = { ...score.Metadata };
  if (md.title !== undefined) Metadata.Title = md.title;
  if (md.subtitle !== undefined) Metadata.Subtitle = md.subtitle;
  if (md.movement !== undefined) Metadata.Movement = md.movement;
  if (md.composer !== undefined) Metadata.Composer = md.composer;
  if (md.arranger !== undefined) Metadata.Arranger = md.arranger;
  if (md.lyricist !== undefined) Metadata.Lyricist = md.lyricist;
  if (md.copyright !== undefined) Metadata.Copyright = md.copyright;

  let parts: Part[] = (score.Parts ?? []).map((p) => {
    const po = o.parts?.[p.ID];
    if (!po) return p;
    let out: Part = { ...p, Instrument: { ...p.Instrument } };
    if (po.name !== undefined) out.Name = po.name;
    if (po.abbreviation !== undefined) out.Abbreviation = po.abbreviation;
    if (po.program !== undefined) out.Instrument.MIDIProgram = po.program;
    if (po.transpose && !out.Instrument.IsPercussion) out = retranspose(out, po.transpose);
    return out;
  });
  let PartGroups = score.PartGroups;
  if (o.partOrder && o.partOrder.length > 0) {
    parts = reorderParts(parts, o.partOrder);
    PartGroups = contiguousGroups(score.PartGroups ?? [], parts);
  }
  return { ...score, Metadata, PartGroups, Parts: parts };
}

function reorderParts(parts: Part[], order: string[]): Part[] {
  const listed = new Set(order);
  const out: Part[] = [];
  for (const id of order) for (const p of parts) if (p.ID === id) out.push(p);
  for (const p of parts) if (!listed.has(p.ID)) out.push(p);
  return out.map((p, i) => ({ ...p, Order: i }));
}

/** Keeps only groups whose parts are still adjacent after reordering. */
function contiguousGroups(groups: PartGroup[], parts: Part[]): PartGroup[] {
  const pos = new Map(parts.map((p, i) => [p.ID, i]));
  const out: PartGroup[] = [];
  for (const g of groups) {
    const ids = g.OrderedPartIDs ?? [];
    if (ids.length === 0) continue;
    let lo = parts.length;
    let hi = -1;
    let ok = true;
    for (const id of ids) {
      const i = pos.get(id);
      if (i === undefined) {
        ok = false;
        break;
      }
      lo = Math.min(lo, i);
      hi = Math.max(hi, i);
    }
    if (ok && hi - lo + 1 === ids.length) out.push({ ...g, OrderedPartIDs: parts.slice(lo, hi + 1).map((p) => p.ID) });
  }
  return out;
}

/** A part's mixer state from the overlay and its instrument. */
export function partMix(o: EditOverlay, part: Part): PartMix {
  const mix: PartMix = { ...DEFAULT_PART_MIX, Program: part.Instrument.MIDIProgram, Percussion: part.Instrument.IsPercussion };
  const po = o.parts?.[part.ID];
  if (!po) return mix;
  if (po.program !== undefined) mix.Program = po.program;
  if (po.volume !== undefined) mix.Volume = po.volume;
  if (po.pan !== undefined) mix.Pan = po.pan;
  if (po.muted !== undefined) mix.Muted = po.muted;
  if (po.solo !== undefined) mix.Solo = po.solo;
  if (po.visible !== undefined) mix.Visible = po.visible;
  if (po.printable !== undefined) mix.Printable = po.printable;
  return mix;
}
