import { useCallback, useEffect, useRef } from "react";
import { measureAt, type MeasureTiming } from "../../services/api/playback";
import type { PlaybackStatus } from "../../services/audio/AudioEngine";
import type { MeasureRect } from "../../services/notation/NotationRenderer";
import type { PlaybackHandle } from "../playback/PlaybackControls";

interface CursorOptions {
  measures: MeasureTiming[];
  /** Reads the rendered measures' boxes; called only when they may have moved. */
  readRects: () => MeasureRect[];
  handleRef: React.MutableRefObject<PlaybackHandle | null>;
  follow: boolean;
}

// Pressing ← within this many seconds of a measure's start goes to the
// previous measure rather than restarting the current one.
const PREVIOUS_MEASURE_GRACE_SECONDS = 0.3;

/** Where the cursor sits: the measure's box, and x interpolated by time. */
export function cursorPosition(
  measures: MeasureTiming[],
  rects: MeasureRect[],
  seconds: number,
): { index: number; x: number; rect: MeasureRect } | null {
  const index = measureAt(measures, seconds);
  if (index < 0) return null;
  const m = measures[index];
  const rect = rects[m.index];
  if (!rect || rect.width <= 0) return null;
  const span = m.endSeconds - m.startSeconds;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (seconds - m.startSeconds) / span)) : 0;
  return { index, x: rect.x + fraction * rect.width, rect };
}

/** Index of the rendered measure whose box contains the point, or -1. */
export function measureIndexAtPoint(rects: MeasureRect[], x: number, y: number): number {
  return rects.findIndex((r) => r.width > 0 && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
}

/** The measure to seek to for ←/→ from the current position. */
export function stepMeasure(measures: MeasureTiming[], seconds: number, direction: -1 | 1): number {
  const current = Math.max(0, measureAt(measures, seconds));
  if (direction === 1) return Math.min(current + 1, measures.length - 1);
  const nearStart = seconds - measures[current].startSeconds < PREVIOUS_MEASURE_GRACE_SECONDS;
  return Math.max(0, nearStart ? current - 1 : current);
}

// Height of the bottom-docked transport bar (plus a little air).
const DOCK_CLEARANCE_PX = 140;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

function keepInView(el: HTMLElement) {
  const container = scrollParent(el);
  if (!container) return;
  const box = el.getBoundingClientRect();
  const view = container.getBoundingClientRect();
  // The transport docks over the bottom of the view; treat that band as
  // out of sight so the playing measure never hides behind it.
  if (box.top >= view.top && box.bottom <= view.bottom - DOCK_CLEARANCE_PX) return;
  const top = container.scrollTop + (box.top - view.top) - view.height / 3;
  container.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

/**
 * Drives the playback cursor (a vertical line plus a highlight of the
 * sounding measure) from the audio clock by writing styles directly each
 * frame instead of going through React state (APP_DESIGN.md §14.2). Also
 * provides click-to-seek and ←/→ measure stepping (§6.3, §6.4).
 */
export function usePlaybackCursor({ measures, readRects, handleRef, follow }: CursorOptions) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const rectsRef = useRef<MeasureRect[] | null>(null);
  const lastIndexRef = useRef(-1);
  const followRef = useRef(follow);
  followRef.current = follow;

  /** Marks the measure boxes stale, e.g. after a render or zoom change. */
  const invalidate = useCallback(() => {
    rectsRef.current = null;
    lastIndexRef.current = -1;
  }, []);

  const rects = useCallback(() => {
    if (!rectsRef.current) rectsRef.current = readRects();
    return rectsRef.current;
  }, [readRects]);

  useEffect(() => {
    window.addEventListener("resize", invalidate);
    return () => window.removeEventListener("resize", invalidate);
  }, [invalidate]);

  useEffect(invalidate, [measures, invalidate]);

  const onFrame = useCallback(
    (seconds: number, status: PlaybackStatus) => {
      const cursor = cursorRef.current;
      const highlight = highlightRef.current;
      if (!cursor || !highlight) return;
      const pos = cursorPosition(measures, rects(), seconds);
      cursor.hidden = !pos;
      highlight.hidden = !pos;
      if (!pos) return;
      const { rect } = pos;
      cursor.style.transform = `translate(${pos.x}px, ${rect.y}px)`;
      cursor.style.height = `${rect.height}px`;
      if (pos.index === lastIndexRef.current) return;
      lastIndexRef.current = pos.index;
      cursor.dataset.measure = measures[pos.index].number;
      highlight.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
      highlight.style.width = `${rect.width}px`;
      highlight.style.height = `${rect.height}px`;
      if (followRef.current && status === "playing") keepInView(highlight);
    },
    [measures, rects],
  );

  const seekToMeasure = useCallback(
    (index: number) => {
      const m = measures[index];
      if (m) handleRef.current?.seek(m.startSeconds);
    },
    [measures, handleRef],
  );

  /** Seeks to the start of the measure under a click inside the stage. */
  const onStageClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      const hit = measureIndexAtPoint(rects(), event.clientX - box.left, event.clientY - box.top);
      if (hit < 0) return;
      seekToMeasure(measures.findIndex((m) => m.index === hit));
    },
    [measures, rects, seekToMeasure],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      const handle = handleRef.current;
      if (!handle || measures.length === 0) return;
      event.preventDefault();
      seekToMeasure(stepMeasure(measures, handle.getPositionSeconds(), event.key === "ArrowRight" ? 1 : -1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [measures, handleRef, seekToMeasure]);

  return { cursorRef, highlightRef, onFrame, onStageClick, invalidate };
}
