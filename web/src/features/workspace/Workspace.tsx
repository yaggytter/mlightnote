import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../services/api/client";
import { fetchParts, type PartSummary } from "../../services/api/projects";
import { fetchPlaybackPlan, type PlaybackPlan } from "../../services/api/playback";
import * as projectApi from "../../services/api/projectState";
import { onRemoteChange } from "../../services/api/sync";
import type { EditCommand, ProjectState } from "../../services/api/projectState";
import { Inspector } from "../editor/Inspector";
import { Icon } from "../../shared/ui/Icon";
import { ReportDialog } from "../reports/ReportDialog";
import { ScoreViewer } from "../score-viewer/ScoreViewer";

interface WorkspaceProps {
  projectId: string;
  onClose: () => void;
}

type SaveStatus = "idle" | "saving" | "saved" | "failed";

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function Workspace({ projectId, onClose }: WorkspaceProps) {
  const [state, setState] = useState<ProjectState | null>(null);
  const [parts, setParts] = useState<PartSummary[]>([]);
  const [plan, setPlan] = useState<PlaybackPlan | null>(null);
  const [scoreKey, setScoreKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const refreshDerived = useCallback(async () => {
    const [p, pl] = await Promise.all([fetchParts(projectId), fetchPlaybackPlan(projectId)]);
    setParts(p);
    setPlan(pl);
  }, [projectId]);

  useEffect(() => {
    setState(null);
    projectApi.fetchProjectState(projectId).then(setState).catch(() => setMessage("プロジェクトを読み込めませんでした。"));
    refreshDerived().catch(() => setMessage("パート情報を読み込めませんでした。"));
  }, [projectId, refreshDerived]);

  // Another tab edited or deleted this project: show its version now,
  // rather than on this tab's next edit as a revision conflict.
  const revision = state?.revision;
  useEffect(
    () =>
      onRemoteChange((change) => {
        if (change.projectId !== projectId) return;
        if (change.kind === "deleted") {
          setMessage("このプロジェクトは別のタブで削除されました。");
          return;
        }
        if (change.revision === undefined || change.revision === revision) return;
        void (async () => {
          try {
            setState(await projectApi.fetchProjectState(projectId));
            await refreshDerived();
            setScoreKey((k) => k + 1);
            setMessage("別のタブでの変更を読み込みました。");
          } catch {
            setMessage("別のタブでの変更を読み込めませんでした。");
          }
        })();
      }),
    [projectId, revision, refreshDerived],
  );

  // run executes one state-changing request, then refreshes whatever it
  // affects. A 409 means another tab moved on: reload the server's state
  // instead of retrying blindly (§18.2 "Revision競合: server版を再読込").
  const run = useCallback(
    async (op: (s: ProjectState) => Promise<ProjectState>, affectsScore: boolean) => {
      if (!state || busy) return;
      setBusy(true);
      setMessage(null);
      try {
        const next = await op(state);
        setState(next);
        await refreshDerived();
        if (affectsScore) setScoreKey((k) => k + 1);
      } catch (e) {
        if (e instanceof ApiError && e.code === "REVISION_CONFLICT") {
          setMessage(e.message);
          setState(await projectApi.fetchProjectState(projectId));
          await refreshDerived();
          setScoreKey((k) => k + 1);
        } else {
          setMessage(e instanceof Error ? e.message : "操作に失敗しました。");
        }
      } finally {
        setBusy(false);
      }
    },
    [state, busy, projectId, refreshDerived],
  );

  const command = useCallback(
    (cmd: EditCommand, affectsScore: boolean) => run((s) => projectApi.sendCommand(projectId, s.revision, cmd), affectsScore),
    [run, projectId],
  );

  const doUndo = useCallback(() => run((s) => projectApi.undo(projectId, s.revision), true), [run, projectId]);
  const doRedo = useCallback(() => run((s) => projectApi.redo(projectId, s.revision), true), [run, projectId]);
  const doSave = useCallback(async () => {
    if (!state || busy) return;
    setSaveStatus("saving");
    try {
      const next = await projectApi.save(projectId, state.revision);
      setState(next);
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus("failed");
      setMessage(e instanceof Error ? `保存に失敗しました：${e.message}` : "保存に失敗しました。");
    }
  }, [state, busy, projectId]);

  const download = useCallback(async () => {
    try {
      await projectApi.downloadPackage(projectId);
    } catch (e) {
      setMessage(e instanceof Error ? `ダウンロードに失敗しました：${e.message}` : "ダウンロードに失敗しました。");
    }
  }, [projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      // Save/undo/redo work even inside inputs (§6.4); other shortcuts don't.
      if (key === "s") {
        e.preventDefault();
        void doSave();
      } else if (key === "z" && !isEditableTarget(e.target)) {
        e.preventDefault();
        void (e.shiftKey ? doRedo() : doUndo());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave, doUndo, doRedo]);

  // Warn before discarding unsaved edits (§3.1 "破棄確認").
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state?.dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state?.dirty]);

  const close = () => {
    if (state?.dirty && !window.confirm("保存していない変更があります。閉じてもよろしいですか？（変更はこのブラウザに残り、次回開いたときに復元されます）")) return;
    onClose();
  };

  const statusText = !state ? "" : saveStatus === "saving" ? "保存中…" : saveStatus === "failed" ? "保存失敗" : state.dirty ? "未保存の変更あり" : "保存済み";

  return (
    <div className="workspace">
      <div className="workspace__bar" role="toolbar" aria-label="プロジェクト操作">
        <div className="workspace__heading">
          <strong className="workspace__title">{state?.metadata.title || "（無題）"}</strong>
          <span className={`workspace__status${state?.dirty ? " workspace__status--dirty" : ""}`} role="status">
            {statusText}
          </span>
        </div>
        <div className="workspace__actions">
          <div className="button-group">
            <button type="button" className="button button--ghost" onClick={() => void doUndo()} disabled={!state?.canUndo || busy} title="元に戻す (Ctrl+Z)">
              <Icon name="undo" />
              <span>元に戻す</span>
            </button>
            <button type="button" className="button button--ghost" onClick={() => void doRedo()} disabled={!state?.canRedo || busy} title="やり直す (Ctrl+Shift+Z)">
              <Icon name="redo" />
              <span>やり直す</span>
            </button>
          </div>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void doSave()}
            disabled={!state || !state.dirty || busy || saveStatus === "saving"}
            title="保存 (Ctrl+S)"
          >
            <Icon name="save" />
            <span>保存</span>
          </button>
          <button type="button" className="button" onClick={() => setReportOpen(true)}>
            <Icon name="report" />
            <span>レポート</span>
          </button>
          <button type="button" className="button workspace__download" onClick={() => void download()}>
            <Icon name="download" />
            <span>.mlightをダウンロード</span>
          </button>
          <button type="button" className="button button--ghost" onClick={close}>
            <Icon name="close" />
            <span>閉じる</span>
          </button>
        </div>
      </div>
      {message && (
        <p role="alert" className="workspace__message">
          {message}
        </p>
      )}
      {reportOpen && <ReportDialog projectId={projectId} onClose={() => setReportOpen(false)} />}
      <div className="workspace__body">
        <div className="workspace__score">
          <ScoreViewer
            projectId={projectId}
            parts={parts}
            plan={plan}
            scoreKey={scoreKey}
            busy={busy}
            onMixCommit={(updates) => {
              // Mixer changes affect only the sound, never the notation.
              if (updates.length === 1) void command({ type: "part.update", payload: updates[0] }, false);
              else void command({ type: "part.updateMany", payload: { updates } }, false);
            }}
          />
        </div>
        {state && (
          <Inspector
            state={state}
            parts={parts}
            busy={busy}
            onUpdateMetadata={(payload) => void command({ type: "score.updateMetadata", payload }, true)}
            onReorderParts={(partIds) => void command({ type: "part.reorder", payload: { partIds } }, true)}
            onUpdatePart={(partId, patch) => {
              const affectsScore = patch.name !== undefined || patch.abbreviation !== undefined || patch.visible !== undefined || patch.transpose !== undefined;
              void command({ type: "part.update", payload: { partId, ...patch } }, affectsScore);
            }}
          />
        )}
      </div>
    </div>
  );
}
