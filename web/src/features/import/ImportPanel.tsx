import { useCallback, useRef, useState } from "react";
import { uploadImport } from "../../services/api/imports";
import { Icon } from "../../shared/ui/Icon";

interface ImportPanelProps {
  onImported: (projectId: string) => void;
}

const FORMATS = ["MusicXML", ".mxl", "MIDI", ".mlight"];

export function ImportPanel({ onImported }: ImportPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setIsUploading(true);
      setErrorMessage(null);
      try {
        const result = await uploadImport(file);
        onImported(result.id);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "インポートに失敗しました。");
      } finally {
        setIsUploading(false);
      }
    },
    [onImported],
  );

  return (
    <div
      className={`import-panel${isDragging ? " import-panel--dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) void handleFile(file);
      }}
    >
      <span className="import-panel__icon" aria-hidden="true">
        <Icon name="upload" size={28} />
      </span>
      <p className="import-panel__instructions">
        MusicXML（.xml / .musicxml / .mxl）、MIDI（.mid / .midi）、MLightNoteプロジェクト（.mlight）をドラッグ&amp;ドロップするか、選択してください。
      </p>
      <button type="button" className="button button--primary" onClick={() => inputRef.current?.click()} disabled={isUploading}>
        {isUploading ? "読み込み中…" : "ファイルを選択"}
      </button>
      <ul className="import-panel__formats" aria-label="対応形式">
        {FORMATS.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <input
        ref={inputRef}
        type="file"
        accept=".xml,.musicxml,.mxl,.mid,.midi,.mlight"
        className="import-panel__file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = "";
        }}
      />
      {errorMessage && (
        <p role="alert" className="import-panel__error">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
