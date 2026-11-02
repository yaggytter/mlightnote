import { useEffect, useRef, useState } from "react";
import type { PartMix } from "../../services/api/playback";
import type { PartSummary } from "../../services/api/projects";
import type { MixLevels } from "../../services/audio/AudioEngine";
import { Icon } from "../../shared/ui/Icon";
import { applyDraft, DEFAULT_VOLUME, meterFraction, panLabel, resetAll, unmuteAll, unsoloAll, volumeDb, type MixPatch, type MixUpdate } from "./mixer";

interface MixerPanelProps {
  parts: PartSummary[];
  /** The stored mix of every part (from the playback plan). */
  mixes: PartMix[];
  busy: boolean;
  masterVolume: number;
  onMasterVolume: (volume: number) => void;
  /** Applies a mix to the audio right away, without recording an edit. */
  onPreview: (mixes: PartMix[]) => void;
  /** Records a change as one undoable edit. */
  onCommit: (updates: MixUpdate[]) => void;
  readLevels: () => MixLevels;
  onClose: () => void;
}

/** How fast a meter falls back after a peak, per animation frame. */
const METER_FALL_PER_FRAME = 0.025;

// The DAW-style mixer (a channel strip per part plus the master). A fader
// sounds while it moves and is recorded once when released, so a drag is a
// single undo step; bulk actions are one step too.
export function MixerPanel({ parts, mixes, busy, masterVolume, onMasterVolume, onPreview, onCommit, readLevels, onClose }: MixerPanelProps) {
  const [draft, setDraft] = useState<Record<string, MixPatch>>({});
  const shown = applyDraft(mixes, draft);
  const byId = new Map(shown.map((m) => [m.partId, m]));

  // A new stored mix (or a finished edit, even a rejected one) replaces the draft.
  const wasBusy = useRef(busy);
  useEffect(() => setDraft({}), [mixes]);
  useEffect(() => {
    if (wasBusy.current && !busy) setDraft({});
    wasBusy.current = busy;
  }, [busy]);

  const change = (partId: string, patch: MixPatch) => {
    const next = { ...draft, [partId]: { ...draft[partId], ...patch } };
    setDraft(next);
    onPreview(applyDraft(mixes, next));
  };
  const commitDraft = (partId: string) => {
    const patch = draft[partId];
    if (patch) onCommit([{ partId, ...patch }]);
  };
  const bulk = (updates: MixUpdate[]) => {
    if (updates.length > 0) onCommit(updates);
  };

  const meters = useMeters(readLevels);

  return (
    <section className="mixer" aria-label="ミキサー">
      <header className="mixer__header">
        <h2>ミキサー</h2>
        <div className="mixer__actions">
          <button type="button" className="button button--small" disabled={busy || !shown.some((m) => m.muted)} onClick={() => bulk(unmuteAll(shown))}>
            ミュートを全解除
          </button>
          <button type="button" className="button button--small" disabled={busy || !shown.some((m) => m.solo)} onClick={() => bulk(unsoloAll(shown))}>
            ソロを全解除
          </button>
          <button type="button" className="button button--small" disabled={busy || resetAll(shown).length === 0} onClick={() => bulk(resetAll(shown))} title="全パートを音量80・パン中央に戻し、ミュートとソロを解除">
            すべてリセット
          </button>
          <button type="button" className="icon-button icon-button--small" onClick={onClose} aria-label="ミキサーを閉じる" title="閉じる (X)">
            <Icon name="close" size={14} />
          </button>
        </div>
      </header>
      <div className="mixer__strips">
        {parts.map((part) => {
          const m = byId.get(part.id);
          if (!m) return null;
          const anySolo = shown.some((x) => x.solo);
          const silent = m.muted || (anySolo && !m.solo);
          return (
            <div key={part.id} className="mixer__strip" data-silent={silent || undefined}>
              <span className="mixer__name" title={part.name}>
                {part.abbreviation || part.autoAbbreviation || part.name}
              </span>
              <label className="mixer__pan">
                <span className="visually-hidden">{part.name} パン</span>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={m.pan}
                  disabled={busy}
                  aria-valuetext={panLabel(m.pan)}
                  onChange={(e) => change(part.id, { pan: Number(e.target.value) })}
                  onPointerUp={() => commitDraft(part.id)}
                  onKeyUp={() => commitDraft(part.id)}
                  onDoubleClick={() => onCommit([{ partId: part.id, pan: 0 }])}
                />
                <span className="mixer__value">{panLabel(m.pan)}</span>
              </label>
              <div className="mixer__channel">
                <span className="mixer__meter" ref={meters.refFor(part.id)} aria-hidden="true" />
                <input
                  type="range"
                  className="mixer__fader"
                  min={0}
                  max={1}
                  step={0.01}
                  value={m.volume}
                  disabled={busy}
                  aria-label={`${part.name} 音量`}
                  aria-valuetext={volumeDb(m.volume)}
                  onChange={(e) => change(part.id, { volume: Number(e.target.value) })}
                  onPointerUp={() => commitDraft(part.id)}
                  onKeyUp={() => commitDraft(part.id)}
                  onDoubleClick={() => onCommit([{ partId: part.id, volume: DEFAULT_VOLUME }])}
                  title="ダブルクリックで初期値（80）に戻す"
                />
              </div>
              <span className="mixer__value">{Math.round(m.volume * 100)}</span>
              <span className="mixer__buttons">
                <button
                  type="button"
                  className="mixer__toggle mixer__toggle--mute"
                  aria-pressed={m.muted}
                  aria-label={`${part.name} ミュート`}
                  disabled={busy}
                  onClick={() => onCommit([{ partId: part.id, muted: !m.muted }])}
                >
                  M
                </button>
                <button
                  type="button"
                  className="mixer__toggle mixer__toggle--solo"
                  aria-pressed={m.solo}
                  aria-label={`${part.name} ソロ`}
                  disabled={busy}
                  onClick={() => onCommit([{ partId: part.id, solo: !m.solo }])}
                >
                  S
                </button>
              </span>
            </div>
          );
        })}
        <div className="mixer__strip mixer__strip--master">
          <span className="mixer__name">マスター</span>
          <span className="mixer__pan" aria-hidden="true" />
          <div className="mixer__channel">
            <span className="mixer__meter" ref={meters.refFor(MASTER)} aria-hidden="true" />
            <input
              type="range"
              className="mixer__fader"
              min={0}
              max={1}
              step={0.01}
              value={masterVolume}
              aria-label="マスター音量"
              aria-valuetext={volumeDb(masterVolume)}
              onChange={(e) => onMasterVolume(Number(e.target.value))}
              onDoubleClick={() => onMasterVolume(1)}
              title="ダブルクリックで100に戻す"
            />
          </div>
          <span className="mixer__value">{Math.round(masterVolume * 100)}</span>
          <span className="mixer__buttons" />
        </div>
      </div>
    </section>
  );
}

const MASTER = "\u0000master";

/**
 * Drives the meters straight from the audio engine every animation frame,
 * by CSS variable, so the level never goes through React state (§14.2).
 */
function useMeters(readLevels: () => MixLevels) {
  const elements = useRef(new Map<string, HTMLElement>());
  const shown = useRef(new Map<string, number>());
  const read = useRef(readLevels);
  read.current = readLevels;

  useEffect(() => {
    let frame = requestAnimationFrame(function tick() {
      const levels = read.current();
      for (const [id, el] of elements.current) {
        const level = meterFraction(id === MASTER ? levels.master : (levels.parts[id] ?? 0));
        const value = Math.max(level, (shown.current.get(id) ?? 0) - METER_FALL_PER_FRAME);
        shown.current.set(id, value);
        el.style.setProperty("--level", value.toFixed(3));
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return {
    refFor: (id: string) => (el: HTMLElement | null) => {
      if (el) elements.current.set(id, el);
      else elements.current.delete(id);
    },
  };
}
