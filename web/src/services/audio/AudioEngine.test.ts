import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine, effectiveGain } from "./AudioEngine";
import { presetFor } from "./synth";
import type { PlaybackPlan } from "../api/playback";

// A minimal fake Web Audio graph: jsdom has no real AudioContext, and a
// fake clock lets scheduling be verified deterministically (matching
// APP_DESIGN.md §19.1 "audio schedulerはfake clockで決定的に検証") instead
// of depending on real wall-clock timing.
class FakeGainParam {
  value = 0;
  events: Array<{ type: string; value: number; time: number }> = [];
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ type: "set", value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ type: "ramp", value, time });
  }
  cancelScheduledValues(_time: number) {
    this.events.push({ type: "cancel", value: 0, time: _time });
  }
  setTargetAtTime(value: number, time: number) {
    this.events.push({ type: "target", value, time });
  }
}

class FakeAudioNode {
  connect() {
    return this;
  }
}

class FakeOscillator extends FakeAudioNode {
  type = "";
  frequency = new FakeGainParam();
  detune = { value: 0 };
  wave: unknown = null;
  setPeriodicWave(w: unknown) {
    this.wave = w;
  }
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  start(time: number) {
    this.startedAt = time;
  }
  stop(time?: number) {
    this.stoppedAt = time ?? 0;
  }
}

class FakeGain extends FakeAudioNode {
  gain = new FakeGainParam();
}

class FakePanner extends FakeAudioNode {
  pan = { value: 0 };
}

class FakeAnalyser extends FakeAudioNode {
  fftSize = 2048;
  signal = 0;
  getFloatTimeDomainData(buf: Float32Array) {
    buf.fill(0);
    buf[3] = -this.signal;
  }
}

class FakeAudioContext {
  currentTime = 0;
  state: "running" | "suspended" = "running";
  oscillators: FakeOscillator[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {});
  createOscillator() {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc as unknown as OscillatorNode;
  }
  gains: FakeGain[] = [];
  panners: FakePanner[] = [];
  destination = new FakeAudioNode();
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g as unknown as GainNode;
  }
  waves: Float32Array[] = [];
  createPeriodicWave(_real: Float32Array, imag: Float32Array) {
    this.waves.push(imag);
    return { imag } as unknown as PeriodicWave;
  }
  sampleRate = 8000;
  bufferSources: FakeOscillator[] = [];
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data } as unknown as AudioBuffer;
  }
  createBufferSource() {
    const src = Object.assign(new FakeOscillator(), { buffer: null as unknown });
    this.bufferSources.push(src);
    return src as unknown as AudioBufferSourceNode;
  }
  createBiquadFilter() {
    return Object.assign(new FakeAudioNode(), { type: "", frequency: { value: 0 } }) as unknown as BiquadFilterNode;
  }
  analysers: FakeAnalyser[] = [];
  createAnalyser() {
    const a = new FakeAnalyser();
    this.analysers.push(a);
    return a as unknown as AnalyserNode;
  }
  createStereoPanner() {
    const p = new FakePanner();
    this.panners.push(p);
    return p as unknown as StereoPannerNode;
  }
}

function plan(events: PlaybackPlan["events"], totalSeconds: number): PlaybackPlan {
  return { events, totalSeconds };
}

