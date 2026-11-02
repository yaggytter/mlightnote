import { useEffect, useRef, useState } from "react";
import { fetchReport, type ImportReport as Report, type ReportWarning as Warning } from "../../services/api/reports";

const SEVERITY_LABEL: Record<Warning["severity"], string> = { info: "情報", warning: "警告", error: "エラー" };

interface ReportDialogProps {
  projectId: string;
  onClose: () => void;
}

// Import report (APP_DESIGN.md §6.1 /report, §7.1 FR-IMP-003). Uses a
// native <dialog> so focus is trapped and Escape closes it (§14.4).
export function ReportDialog({ projectId, onClose }: ReportDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
    fetchReport(projectId).then(setReport).catch((e: unknown) => setError(e instanceof Error ? e.message : "読み込みに失敗しました。"));
  }, [projectId]);

  return (
    <dialog ref={ref} className="report-dialog" onClose={onClose} aria-labelledby="report-title">
      <h2 id="report-title">インポートレポート</h2>
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <dl className="report-dialog__source">
            <dt>元ファイル</dt>
            <dd>{report.sourceName}</dd>
            <dt>形式</dt>
            <dd>{report.mediaType}</dd>
            <dt>サイズ</dt>
            <dd>{report.size.toLocaleString()} bytes</dd>
            <dt>SHA-256</dt>
            <dd className="report-dialog__hash">{report.sha256}</dd>
          </dl>
          {report.warnings.length === 0 ? (
            <p>警告はありません。</p>
          ) : (
            <table className="report-dialog__table">
              <thead>
                <tr>
                  <th>重要度</th>
                  <th>コード</th>
                  <th>小節</th>
                  <th>内容</th>
                </tr>
              </thead>
              <tbody>
                {report.warnings.map((w, i) => (
                  <tr key={i} className={`report-dialog__row--${w.severity}`}>
                    <td>{SEVERITY_LABEL[w.severity] ?? w.severity}</td>
                    <td>
                      <code>{w.code}</code>
                    </td>
                    <td>{w.element ? `—（${w.element}）` : w.measureIndex + 1}</td>
                    <td>{w.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <form method="dialog">
        <button type="submit">閉じる</button>
      </form>
    </dialog>
  );
}
