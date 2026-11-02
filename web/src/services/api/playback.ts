import { callEngine } from "./engine";

export interface PlaybackEvent {
  partId: string;
  staff: number;
  startSeconds: number;
  durationSeconds: number;
  midiNote: number;
  velocity: number;
  measureIndex: number;
}

export interface PartMix {
  partId: string;
  program: number;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  /** Shown in the full-score view (optional in older plan payloads). */
  visible?: boolean;
  /** Included when printing the full score. */
  printable?: boolean;
  /** Plays a drum kit keyed by MIDI note instead of pitched notes. */
  percussion?: boolean;
}

export interface MeasureTiming {
  index: number;
  number: string;
  startSeconds: number;
  endSeconds: number;
}

/** A metronome beat; accent marks a downbeat. */
export interface Click {
  seconds: number;
  accent?: boolean;
}

export interface PlaybackPlan {
  events: PlaybackEvent[];
  measures?: MeasureTiming[];
  clicks?: Click[];
  totalSeconds: number;
  parts?: PartMix[];
  revision?: number;
}

export function fetchPlaybackPlan(projectId: string): Promise<PlaybackPlan> {
  return callEngine("playbackPlan", [projectId]);
}

/** Finds the measure sounding at `seconds` (binary search), or -1. */
export function measureAt(measures: MeasureTiming[], seconds: number): number {
  let lo = 0;
  let hi = measures.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = measures[mid];
    if (seconds < m.startSeconds) hi = mid - 1;
    else if (seconds >= m.endSeconds) lo = mid + 1;
    else return mid;
  }
  return measures.length > 0 && seconds >= measures[measures.length - 1].endSeconds ? measures.length - 1 : -1;
}
