// A small synthesized GM drum kit for percussion parts (GM channel 10),
// keyed by MIDI note. Like the pitched synth it needs no samples, so
// playback stays fully offline (APP_DESIGN.md §17.4).

export type DrumKind = "kick" | "snare" | "closedHat" | "openHat" | "crash" | "ride" | "tom" | "other";

const KICKS = new Set([35, 36]);
const SNARES = new Set([37, 38, 39, 40]);
const CLOSED_HATS = new Set([42, 44]);
const OPEN_HATS = new Set([46]);
const CRASHES = new Set([49, 52, 55, 57]);
const RIDES = new Set([51, 53, 59]);
const TOMS = new Set([41, 43, 45, 47, 48, 50]);

export function drumKind(note: number): DrumKind {
  if (KICKS.has(note)) return "kick";
  if (SNARES.has(note)) return "snare";
  if (CLOSED_HATS.has(note)) return "closedHat";
  if (OPEN_HATS.has(note)) return "openHat";
  if (CRASHES.has(note)) return "crash";
  if (RIDES.has(note)) return "ride";
  if (TOMS.has(note)) return "tom";
  return "other";
}

interface NoiseSpec {
  filter: BiquadFilterType;
  frequency: number;
  decay: number; // seconds to near-silence
  level: number;
}

const NOISE: Partial<Record<DrumKind, NoiseSpec>> = {
  snare: { filter: "bandpass", frequency: 1800, decay: 0.18, level: 0.7 },
  closedHat: { filter: "highpass", frequency: 7000, decay: 0.05, level: 0.35 },
  openHat: { filter: "highpass", frequency: 7000, decay: 0.3, level: 0.35 },
  crash: { filter: "highpass", frequency: 5000, decay: 1.2, level: 0.4 },
  ride: { filter: "highpass", frequency: 6000, decay: 0.6, level: 0.3 },
  other: { filter: "bandpass", frequency: 2500, decay: 0.1, level: 0.35 },
};

const NOISE_SECONDS = 1;
const TOM_BASE_HZ = 80;
const TOM_STEP_HZ = 14;

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * Schedules one drum hit into `out` and returns its sources (for stopping
 * on pause/seek) and its envelope gain.
 */
export function scheduleDrum(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  note: number,
  startAt: number,
  velocity: number,
): { sources: AudioScheduledSourceNode[]; gain: GainNode } {
  const kind = drumKind(note);
  const level = (velocity / 127) * 0.6;
  const gain = ctx.createGain();
  gain.connect(out);
  const sources: AudioScheduledSourceNode[] = [];

  if (kind === "kick" || kind === "tom" || kind === "snare") {
    const osc = ctx.createOscillator();
    const [from, to, decay] =
      kind === "kick" ? [150, 45, 0.35] : kind === "tom" ? [TOM_BASE_HZ + (note - 41) * TOM_STEP_HZ, TOM_BASE_HZ, 0.3] : [185, 185, 0.1];
    osc.frequency.setValueAtTime(from, startAt);
    osc.frequency.setTargetAtTime(to, startAt, 0.04);
    const body = ctx.createGain();
    body.gain.setValueAtTime(level, startAt);
    body.gain.setTargetAtTime(0, startAt, decay / 4);
    osc.connect(body).connect(gain);
    osc.start(startAt);
    osc.stop(startAt + decay + 0.05);
    sources.push(osc);
  }

  const spec = NOISE[kind];
  if (spec) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = spec.filter;
    filter.frequency.value = spec.frequency;
    const env = ctx.createGain();
    env.gain.setValueAtTime(level * spec.level, startAt);
    env.gain.setTargetAtTime(0, startAt, spec.decay / 4);
    src.connect(filter).connect(env).connect(gain);
    src.start(startAt);
    src.stop(startAt + Math.min(spec.decay + 0.05, NOISE_SECONDS));
    sources.push(src);
  }
  gain.gain.value = 1;
  return { sources, gain };
}
