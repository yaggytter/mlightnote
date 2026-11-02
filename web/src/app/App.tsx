import { useState } from "react";
import { ImportPanel } from "../features/import/ImportPanel";
import { Library } from "../features/library/Library";
import { Manual } from "../features/help/Manual";
import { Workspace } from "../features/workspace/Workspace";
import { Icon } from "../shared/ui/Icon";
import { THEME_LABEL, useTheme } from "../shared/ui/theme";

const THEME_ICON = { system: "monitor", light: "sun", dark: "moon" } as const;

export function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const { mode, cycle } = useTheme();

  return (
    <div className="app">
      <header className="app__bar">
        <button type="button" className="brand" onClick={() => setProjectId(null)} disabled={!projectId} title="プロジェクト一覧へ">
          <span className="brand__mark" aria-hidden="true">
            <Icon name="music" size={16} />
          </span>
          <span className="brand__name">MLightNote</span>
        </button>
        <span className="app__bar-spacer" />
        <button type="button" className="icon-button" onClick={cycle} aria-label={`テーマ：${THEME_LABEL[mode]}`} title={`テーマ：${THEME_LABEL[mode]}`}>
          <Icon name={THEME_ICON[mode]} />
        </button>
      </header>
      <main className="app__main">
        {projectId ? (
          <Workspace projectId={projectId} onClose={() => setProjectId(null)} />
        ) : (
          <div className="home">
            <section className="home__hero">
              <h1 className="home__title">楽譜を開く</h1>
              <p className="home__lead">MusicXML や MIDI を読み込むと、きれいな五線譜で表示・再生・印刷できます。</p>
              <ImportPanel onImported={setProjectId} />
            </section>
            <Library onOpen={setProjectId} />
            <Manual />
          </div>
        )}
      </main>
    </div>
  );
}
