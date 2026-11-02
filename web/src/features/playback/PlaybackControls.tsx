import { useCallback, useEffect, useRef, useState } from "react";
import { measureAt, type PlaybackPlan } from "../../services/api/playback";
import { AudioEngine, type PlaybackStatus } from "../../services/audio/AudioEngine";
import { loopLabel, loopRange, NO_LOOP, setLoopEnd, setLoopStart, toggleLoop, type LoopState } from "./loop";
import { TransportOptions } from "./TransportOptions";
import { MixerPanel } from "./MixerPanel";
import type { MixUpdate } from "./mixer";
import type { PartSummary } from "../../services/api/projects";
import { Icon } from "../../shared/ui/Icon";

/** What the score view needs from the transport: seeking and the clock. */
export interface PlaybackHandle {
  seek(seconds: number): void;
  getPositionSeconds(): number;
}

interface PlaybackControlsProps {
  plan: PlaybackPlan;
  /** Filled with the transport once the engine exists. */
  handleRef?: React.MutableRefObject<PlaybackHandle | null>;
  /**
   * Called every animation frame with the audio clock's position, so the
   * score cursor can follow it by direct DOM updates (APP_DESIGN.md §14.2).
   */
  onFrame?: (seconds: number, status: PlaybackStatus) => void;
  /** Parts in score order, for the mixer's channel strips. */
  parts?: PartSummary[];
  /** Records mixer changes as one edit; without it the mixer is hidden. */
  onMixCommit?: (updates: MixUpdate[]) => void;
  /** An edit is in flight: the mixer's controls wait for it. */
  busy?: boolean;
}

const MIXER_OPEN_KEY = "mlightnote.mixerOpen";

