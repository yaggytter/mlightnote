// Instrument presets for the built-in synthesizer. Each of the 128 General
// MIDI programs maps to a distinct timbre built from four ingredients that
// the ear actually distinguishes: the harmonic spectrum (partials), a
// low-pass filter (brightness), the amplitude envelope (plucked/struck
// sounds decay, bowed/blown/organ sounds sustain), and modulation (vibrato,
// detuned chorus). This is not a sampled SoundFont (APP_DESIGN.md §3.2 P1),
// but a piano, a violin, a trumpet, and an organ are clearly different.

export interface Preset {
  /** Harmonic amplitudes, partials[0] = fundamental. */
  partials: number[];
  /** Low-pass cutoff in Hz. */
  cutoff: number;
  attack: number;
  decay: number;
  /** Level held after decay, 0..1. 0 = the sound dies away even if held. */
  sustain: number;
  release: number;
  /** Second detuned oscillator in cents (0 = none), for chorus/ensemble. */
  chorusCents: number;
  vibratoRate: number;
  /** Vibrato depth in cents (0 = none). */
  vibratoCents: number;
  /** Loudness trim so bright and dull presets sit at similar volume. */
  gain: number;
}

const harmonics = (n: number, falloff: number, oddOnly = false): number[] =>
  Array.from({ length: n }, (_, i) => (oddOnly && i % 2 === 1 ? 0 : 1 / Math.pow(i + 1, falloff)));

const base: Omit<Preset, "partials"> = {
  cutoff: 5000, attack: 0.005, decay: 1.2, sustain: 0.2, release: 0.25,
  chorusCents: 0, vibratoRate: 0, vibratoCents: 0, gain: 1,
};

type Family = (v: number) => Preset;