describe("AudioEngine", () => {
  let fakeCtx: FakeAudioContext;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeCtx = new FakeAudioContext();
    // Arrow functions can never be called with `new`; AudioEngine does
    // `new AudioContext()`, so the stub must be a real constructor
    // function that returns the fake instance.
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function AudioContextStub() {
        return fakeCtx;
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("schedules notes within the lookahead window using AudioContext time, not wall time", async () => {
    // Arrange
    const engine = new AudioEngine();
    engine.loadPlan(
      plan([{ partId: "p1", staff: 1, startSeconds: 0, durationSeconds: 0.5, midiNote: 60, velocity: 80, measureIndex: 0 }], 2),
    );

    // Act
    await engine.play();

    // Assert: the note at t=0 is scheduled immediately (within the 150ms lookahead)
    expect(fakeCtx.oscillators).toHaveLength(1);
    expect(fakeCtx.oscillators[0].startedAt).toBe(0);
    expect(fakeCtx.oscillators[0].frequency.value).toBeCloseTo(261.63, 1); // MIDI 60 = middle C
  });

  it("does not schedule a note until the playback clock reaches its lookahead window", async () => {
    // Arrange
    const engine = new AudioEngine();
    engine.loadPlan(
      plan([{ partId: "p1", staff: 1, startSeconds: 1.0, durationSeconds: 0.5, midiNote: 62, velocity: 80, measureIndex: 5 }], 3),
    );

    // Act
    await engine.play();

    // Assert: nothing scheduled yet (event starts 1s ahead, lookahead is 150ms)
    expect(fakeCtx.oscillators).toHaveLength(0);

    // Advance the fake AudioContext clock and let the scheduler tick catch up.
    fakeCtx.currentTime = 0.9;
    await vi.advanceTimersByTimeAsync(200);

    // Assert: now within the lookahead window
    expect(fakeCtx.oscillators).toHaveLength(1);
  });

  it("stop() silences active voices instead of letting them ring out", async () => {
    // Arrange
    const engine = new AudioEngine();
    engine.loadPlan(
      plan([{ partId: "p1", staff: 1, startSeconds: 0, durationSeconds: 5, midiNote: 60, velocity: 80, measureIndex: 0 }], 5),
    );
    await engine.play();
    const osc = fakeCtx.oscillators[0];
    expect(osc.stoppedAt).toBeGreaterThan(0); // scheduled stop from the note's own duration

    // Act
    engine.stop();

    // Assert: stop() forces an earlier stop time than the note's natural end
    // (a near-immediate silence, not waiting out the full 5s duration).
    expect(osc.stoppedAt).toBeLessThan(1);
    expect(engine.getStatus()).toBe("stopped");
  });

  it("seek() moves the reported position without requiring playback", () => {
    // Arrange
    const engine = new AudioEngine();
    engine.loadPlan(plan([], 10));

    // Act
    engine.seek(4.5);

    // Assert
    expect(engine.getPositionSeconds()).toBe(4.5);
    expect(engine.getStatus()).toBe("stopped");
  });

  it("pause() then play() resumes from the paused position, not from zero", async () => {
    // Arrange
    const engine = new AudioEngine();
    engine.loadPlan(plan([], 10));
    await engine.play();
    fakeCtx.currentTime = 3;

    // Act
    engine.pause();
    const pausedPosition = engine.getPositionSeconds();
    fakeCtx.currentTime = 100; // time passes while paused, must not leak into position
    await engine.play();

    // Assert
    expect(pausedPosition).toBeCloseTo(3, 5);
    expect(engine.getPositionSeconds()).toBeCloseTo(3, 5);
  });
});

describe("mixer", () => {
  const mix = (over: Partial<import("../api/playback").PartMix>) => ({
    partId: "p",
    program: 0,
    volume: 0.8,
    pan: 0,
    muted: false,
    solo: false,
    ...over,
  });

  it("mute silences a part; solo silences every non-soloed part", () => {
    expect(effectiveGain(mix({ muted: true }), false)).toBe(0);
    expect(effectiveGain(mix({}), true)).toBe(0);
    expect(effectiveGain(mix({ solo: true, volume: 0.5 }), true)).toBe(0.5);
    expect(effectiveGain(mix({ volume: 0.3 }), false)).toBe(0.3);
  });

  it("gives every one of the 128 GM programs a distinct preset", () => {
    const fingerprints = new Set(Array.from({ length: 128 }, (_, p) => JSON.stringify(presetFor(p))));
    expect(fingerprints.size).toBe(128);
  });

  it("uses decaying envelopes for struck/plucked and sustaining ones for bowed/blown", () => {
    expect(presetFor(0).sustain).toBeLessThan(0.3); // acoustic grand piano
    expect(presetFor(24).sustain).toBeLessThan(0.3); // nylon guitar
    expect(presetFor(40).sustain).toBeGreaterThan(0.8); // violin
    expect(presetFor(56).sustain).toBeGreaterThan(0.8); // trumpet
    expect(presetFor(19).sustain).toBe(1); // church organ
    expect(presetFor(40).vibratoCents).toBeGreaterThan(0);
  });
});

describe("program changes", () => {
  it("schedules later notes with the new program's timbre", async () => {
    const ctx = new FakeAudioContext();
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function AudioContextStub() {
        return ctx;
      }),
    );
    const engine = new AudioEngine();
    const note = (t: number) => ({
      partId: "p1",
      staff: 1,
      startSeconds: t,
      durationSeconds: 0.1,
      midiNote: 60,
      velocity: 80,
      measureIndex: 0,
    });
    const mix = (program: number) => [{ partId: "p1", program, volume: 0.8, pan: 0, muted: false, solo: false }];
    engine.loadPlan({ events: [note(0), note(5)], totalSeconds: 10, parts: mix(0) });
    vi.useFakeTimers();
    await engine.play();
    const pianoWave = ctx.oscillators[0].wave;

    engine.setMix(mix(40)); // violin
    ctx.currentTime = 4.9;
    await vi.advanceTimersByTimeAsync(100);

    const later = ctx.oscillators[ctx.oscillators.length - 1];
    expect(later.wave).not.toBe(pianoWave);
    expect(ctx.waves.length).toBe(2);
    engine.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe("transport: tempo rate, A-B loop, metronome", () => {
  let ctx: FakeAudioContext;
  const note = (t: number, midiNote = 60) => ({
    partId: "p1",
    staff: 1,
    startSeconds: t,
    durationSeconds: 0.5,
    midiNote,
    velocity: 80,
    measureIndex: 0,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = new FakeAudioContext();
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function AudioContextStub() {
        return ctx;
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a 50% rate plays the score at half speed on the audio clock", async () => {
    const engine = new AudioEngine();
    engine.loadPlan(plan([note(1)], 10));
    engine.setRate(0.5);
    await engine.play();

    ctx.currentTime = 1.9;
    await vi.advanceTimersByTimeAsync(40);

    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0].startedAt).toBeCloseTo(2, 5); // score 1s -> 2s of audio
    expect(engine.getPositionSeconds()).toBeCloseTo(0.95, 5);
  });

  it("changing rate mid-play keeps the current position", async () => {
    const engine = new AudioEngine();
    engine.loadPlan(plan([], 10));
    await engine.play();
    ctx.currentTime = 2;
    engine.setRate(2);
    ctx.currentTime = 3;
    expect(engine.getPositionSeconds()).toBeCloseTo(4, 5);
  });

  it("clamps the rate to 25%–200%", () => {
    const engine = new AudioEngine();
    engine.setRate(10);
    expect(engine.getRate()).toBe(2);
    engine.setRate(0);
    expect(engine.getRate()).toBe(0.25);
  });

  it("an A-B loop schedules the loop start seamlessly right at B", async () => {
    const engine = new AudioEngine();
    engine.loadPlan(plan([note(0, 60), note(0.9, 62), note(1.5, 64)], 10));
    engine.setLoop({ startSeconds: 0, endSeconds: 1 });
    await engine.play();

    ctx.currentTime = 0.9;
    await vi.advanceTimersByTimeAsync(40);

    const starts = ctx.oscillators.map((o) => [o.frequency.value > 280 ? "D" : "C", o.startedAt]);
    expect(starts).toEqual([
      ["C", 0],
      ["D", 0.9],
      ["C", 1],
    ]); // E at 1.5 is outside the loop
    ctx.currentTime = 1.2;
    expect(engine.getPositionSeconds()).toBeCloseTo(0.2, 5);
    expect(engine.getStatus()).toBe("playing");
  });

  it("rejects a loop shorter than its minimum length", () => {
    const engine = new AudioEngine();
    engine.loadPlan(plan([], 10));
    engine.setLoop({ startSeconds: 2, endSeconds: 2 });
    expect(engine.getLoop()).toBeNull();
  });

  it("clicks the metronome on each beat only when enabled, higher on downbeats", async () => {
    const engine = new AudioEngine();
    engine.loadPlan({ events: [], totalSeconds: 4, clicks: [{ seconds: 0, accent: true }, { seconds: 0.1 }] });
    await engine.play();
    expect(ctx.oscillators).toHaveLength(0);

    engine.stop();
    engine.setMetronome(true);
    await engine.play();
    expect(ctx.oscillators.map((o) => o.startedAt)).toEqual([0, 0.1]);
    expect(ctx.oscillators[0].frequency.value).toBeGreaterThan(ctx.oscillators[1].frequency.value);
  });
});

describe("master volume", () => {
  it("routes every part through one master gain that applies live", async () => {
    const ctx = new FakeAudioContext();
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function AudioContextStub() {
        return ctx;
      }),
    );
    const engine = new AudioEngine();
    engine.loadPlan(
      plan([{ partId: "p1", staff: 1, startSeconds: 0, durationSeconds: 0.5, midiNote: 60, velocity: 80, measureIndex: 0 }], 2),
    );
    engine.setMasterVolume(0.5);
    await engine.play();
    const master = ctx.gains[0];
    expect(master.gain.value).toBe(0.5);
    engine.setMasterVolume(2);
    expect(master.gain.value).toBe(1);
    engine.dispose();
    vi.unstubAllGlobals();
  });
});

