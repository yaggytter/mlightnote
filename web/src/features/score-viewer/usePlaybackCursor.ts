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

/** Air left between the sticky toolbar and the system brought into view. */
export const FOLLOW_GAP_PX = 8;
/** The most room kept above a system for its chord names, marks, and measure numbers. */
export const MAX_HEADROOM_PX = 120;
// Used when no transport bar is found: its usual height plus a little air.
const DOCK_FALLBACK_PX = 140;

interface Band {
  top: number;
  bottom: number;
}

/**
 * The room to keep visible above a measure's box. The boxes cover the
 * staves only, while chord names, tempo and rehearsal marks, and measure
 * numbers sit above them, in the space up to the previous system. So this
 * is that space (or the distance to the top, for the first system), capped.
 */
export function headroomAbove(rects: MeasureRect[], rect: MeasureRect, max: number): number {
  let above = 0;
  for (const r of rects) {
    const bottom = r.y + r.height;
    if (r.width > 0 && bottom <= rect.y && bottom > above) above = bottom;
  }
  return Math.min(max, Math.max(0, rect.y - above));
}

/**
 * Where to scroll so the playing measure is visible, or null to stay put.
 * `box` is the measure's box with its headroom; `visible` is the part of
 * the scroller not covered by the sticky toolbar and the docked transport
 * (viewport coordinates, both). A measure out of that band is brought up
 * to just under the toolbar, so the band shows its system and what
 * follows, like turning a page. Centring it a third of the way down left
 * music already played at the band's top and cut tall systems off under
 * the transport.
 */
export function followScrollTop(box: Band, visible: Band, scrollTop: number): number | null {
  if (box.top >= visible.top && box.bottom <= visible.bottom) return null;
  const target = Math.max(0, scrollTop + (box.top - visible.top) - FOLLOW_GAP_PX);
  return Math.abs(target - scrollTop) < 1 ? null : target;
}

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

/** The scroller's band not covered by its sticky toolbar and transport (`data-follow-inset`). */
function clearBand(container: HTMLElement): Band {
  const view = container.getBoundingClientRect();
  const toolbar = container.querySelector<HTMLElement>('[data-follow-inset="top"]');
  const dock = container.querySelector<HTMLElement>('[data-follow-inset="bottom"]');
  const top = toolbar ? Math.max(view.top, toolbar.getBoundingClientRect().bottom) : view.top;
  const bottom = dock ? Math.min(view.bottom, dock.getBoundingClientRect().top) : view.bottom - DOCK_FALLBACK_PX;
  return { top, bottom };
}

function keepInView(el: HTMLElement, headroom: number) {
  const container = scrollParent(el);
  if (!container) return;
  const box = el.getBoundingClientRect();
  const top = followScrollTop({ top: box.top - headroom, bottom: box.bottom }, clearBand(container), container.scrollTop);
  if (top === null) return;
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
      if (followRef.current && status === "playing") keepInView(highlight, headroomAbove(rects(), rect, MAX_HEADROOM_PX));
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