// One builder per GM family (program >> 3); v is the program within it.
const FAMILIES: Family[] = [
  // 0 Piano
  (v) => ({
    ...base,
    partials: v === 6 ? harmonics(16, 0.5) : v === 7 ? harmonics(12, 1, true) : v >= 4 ? [1, 0.1, 0.35, 0, 0.12, 0, 0.05] : harmonics(12, 1.4 - v * 0.15),
    cutoff: [4500, 7500, 6000, 5000, 3500, 5500, 8000, 2800][v],
    decay: v === 6 ? 0.7 : v === 7 ? 0.4 : v >= 4 ? 2.2 : 1.6,
    sustain: v >= 6 ? 0 : 0.18,
    chorusCents: v === 3 ? 14 : v === 5 ? 6 : 0,
  }),
  // 1 Chromatic percussion (bells, mallets)
  (v) => ({
    ...base,
    partials: v === 0 || v === 1 || v === 2 || v === 6 || v === 7 ? [1, 0, 0, 0.45, 0, 0, 0.2, 0, 0.1] : [1, 0.05, 0.3, 0, 0.08],
    cutoff: 6000 + v * 400, decay: [1.5, 0.9, 1.2, 2.0, 0.6, 0.3, 3.0, 1.0][v], sustain: 0, release: 0.4,
    vibratoRate: v === 3 ? 5 : 0, vibratoCents: v === 3 ? 6 : 0,
  }),
  // 2 Organ, accordion, harmonica
  (v) => ({
    ...base,
    partials: v >= 5 ? harmonics(14, 0.7) : [1, 1, 0.8 - v * 0.1, 0.6, 0.5, 0.3, 0.2 + v * 0.05, 0.15],
    cutoff: [3500, 4500, 6000, 5000, 3000, 2800, 3200, 2600][v], attack: v >= 5 ? 0.06 : 0.01,
    decay: 0.1, sustain: 1, release: 0.08, gain: 0.55,
    chorusCents: v === 5 || v === 7 ? 9 : 0, vibratoRate: v >= 5 ? 5.5 : 0, vibratoCents: v >= 5 ? 7 : 0,
  }),
  // 3 Guitar
  (v) => ({
    ...base,
    partials: v >= 5 ? harmonics(20, 0.35) : harmonics(12, 1.1 - v * 0.08),
    cutoff: [2500, 3500, 2200, 4000, 1500, 3500, 3000, 6000][v],
    decay: v === 4 ? 0.25 : v >= 5 ? 1.5 : 1.1, sustain: v >= 5 ? 0.7 : 0.08, gain: v >= 5 ? 0.6 : 1,
  }),
  // 4 Bass
  (v) => ({
    ...base,
    partials: v >= 6 ? harmonics(10, 0.8) : [1, 0.6 - v * 0.05, 0.3, 0.15, 0.08],
    cutoff: [900, 1200, 1600, 800, 2400, 2800, 1800, 1400][v], decay: 0.9, sustain: v >= 6 ? 0.6 : 0.3,
  }),
  // 5 Strings (solo), pizzicato, harp, timpani
  (v) => ({
    ...base,
    partials: v === 7 ? [1, 0.5, 0.1] : harmonics(20, 1 + v * 0.05),
    cutoff: [6000, 4800, 3800, 2800, 4500, 3500, 5000, 700][v],
    attack: v >= 5 ? 0.004 : 0.08, decay: v >= 5 ? [0.3, 1.8, 1.2][v - 5] : 0.3, sustain: v >= 5 ? 0 : 0.9, release: v >= 5 ? 0.3 : 0.3,
    vibratoRate: v < 5 ? 5.5 : 0, vibratoCents: v < 5 ? 10 : 0, gain: 0.7,
  }),
  // 6 Ensemble, choir, orchestra hit
  (v) => ({
    ...base,
    partials: v >= 4 && v <= 6 ? [1, 0.55, 0.35, 0.3, 0.2, 0.12, 0.06] : harmonics(18, 1.05),
    cutoff: [4500, 3200, 3800, 2600, 2400, 2000, 3000, 7000][v],
    attack: v === 7 ? 0.005 : 0.25 - v * 0.02, decay: v === 7 ? 0.5 : 0.3, sustain: v === 7 ? 0 : 0.85, release: 0.6,
    chorusCents: 8 + v, vibratoRate: 5, vibratoCents: 6, gain: 0.6,
  }),
  // 7 Brass
  (v) => ({
    ...base,
    partials: harmonics(16, 0.75 + (v % 4) * 0.12),
    cutoff: [3200, 2400, 1500, 1800, 2000, 2800, 3600, 3000][v], attack: 0.04, decay: 0.2, sustain: 0.85, release: 0.15,
    chorusCents: v === 5 ? 10 : v >= 6 ? 6 : 0, vibratoRate: 5, vibratoCents: v < 5 ? 5 : 0, gain: 0.6,
  }),
  // 8 Reed: saxes, oboe, English horn, bassoon, clarinet
  (v) => ({
    ...base,
    partials: v === 7 ? harmonics(12, 0.9, true) : v >= 4 ? [0.6, 1, 0.8, 0.6, 0.45, 0.3, 0.2, 0.1] : harmonics(14, 0.85),
    cutoff: [4200, 3600, 2800, 2200, 4000, 3000, 1800, 3200][v], attack: 0.04, decay: 0.2, sustain: 0.9, release: 0.1,
    vibratoRate: 5, vibratoCents: 8, gain: 0.6,
  }),
  // 9 Pipe: piccolo, flute, recorder, pan flute, ...
  (v) => ({
    ...base,
    partials: [1, 0.15 + v * 0.03, 0.05, 0.02],
    cutoff: 5000 - v * 250, attack: 0.05, decay: 0.2, sustain: 0.9, release: 0.12,
    vibratoRate: 5 + v * 0.2, vibratoCents: 5 + v, gain: 0.9,
  }),
  // 10 Synth lead
  (v) => ({
    ...base,
    partials: v === 0 ? harmonics(15, 1, true) : harmonics(15, 0.8 + v * 0.05),
    cutoff: 3000 + v * 600, attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.1, chorusCents: v === 6 ? 700 : v % 2 === 1 ? 7 : 0, gain: 0.5,
  }),
  // 11 Synth pad
  (v) => ({
    ...base,
    partials: harmonics(12, 1.1), cutoff: 1400 + v * 250, attack: 0.5 + v * 0.05, decay: 0.5, sustain: 0.8, release: 1.2,
    chorusCents: 10 + v, vibratoRate: 0.3 + v * 0.1, vibratoCents: 4, gain: 0.55,
  }),
  // 12 Synth effects
  (v) => ({
    ...base,
    partials: [1, 0.3, 0.6, 0.1, 0.4], cutoff: 2000 + v * 500, attack: 0.3, decay: 1.5, sustain: 0.5, release: 1.5,
    chorusCents: 15, vibratoRate: 0.5 + v * 0.4, vibratoCents: 12, gain: 0.5,
  }),
  // 13 Ethnic: sitar, banjo, shamisen, koto, kalimba, bagpipe, fiddle, shanai
  (v) => ({
    ...base,
    partials: v === 4 ? [1, 0, 0.2] : harmonics(16, 0.6 + v * 0.05),
    cutoff: [5000, 4500, 3500, 4000, 3000, 2500, 5000, 2800][v],
    decay: v >= 5 ? 0.2 : 0.8, sustain: v >= 5 ? 0.9 : 0, vibratoRate: v >= 5 ? 5.5 : 0, vibratoCents: v >= 5 ? 9 : 0, gain: 0.7,
  }),
  // 14 Percussive
  (v) => ({ ...base, partials: [1, 0.3, 0.1], cutoff: 1500 + v * 700, decay: 0.15 + v * 0.05, sustain: 0, release: 0.1 }),
  // 15 Sound effects
  (v) => ({ ...base, partials: harmonics(24, 0.3), cutoff: 800 + v * 900, attack: 0.02, decay: 0.4, sustain: v % 2 ? 0.5 : 0, release: 0.5, gain: 0.4 }),
];

export function presetFor(program: number): Preset {
  const p = Math.min(127, Math.max(0, Math.round(program)));
  return FAMILIES[p >> 3](p & 7);
}