describe("setLoop without a change", () => {
  it("does not interrupt sounding notes (mixer edits reload the plan's measures)", async () => {
    const ctx = new FakeAudioContext();
    vi.stubGlobal("AudioContext", vi.fn(function AudioContextStub() { return ctx; }));
    vi.useFakeTimers();
    const engine = new AudioEngine();
    engine.loadPlan(plan([{ partId: "p1", staff: 1, startSeconds: 0, durationSeconds: 3, midiNote: 60, velocity: 80, measureIndex: 0 }], 5));
    await engine.play();
    const natural = ctx.oscillators[0].stoppedAt;
    ctx.currentTime = 1;

    engine.setLoop(null);
    engine.setLoop(null);

    expect(ctx.oscillators[0].stoppedAt).toBe(natural);
    engine.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe("percussion parts", () => {
  it("maps GM drum notes to kit pieces", async () => {
    const { drumKind } = await import("./drums");
    expect([36, 38, 42, 46, 49, 51, 45, 81].map(drumKind)).toEqual(["kick", "snare", "closedHat", "openHat", "crash", "ride", "tom", "other"]);
  });

  it("plays a drum hit, not a pitched note, for a percussion part", async () => {
    const ctx = new FakeAudioContext();
    vi.stubGlobal("AudioContext", vi.fn(function AudioContextStub() { return ctx; }));
    vi.useFakeTimers();
    const engine = new AudioEngine();
    engine.loadPlan({
      events: [{ partId: "dr", staff: 1, startSeconds: 0, durationSeconds: 0.1, midiNote: 42, velocity: 100, measureIndex: 0 }],
      totalSeconds: 1,
      parts: [{ partId: "dr", program: 0, volume: 0.8, pan: 0, muted: false, solo: false, percussion: true }],
    });
    await engine.play();
    expect(ctx.bufferSources).toHaveLength(1); // a closed hi-hat is filtered noise
    expect(ctx.waves).toHaveLength(0); // no pitched preset was built
    engine.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe("mixer meters", () => {
  it("reports each part's peak level and the master's, capped at full scale", async () => {
    // Arrange
    const ctx = new FakeAudioContext();
    vi.stubGlobal("AudioContext", vi.fn(function AudioContextStub() { return ctx; }));
    vi.useFakeTimers();
    const engine = new AudioEngine();
    engine.loadPlan(
      plan([{ partId: "p1", staff: 1, startSeconds: 0, durationSeconds: 0.5, midiNote: 60, velocity: 80, measureIndex: 0 }], 2),
    );
    expect(engine.levels()).toEqual({ parts: {}, master: 0 });

    // Act
    await engine.play();
    const [masterMeter, partMeter] = ctx.analysers; // the master output exists before any part
    masterMeter.signal = 3; // clipping
    partMeter.signal = 0.5;

    // Assert
    expect(engine.levels()).toEqual({ parts: { p1: 0.5 }, master: 1 });
    engine.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
