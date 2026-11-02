import { useEffect, useMemo, useState } from "react";
import { persistenceState, type PersistenceState } from "../../services/api/persistence";
import { deleteProject, listProjects, type ProjectSummary } from "../../services/api/projectState";
import { onRemoteChange } from "../../services/api/sync";
import { Icon } from "../../shared/ui/Icon";

/** A short badge for the source file's format. */
export function formatKind(sourceName: string): string {
  const ext = sourceName.toLowerCase().split(".").pop() ?? "";
  if (ext === "mid" || ext === "midi") return "MIDI";
  if (ext === "mlight") return "MLIGHT";
  if (ext === "mxl") return "MXL";
  return "XML";
}

interface LibraryProps {
  onOpen: (projectId: string) => void;
}

type SortKey = "updated" | "title";

// The project list (APP_DESIGN.md §7.9): title filter and sort. Projects
// live in this browser's storage, so this is also how a user gets back to
// work after closing the tab.
export function Library({ onOpen }: LibraryProps) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [persistence, setPersistence] = useState<PersistenceState>("unsupported");

  useEffect(() => {
    const load = () => listProjects().then(setProjects).catch(() => setProjects([]));
    void load();
    void persistenceState().then(setPersistence);
    // Imports, deletes and retitles in other tabs show up here too.
    return onRemoteChange(() => void load());
  }, []);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = (projects ?? []).filter((p) => !q || p.title.toLowerCase().includes(q));
    return [...list].sort((a, b) => (sort === "title" ? a.title.localeCompare(b.title, "ja") : b.createdAt.localeCompare(a.createdAt)));
  }, [projects, filter, sort]);

  // Deletion can't be undone, so it always asks first and names the file.
  const handleDelete = async (p: ProjectSummary) => {
    if (!window.confirm(`「${p.title}」を削除しますか？\n保存した内容もすべて削除され、元に戻せません。`)) return;
    setDeletingId(p.id);
    setError(null);
    try {
      await deleteProject(p.id);
      setProjects((list) => (list ?? []).filter((x) => x.id !== p.id));
    } catch (e) {
      setError(e instanceof Error ? `削除できませんでした：${e.message}` : "削除できませんでした。");
    } finally {
      setDeletingId(null);
    }
  };

  if (projects === null) return <p>読み込み中…</p>;
  if (projects.length === 0) return null;

  return (
    <section className="library" aria-label="プロジェクト一覧">
      <div className="library__header">
        <h2>最近のプロジェクト</h2>
        <div className="library__controls">
          <input type="search" placeholder="曲名で絞り込み" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="曲名で絞り込み" />
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="並べ替え">
            <option value="updated">新しい順</option>
            <option value="title">曲名順</option>
          </select>
        </div>
      </div>
      <p className="library__storage-note">
        プロジェクトはこのブラウザの中だけに保存されます（サーバーには送信されません）。
        {persistence === "persisted"
          ? "ブラウザには消さないよう設定済みですが、"
          : "ブラウザの空き容量が少ないときや、閲覧データを削除したときに消えることがあります。"}
        大切な曲は作業画面の「.mlightをダウンロード」でバックアップしてください。
      </p>
      {error && (
        <p role="alert" className="library__error">
          {error}
        </p>
      )}
      <ul className="library__list">
        {shown.map((p) => (
          <li key={p.id} className="library__item">
            <button type="button" className="library__open" onClick={() => onOpen(p.id)}>
              <span className="library__badge" data-kind={formatKind(p.sourceName)}>
                {formatKind(p.sourceName)}
              </span>
              <span className="library__title">{p.title}</span>
              <span className="library__meta">
                {p.sourceName}
                <br />
                {new Date(p.createdAt).toLocaleString("ja-JP")}
                {p.warningCount > 0 && ` ・ 警告 ${p.warningCount}件`}
              </span>
            </button>
            <button
              type="button"
              className="library__delete icon-button"
              onClick={() => void handleDelete(p)}
              disabled={deletingId !== null}
              aria-label={`「${p.title}」を削除`}
              title="削除"
            >
              {deletingId === p.id ? "…" : <Icon name="trash" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
