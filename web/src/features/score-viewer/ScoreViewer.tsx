import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRenderMusicXml, type PartSummary } from "../../services/api/projects";
import type { PlaybackPlan } from "../../services/api/playback";
import { createOsmdNotationRenderer } from "../../services/notation/OsmdNotationRenderer";
import type { NotationRenderer, StaffLabel } from "../../services/notation/NotationRenderer";
import { StaffLabels } from "./StaffLabels";
import { PlaybackControls, type PlaybackHandle } from "../playback/PlaybackControls";
import { PrintView } from "../printing/PrintView";
import { usePlaybackCursor } from "./usePlaybackCursor";
import { ViewToolbar } from "./ViewToolbar";
import type { MixUpdate } from "../playback/mixer";

const NO_MEASURES: never[] = [];

interface ScoreViewerProps {
  projectId: string;
  parts: PartSummary[];
  plan: PlaybackPlan | null;
  /** Bumped by the workspace whenever an edit changes what the score shows. */
  scoreKey: number;
  /** Records mixer changes as one edit (enables the mixer panel). */
  onMixCommit?: (updates: MixUpdate[]) => void;
  /** An edit is in flight. */
  busy?: boolean;
}

export function ScoreViewer({ projectId, parts, plan, scoreKey, onMixCommit, busy }: ScoreViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<NotationRenderer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [partIds, setPartIds] = useState<string[]>([]);
  const [concertPitch, setConcertPitch] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [printOpen, setPrintOpen] = useState(false);
  const [follow, setFollow] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [staffLabels, setStaffLabels] = useState<StaffLabel[]>([]);
  const refreshLabels = useCallback(() => setStaffLabels(rendererRef.current?.staffLabels() ?? []), []);
  // Whether the label rail is reserved beside the paper. Decided before
  // rendering (from the parts shown), so the score is laid out for the
  // narrower width instead of being pushed sideways afterwards.
  const shownPartCount = partIds.length > 0 ? partIds.length : parts.filter((p) => p.mix.visible !== false).length;
  const labelRail = showLabels && shownPartCount > 1;
  const playbackRef = useRef<PlaybackHandle | null>(null);
  const readRects = useCallback(() => rendererRef.current?.measureRects() ?? [], []);
  const cursor = usePlaybackCursor({
    measures: plan?.measures ?? NO_MEASURES,
    readRects,
    handleRef: playbackRef,
    follow,
  });
  const { invalidate } = cursor;

  useEffect(() => setPartIds([]), [projectId]);

  // Re-render the score when what it shows changes. Switching parts keeps
  // playback running: the engine lives in PlaybackControls, independent of
  // this render (APP_DESIGN.md §6.3 "再生中にパートを切り替えても再生を継続").
  useEffect(() => {
    if (printOpen) return;
    let cancelled = false;
    setStatus("loading");
    setErrorMessage(null);
    if (!rendererRef.current) {
      rendererRef.current = createOsmdNotationRenderer();
    }
    (async () => {
      const musicXml = await fetchRenderMusicXml(projectId, { partIds, concertPitch });
      if (cancelled || !containerRef.current) return;
      await rendererRef.current!.render(containerRef.current, musicXml, { zoom });
      invalidate();
      refreshLabels();
      if (!cancelled) setStatus("ready");
    })().catch((error: unknown) => {
      if (cancelled) return;
      setErrorMessage(error instanceof Error ? error.message : "描画に失敗しました。");
      setStatus("error");
    });
    return () => {
      cancelled = true;
    };
    // zoom is applied separately below without refetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, partIds, concertPitch, printOpen, scoreKey, labelRail]);

  useEffect(() => {
    if (status === "ready") {
      try {
        rendererRef.current?.setZoom(zoom);
        refreshLabels();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "描画に失敗しました。");
        setStatus("error");
      }
    }
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // OSMD re-lays out on its own (e.g. its debounced autoResize), replacing
  // the SVG; measure boxes cached before that would place the cursor wrong.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || printOpen) return;
    const observer = new MutationObserver(() => {
      invalidate();
      refreshLabels();
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [invalidate, refreshLabels, printOpen]);

  useEffect(
    () => () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    },
    [],
  );

  return (
    <div className="score-viewer">
      {printOpen ? (
        <PrintView projectId={projectId} partIds={partIds} concertPitch={concertPitch} onClose={() => setPrintOpen(false)} />
      ) : (
        <>
          <ViewToolbar
            parts={parts}
            selectedPartIds={partIds}
            onSelectParts={setPartIds}
            concertPitch={concertPitch}
            onToggleConcertPitch={() => setConcertPitch((v) => !v)}
            zoom={zoom}
            onZoom={setZoom}
            onPrint={() => setPrintOpen(true)}
            follow={follow}
            onToggleFollow={() => setFollow((v) => !v)}
            showLabels={showLabels}
            onToggleLabels={shownPartCount > 1 ? () => setShowLabels((v) => !v) : undefined}
          />
          <div className="score-desk">
            {status === "loading" && (
              <p className="score-viewer__status">
                <span className="spinner" aria-hidden="true" />
                読み込み中…
              </p>
            )}
            {status === "error" && (
              <p role="alert" className="score-viewer__status score-viewer__status--error">
                {errorMessage}
              </p>
            )}
            {/* Clicking a measure seeks there; ←/→ step by measure (same as the seek bar, keyboard-accessible). */}
            <div
              className={`score-viewer__stage${labelRail ? " score-viewer__stage--labeled" : ""}`}
              onClick={cursor.onStageClick}
            >
              {labelRail && <StaffLabels labels={staffLabels} />}
              <div ref={containerRef} className="score-viewer__canvas" data-testid="score-canvas" />
              <div ref={cursor.highlightRef} className="score-cursor__measure" hidden aria-hidden="true" />
              <div ref={cursor.cursorRef} className="score-cursor" data-testid="score-cursor" hidden aria-hidden="true" />
            </div>
          </div>
        </>
      )}
      {/* The transport stays mounted (and playing) across part switches and print preview. */}
      {plan && <PlaybackControls plan={plan} handleRef={playbackRef} onFrame={cursor.onFrame} parts={parts} onMixCommit={onMixCommit} busy={busy} />}
    </div>
  );
}
