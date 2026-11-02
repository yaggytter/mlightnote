import type { PartMix } from "../../services/api/playback";

// Pure mixer logic: drafts while a fader moves, the bulk actions, and the
// meter scale. The panel (MixerPanel.tsx) only wires these to the DOM.

/** The volume a newly imported part starts at (engine DEFAULT_PART_MIX). */
export const DEFAULT_VOLUME = 0.8;
/** The quietest level the meter shows; anything below reads as silence. */
const METER_FLOOR_DB = -48;

export interface MixPatch {
  volume?: number;
  pan?: number;
  muted?: boolean;
  solo?: boolean;
}

export interface MixUpdate extends MixPatch {
  partId: string;
}

/** The stored mix with the not-yet-committed changes on top. */
export function applyDraft(mixes: PartMix[], draft: Readonly<Record<string, MixPatch>>): PartMix[] {
  return mixes.map((m) => (draft[m.partId] ? { ...m, ...draft[m.partId] } : m));
}

export function unmuteAll(mixes: PartMix[]): MixUpdate[] {
  return mixes.filter((m) => m.muted).map((m) => ({ partId: m.partId, muted: false }));
}

export function unsoloAll(mixes: PartMix[]): MixUpdate[] {
  return mixes.filter((m) => m.solo).map((m) => ({ partId: m.partId, solo: false }));
}

/** Every part back to the default volume, centered, unmuted, no solo. */
export function resetAll(mixes: PartMix[]): MixUpdate[] {
  return mixes
    .filter((m) => m.volume !== DEFAULT_VOLUME || m.pan !== 0 || m.muted || m.solo)
    .map((m) => ({ partId: m.partId, volume: DEFAULT_VOLUME, pan: 0, muted: false, solo: false }));
}

/** A peak level (0–1) as a meter height (0–1) on a decibel scale. */
export function meterFraction(level: number): number {
  if (!(level > 0)) return 0;
  const db = 20 * Math.log10(level);
  return Math.min(1, Math.max(0, 1 - db / METER_FLOOR_DB));
}

/** A fader position as decibels, the way a DAW labels it. */
export function volumeDb(volume: number): string {
  if (volume <= 0) return "−∞ dB";
  const db = 20 * Math.log10(volume);
  return `${db > 0 ? "+" : db < 0 ? "−" : ""}${Math.abs(db).toFixed(1)} dB`;
}

export function panLabel(pan: number): string {
  if (pan === 0) return "C";
  return pan < 0 ? `L${Math.round(-pan * 100)}` : `R${Math.round(pan * 100)}`;
}
