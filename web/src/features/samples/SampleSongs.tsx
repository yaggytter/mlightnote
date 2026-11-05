import { useState } from "react";
import { uploadImport } from "../../services/api/imports";
import { Icon } from "../../shared/ui/Icon";
import { sampleFile } from "./smf";
import { SAMPLE_SONGS, type SampleSong } from "./songs";

interface SampleSongsProps {
  onImported: (projectId: string) => void;
}

// Built-in songs for a first visit, when the user has no file at hand
// (APP_DESIGN.md §7.1). Each opens through the normal MIDI import, so it
// becomes an ordinary project the user can edit, save, and delete.
export function SampleSongs({ onImported }: SampleSongsProps) {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const open = async (song: SampleSong) => {
    setOpeningId(song.id);
    setErrorMessage(null);
    try {
      const result = await uploadImport(sampleFile(song));
      onImported(result.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? `サンプル曲を開けませんでした：${error.message}` : "サンプル曲を開けませんでした。");
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <section className="samples" aria-labelledby="samples-title">
      <h2 id="samples-title" className="samples__title">
        サンプル曲で試す
      </h2>
      <p className="samples__lead">ファイルが手元に無くても、著作権の切れた名曲ですぐに表示と再生を試せます（MIDI から採譜します）。</p>
      <ul className="samples__list">
        {SAMPLE_SONGS.map((song) => (
          <li key={song.id}>
            <button
              type="button"
              className="samples__open"
              onClick={() => void open(song)}
              disabled={openingId !== null}
              aria-label={`サンプル曲「${song.title}」（${song.composer}）を開く`}
            >
              <span className="samples__icon" aria-hidden="true">
                <Icon name="music" size={16} />
              </span>
              <span className="samples__name">{openingId === song.id ? "読み込み中…" : song.title}</span>
              <span className="samples__composer">{song.composer}</span>
              <span className="samples__note">{song.note}</span>
            </button>
          </li>
        ))}
      </ul>
      {errorMessage && (
        <p role="alert" className="samples__error">
          {errorMessage}
        </p>
      )}
    </section>
  );
}