function readMixerOpen(): boolean {
  try {
    return localStorage.getItem(MIXER_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveMixerOpen(open: boolean): void {
  try {
    localStorage.setItem(MIXER_OPEN_KEY, open ? "1" : "0");
  } catch {
    // storage unavailable (private mode): the panel just won't be remembered
  }
}

export function planSignature(plan: PlaybackPlan): string {
  const first = plan.events[0];
  const last = plan.events[plan.events.length - 1];
  return [plan.events.length, plan.totalSeconds, first?.startSeconds, first?.midiNote, last?.startSeconds, last?.midiNote].join("|");
}

/** Keys that belong to the score, not to a focused form control (§6.4). */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PlaybackControls({ plan, handleRef, onFrame, parts = [], onMixCommit, busy = false }: PlaybackControlsProps) {
  const engineRef = useRef<AudioEngine | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>("stopped");
  const [position, setPosition] = useState(0);
  const rafRef = useRef<number | null>(null);
  const [ratePercent, setRatePercent] = useState(100);
  const [metronome, setMetronome] = useState(false);
  const [metronomeVolume, setMetronomeVolume] = useState(0.7);
  const [masterVolume, setMasterVolume] = useState(1);
  const [loop, setLoop] = useState<LoopState>(NO_LOOP);
  const [mixerOpen, setMixerOpen] = useState(readMixerOpen);
  const toggleMixer = useCallback(() => {
    setMixerOpen((open) => {
      saveMixerOpen(!open);
      return !open;
    });
  }, []);
  const measures = plan.measures ?? [];

  useEffect(() => {
    const engine = new AudioEngine();
    engineRef.current = engine;
    if (handleRef) {
      handleRef.current = {
        seek: (seconds) => engine.seek(seconds),
        getPositionSeconds: () => engine.getPositionSeconds(),
      };
    }
    return () => {
      engine.dispose();
      engineRef.current = null;
      if (handleRef) handleRef.current = null;
    };
  }, [handleRef]);

  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // Mixer edits (volume/pan/mute/solo/program) produce a new plan object
  // with identical note events; those are applied live so playback keeps
  // going. Only a change in the notes themselves reloads (and stops).
  const signatureRef = useRef<string | null>(null);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const signature = planSignature(plan);
    if (signature === signatureRef.current) {
      engine.setMix(plan.parts ?? []);
      return;
    }
    signatureRef.current = signature;
    engine.loadPlan(plan);
    setLoop(NO_LOOP);
    setPosition(0);
    setStatus("stopped");
  }, [plan]);

  // Transport settings survive plan reloads: re-applied whenever they change.
  useEffect(() => engineRef.current?.setRate(ratePercent / 100), [ratePercent]);
  useEffect(() => engineRef.current?.setMetronome(metronome), [metronome]);
  useEffect(() => engineRef.current?.setMetronomeVolume(metronomeVolume), [metronomeVolume]);
  useEffect(() => engineRef.current?.setMasterVolume(masterVolume), [masterVolume]);
  useEffect(() => engineRef.current?.setLoop(loopRange(loop, measures)), [loop, measures]);

  const currentMeasure = useCallback(() => {
    const engine = engineRef.current;
    return Math.max(0, measureAt(measures, engine?.getPositionSeconds() ?? 0));
  }, [measures]);

  // Cursor/time display polls the audio clock via requestAnimationFrame
  // rather than being driven by React state updates from the scheduler
  // (APP_DESIGN.md §14.2 "毎フレーム変化する再生位置をglobal React state
  // へ保存しない" — this local polling loop is the sanctioned exception,
  // not a violation: it reads the engine's clock, it doesn't drive it).
  useEffect(() => {
    const poll = () => {
      const engine = engineRef.current;
      if (engine) {
        const seconds = engine.getPositionSeconds();
        const current = engine.getStatus();
        setPosition(seconds);
        setStatus(current);
        onFrameRef.current?.(seconds, current);
      }
      rafRef.current = requestAnimationFrame(poll);
    };
    rafRef.current = requestAnimationFrame(poll);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handlePlayPause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.getStatus() === "playing") {
      engine.pause();
    } else {
      void engine.play();
    }
  }, []);

  const handleStop = useCallback(() => {
    engineRef.current?.stop();
  }, []);

  const handleSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    engineRef.current?.seek(Number(event.target.value));
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const engine = engineRef.current;
      if (event.code === "Space") {
        event.preventDefault();
        if (event.shiftKey) handleStop();
        else handlePlayPause();
        return;
      }
      if (event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === "l") setLoop((l) => toggleLoop(l, currentMeasure()));
      else if (key === "m") setMetronome((m) => !m);
      else if (key === "x" && onMixCommit) toggleMixer();
      else if (event.key === "Home") engine?.seek(0);
      else if (event.key === "End") engine?.seek(measures.length ? measures[measures.length - 1].startSeconds : 0);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePlayPause, handleStop, currentMeasure, measures, onMixCommit, toggleMixer]);

  const total = plan.totalSeconds;

  const progress = total > 0 ? Math.min(100, (position / total) * 100) : 0;

  return (
    <div className="playback-bar" role="region" aria-label="再生">
      {mixerOpen && onMixCommit && (
        <MixerPanel
          parts={parts}
          mixes={plan.parts ?? []}
          busy={busy}
          masterVolume={masterVolume}
          onMasterVolume={setMasterVolume}
          onPreview={(mixes) => engineRef.current?.setMix(mixes)}
          onCommit={onMixCommit}
          readLevels={() => engineRef.current?.levels() ?? { parts: {}, master: 0 }}
          onClose={toggleMixer}
        />
      )}
      <div className="playback-controls">
        <button type="button" className="icon-button" onClick={handleStop} aria-label="停止" title="停止 (Shift+Space)" disabled={status === "stopped"}>
          <Icon name="stop" />
        </button>
        <button
          type="button"
          className="play-button"
          onClick={handlePlayPause}
          aria-label={status === "playing" ? "一時停止" : "再生"}
          title={`${status === "playing" ? "一時停止" : "再生"} (Space)`}
        >
          <Icon name={status === "playing" ? "pause" : "play"} size={20} />
        </button>
        <span className="playback-controls__time">
          {formatTime(position)} / {formatTime(total)}
        </span>
        <input
          type="range"
          className="playback-controls__seek"
          min={0}
          max={total || 0}
          step={0.1}
          value={Math.min(position, total)}
          onChange={handleSeek}
          aria-label="再生位置"
          style={{ "--progress": `${progress}%` } as React.CSSProperties}
        />
        {onMixCommit && (
          <button type="button" className="toggle" aria-pressed={mixerOpen} onClick={toggleMixer} title="ミキサー (X)">
            <Icon name="sliders" />
            <span>ミキサー</span>
          </button>
        )}
      </div>
      <TransportOptions
        ratePercent={ratePercent}
        onRate={setRatePercent}
        metronome={metronome}
        onToggleMetronome={() => setMetronome((m) => !m)}
        metronomeVolume={metronomeVolume}
        onMetronomeVolume={setMetronomeVolume}
        masterVolume={masterVolume}
        onMasterVolume={setMasterVolume}
        loopLabel={loopLabel(loop, measures)}
        loopEnabled={loop.enabled}
        onSetLoopStart={() => setLoop((l) => setLoopStart(l, currentMeasure()))}
        onSetLoopEnd={() => setLoop((l) => setLoopEnd(l, currentMeasure()))}
        onToggleLoop={() => setLoop((l) => toggleLoop(l, currentMeasure()))}
        onClearLoop={() => setLoop(NO_LOOP)}
      />
    </div>
  );
}
