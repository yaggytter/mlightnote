import type { Click, PartMix, PlaybackEvent, PlaybackPlan } from "../api/playback";
import { noiseBuffer, scheduleDrum } from "./drums";
import { presetFor, type Preset } from "./synth";

export type PlaybackStatus = "stopped" | "playing" | "paused";

// A look-ahead scheduler driven by AudioContext.currentTime, not the UI
// render cycle (APP_DESIGN.md §13.4 "UI更新周期を発音時刻の基準にしない").
// Every note is scheduled directly on the Web Audio timeline via
// osc.start/stop, so once scheduled it plays at sample-accurate time
// regardless of JS timer jitter; the setTimeout loop below only decides
// *when* to schedule the next lookahead window, not when notes sound.
const LOOKAHEAD_SECONDS = 0.15;
const SCHEDULER_INTERVAL_MS = 30;
const MIN_NOTE_SECONDS = 0.05;
export const RATE_MIN = 0.25;
export const RATE_MAX = 2;
const MIN_LOOP_SECONDS = 0.1;
const CLICK_SECONDS = 0.05;
const CLICK_GAIN = 0.35;
const CLICK_HZ = { accent: 1760, beat: 1175 };
// Upper bound on loop wraps handled in one scheduler tick; only a loop
// shorter than the lookahead window can wrap more than once.
const MAX_WRAPS_PER_TICK = 8;

export interface LoopRange {
  startSeconds: number;
  endSeconds: number;
}

/**
 * Maps the audio clock to score position: from ctxTime on, the score is at
 * position + (t - ctxTime) * rate. A loop wrap queues a later anchor, so
 * the loop start is scheduled ahead of time and sounds exactly at B.
 */
interface Anchor {
  ctxTime: number;
  position: number;
}

interface ActiveVoice {
  oscs: AudioScheduledSourceNode[];
  gain: GainNode;
}

interface PartChannel {
  gain: GainNode;
  pan: StereoPannerNode;
  /** A tap after the fader and pan, read by the mixer's meter. */
  meter: AnalyserNode;
}

/** Peak levels (0–1) for the mixer meters, sampled on demand. */
export interface MixLevels {
  parts: Record<string, number>;
  master: number;
}

// A short window keeps the meters responsive; peaks are what a clip light needs.
const METER_FFT_SIZE = 256;

// effectiveGain applies mute and solo: any soloed part silences every
// non-soloed part (§7.6 FR-PLAY-001).
export function effectiveGain(mix: PartMix | undefined, anySolo: boolean): number {
  if (!mix) return anySolo ? 0 : 1;
  if (mix.muted) return 0;
  if (anySolo && !mix.solo) return 0;
  return mix.volume;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private events: PlaybackEvent[] = [];
  private totalSeconds = 0;
  private clicks: Click[] = [];
  private anchors: Anchor[] = [];
  private rate = 1;
  private loop: LoopRange | null = null;
  private metronome = false;
  private metronomeGain: GainNode | null = null;
  private metronomeVolume = 0.7;
  private master: GainNode | null = null;
  private masterMeter: AnalyserNode | null = null;
  private meterBuffer = new Float32Array(METER_FFT_SIZE);
  private masterVolume = 1;
  private pausedAtSeconds = 0;
  private status: PlaybackStatus = "stopped";
  private schedulerHandle: number | null = null;
  private scheduledUntilSeconds = 0;
  private activeVoices: ActiveVoice[] = [];
  private mix = new Map<string, PartMix>();
  private channels = new Map<string, PartChannel>();
  private waves = new Map<number, PeriodicWave>();
  private noise: AudioBuffer | null = null;

  private waveFor(program: number, preset: Preset): PeriodicWave {
    let wave = this.waves.get(program);
    if (!wave) {
      const real = new Float32Array(preset.partials.length + 1);
      const imag = new Float32Array([0, ...preset.partials]);
      wave = this.ctx!.createPeriodicWave(real, imag);
      this.waves.set(program, wave);
    }
    return wave;
  }

  loadPlan(plan: PlaybackPlan) {
    this.stop();
    this.events = [...plan.events].sort((a, b) => a.startSeconds - b.startSeconds);
    this.clicks = plan.clicks ?? [];
    this.totalSeconds = plan.totalSeconds;
    this.loop = null;
    this.setMix(plan.parts ?? []);
  }

  /** Tempo multiplier (0.25–2); keeps the current position when playing. */
  setRate(rate: number): void {
    const clamped = Math.min(RATE_MAX, Math.max(RATE_MIN, Number.isFinite(rate) ? rate : 1));
    if (this.status === "playing") {
      const position = this.getPositionSeconds();
      this.rate = clamped;
      this.restartAt(position);
    } else {
      this.rate = clamped;
    }
  }

  getRate(): number {
    return this.rate;
  }

  /** Sets or clears the A-B loop; a range shorter than 0.1s is ignored. */
  setLoop(loop: LoopRange | null): void {
    let next: LoopRange | null = null;
    if (loop) {
      const startSeconds = Math.max(0, loop.startSeconds);
      const endSeconds = Math.min(this.totalSeconds, loop.endSeconds);
      if (endSeconds - startSeconds < MIN_LOOP_SECONDS) return;
      next = { startSeconds, endSeconds };
    }
    // Callers re-apply the loop whenever the plan object changes (e.g. a
    // mixer edit); an unchanged range must not restart sounding notes.
    if (sameLoop(this.loop, next)) return;
    this.loop = next;
    if (this.status !== "playing") return;
    const position = this.getPositionSeconds();
    const inside = !this.loop || (position >= this.loop.startSeconds && position < this.loop.endSeconds);
    this.restartAt(inside ? position : this.loop!.startSeconds);
  }

  getLoop(): LoopRange | null {
    return this.loop;
  }

  setMetronome(on: boolean): void {
    this.metronome = on;
  }

  /** 0–1; applies live. */
  setMetronomeVolume(volume: number): void {
    this.metronomeVolume = clamp01(volume);
    if (this.metronomeGain) this.metronomeGain.gain.value = this.metronomeVolume * CLICK_GAIN;
  }

  /** 0–1; applies live to every part and the metronome. */
  setMasterVolume(volume: number): void {
    this.masterVolume = clamp01(volume);
    if (this.master) this.master.gain.value = this.masterVolume;
  }

  private output(): GainNode {
    if (!this.master) {
      this.master = this.ctx!.createGain();
      this.master.gain.value = this.masterVolume;
      this.master.connect(this.ctx!.destination);
      this.masterMeter = this.meterFor(this.master);
    }
    return this.master;
  }

  // setMix updates part volume/pan/mute/solo live, without stopping
  // playback — so mixer edits are audible immediately.
  setMix(parts: PartMix[]): void {
    this.mix = new Map(parts.map((p) => [p.partId, p]));
    const anySolo = parts.some((p) => p.solo);
    for (const [partId, ch] of this.channels) {
      const m = this.mix.get(partId);
      ch.gain.gain.value = effectiveGain(m, anySolo);
      ch.pan.pan.value = m?.pan ?? 0;
    }
  }

  private meterFor(node: AudioNode): AnalyserNode {
    const meter = this.ctx!.createAnalyser();
    meter.fftSize = METER_FFT_SIZE;
    node.connect(meter);
    return meter;
  }

  private peak(meter: AnalyserNode): number {
    meter.getFloatTimeDomainData(this.meterBuffer);
    let max = 0;
    for (const v of this.meterBuffer) max = Math.max(max, Math.abs(v));
    return Math.min(1, max);
  }

  /** Current peak level of each sounding part and of the master output. */
  levels(): MixLevels {
    const parts: Record<string, number> = {};
    for (const [partId, ch] of this.channels) parts[partId] = this.peak(ch.meter);
    return { parts, master: this.masterMeter ? this.peak(this.masterMeter) : 0 };
  }

  private channelFor(partId: string): PartChannel {
    const ctx = this.ctx!;
    let ch = this.channels.get(partId);
    if (!ch) {
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      gain.connect(pan).connect(this.output());
      ch = { gain, pan, meter: this.meterFor(pan) };
      this.channels.set(partId, ch);
      const m = this.mix.get(partId);
      gain.gain.value = effectiveGain(
        m,
        [...this.mix.values()].some((p) => p.solo),
      );
      pan.pan.value = m?.pan ?? 0;
    }
    return ch;
  }

  async play(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    this.output();
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    if (this.status === "playing") return;

    this.anchors = [{ ctxTime: this.ctx.currentTime, position: this.pausedAtSeconds }];
    this.scheduledUntilSeconds = this.pausedAtSeconds;
    this.status = "playing";
    this.tick();
  }

  pause(): void {
    if (this.status !== "playing") return;
    this.pausedAtSeconds = this.getPositionSeconds();
    this.status = "paused";
    this.stopScheduler();
    this.silenceAll();
  }

  stop(): void {
    this.status = "stopped";
    this.pausedAtSeconds = 0;
    this.stopScheduler();
    this.silenceAll();
  }

  seek(seconds: number): void {
    const wasPlaying = this.status === "playing";
    this.silenceAll();
    this.pausedAtSeconds = Math.max(0, Math.min(seconds, this.totalSeconds));
    if (wasPlaying) this.restartAt(this.pausedAtSeconds);
  }

  getPositionSeconds(): number {
    if (this.status === "playing" && this.ctx) {
      const now = this.ctx.currentTime;
      while (this.anchors.length > 1 && this.anchors[1].ctxTime <= now) this.anchors.shift();
      const a = this.anchors[0];
      return a.position + (now - a.ctxTime) * this.rate;
    }
    return this.pausedAtSeconds;
  }

  /** Drops everything scheduled and continues from position right now. */
  private restartAt(position: number): void {
    if (!this.ctx) return;
    this.silenceAll();
    this.anchors = [{ ctxTime: this.ctx.currentTime, position }];
    this.scheduledUntilSeconds = position;
  }

  private ctxTimeAt(position: number, anchor: Anchor): number {
    return anchor.ctxTime + (position - anchor.position) / this.rate;
  }

  getStatus(): PlaybackStatus {
    return this.status;
  }

  getTotalSeconds(): number {
    return this.totalSeconds;
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.channels.clear();
    this.waves.clear();
    this.noise = null;
    this.metronomeGain = null;
    this.master = null;
    this.masterMeter = null;
  }

  private tick = (): void => {
    if (this.status !== "playing" || !this.ctx) return;

    if (!this.loop && this.getPositionSeconds() >= this.totalSeconds) {
      this.stop();
      return;
    }

    const horizonCtx = this.ctx.currentTime + LOOKAHEAD_SECONDS;
    for (let wraps = 0; wraps <= MAX_WRAPS_PER_TICK; wraps++) {
      const anchor = this.anchors[this.anchors.length - 1];
      const horizon = anchor.position + (horizonCtx - anchor.ctxTime) * this.rate;
      const limit = this.loop ? Math.min(horizon, this.loop.endSeconds) : horizon;
      this.scheduleRange(this.scheduledUntilSeconds, limit, anchor);
      this.scheduledUntilSeconds = Math.max(this.scheduledUntilSeconds, limit);
      if (!this.loop || horizon < this.loop.endSeconds) break;
      this.anchors.push({ ctxTime: this.ctxTimeAt(this.loop.endSeconds, anchor), position: this.loop.startSeconds });
      this.scheduledUntilSeconds = this.loop.startSeconds;
    }

    this.schedulerHandle = window.setTimeout(this.tick, SCHEDULER_INTERVAL_MS);
  };

  private scheduleRange(from: number, to: number, anchor: Anchor): void {
    for (const ev of this.events) {
      if (ev.startSeconds >= from && ev.startSeconds < to) {
        this.scheduleNote(ev, this.ctxTimeAt(ev.startSeconds, anchor), ev.durationSeconds / this.rate);
      }
    }
    if (!this.metronome) return;
    for (const click of this.clicks) {
      if (click.seconds >= from && click.seconds < to) this.scheduleClick(this.ctxTimeAt(click.seconds, anchor), click.accent === true);
    }
  }

  private scheduleClick(startAt: number, accent: boolean): void {
    const ctx = this.ctx!;
    if (!this.metronomeGain) {
      this.metronomeGain = ctx.createGain();
      this.metronomeGain.gain.value = this.metronomeVolume * CLICK_GAIN;
      this.metronomeGain.connect(this.output());
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(accent ? 1 : 0.6, startAt);
    gain.gain.setTargetAtTime(0, startAt + 0.002, CLICK_SECONDS / 4);
    gain.connect(this.metronomeGain);
    const osc = ctx.createOscillator();
    osc.frequency.value = accent ? CLICK_HZ.accent : CLICK_HZ.beat;
    osc.connect(gain);
    osc.start(startAt);
    osc.stop(startAt + CLICK_SECONDS);
    this.track({ oscs: [osc], gain });
  }

  private track(voice: ActiveVoice): void {
    this.activeVoices.push(voice);
    voice.oscs[0].onended = () => {
      this.activeVoices = this.activeVoices.filter((v) => v !== voice);
    };
  }

  // scheduleNote builds one synth voice: oscillator(s) with the program's
  // harmonic spectrum -> ADSR gain -> low-pass filter -> the part's
  // volume/pan channel. Sustained presets hold until the note ends;
  // plucked/struck presets (sustain 0) die away on their own.
  private scheduleNote(ev: PlaybackEvent, startAt: number, durationSeconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.mix.get(ev.partId)?.percussion) {
      this.noise ??= noiseBuffer(ctx);
      const { sources, gain } = scheduleDrum(ctx, this.channelFor(ev.partId).gain, this.noise, ev.midiNote, startAt, ev.velocity);
      if (sources.length > 0) this.track({ oscs: sources, gain });
      return;
    }

    const program = this.mix.get(ev.partId)?.program ?? 0;
    const preset = presetFor(program);
    const endAt = startAt + Math.max(durationSeconds, MIN_NOTE_SECONDS);
    const peak = Math.min(0.3, (ev.velocity / 127) * 0.3) * preset.gain;
    const attackEnd = startAt + preset.attack;
    const stopAt = endAt + preset.release + 0.05;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(peak, attackEnd);
    gain.gain.setTargetAtTime(peak * preset.sustain, attackEnd, Math.max(0.01, preset.decay / 3));
    gain.gain.setTargetAtTime(0, endAt, Math.max(0.01, preset.release / 3));

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = preset.cutoff;
    gain.connect(filter).connect(this.channelFor(ev.partId).gain);

    const frequency = midiToFrequency(ev.midiNote);
    const detunes = preset.chorusCents ? [-preset.chorusCents / 2, preset.chorusCents / 2] : [0];
    const oscs = detunes.map((detune) => {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(this.waveFor(program, preset));
      osc.frequency.value = frequency;
      osc.detune.value = detune;
      osc.connect(gain);
      osc.start(startAt);
      osc.stop(stopAt);
      return osc;
    });

    if (preset.vibratoCents > 0) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = preset.vibratoRate;
      depth.gain.value = preset.vibratoCents;
      lfo.connect(depth);
      for (const osc of oscs) depth.connect(osc.detune);
      lfo.start(startAt + 0.15);
      lfo.stop(stopAt);
      oscs.push(lfo);
    }

    this.track({ oscs, gain });
  }

  // silenceAll is the all-notes-off used on stop/seek/pause (APP_DESIGN.md
  // §7.6 FR-PLAY-003 "予約イベントをキャンセルしてall-notes-off相当を実
  // 行する"): scheduled-but-not-yet-started oscillators are stopped
  // immediately (a no-op sonically), and any currently sounding voice is
  // silenced without a click by cancelling its envelope first.
  private silenceAll(): void {
    const ctx = this.ctx;
    for (const { oscs, gain } of this.activeVoices) {
      if (ctx) {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.02);
      }
      for (const osc of oscs) {
        try {
          osc.stop(ctx ? ctx.currentTime + 0.03 : undefined);
        } catch {
          // already stopped
        }
      }
    }
    this.activeVoices = [];
  }

  private stopScheduler(): void {
    if (this.schedulerHandle !== null) {
      window.clearTimeout(this.schedulerHandle);
      this.schedulerHandle = null;
    }
  }
}

function sameLoop(a: LoopRange | null, b: LoopRange | null): boolean {
  if (!a || !b) return a === b;
  return a.startSeconds === b.startSeconds && a.endSeconds === b.endSeconds;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

function midiToFrequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}
