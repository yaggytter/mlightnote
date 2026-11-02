import { ApiError } from "./client";
import { callEngine } from "./engine";
import { requestPersistentStorage } from "./persistence";
import { announce } from "./sync";

export interface ImportResult {
  id: string;
  title: string;
  sourceName: string;
  sha256: string;
  size: number;
  createdAt: string;
}

export class ImportError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** The largest file accepted (the engine checks it again). */
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export async function uploadImport(file: File): Promise<ImportResult> {
  // Checked before reading, so a huge file is never loaded into memory.
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ImportError("IMPORT_INVALID_UPLOAD", "アップロードを読み取れませんでした。ファイルサイズの上限を確認してください。");
  }
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    const result = await callEngine("importFile", [file.name, data], [data.buffer]);
    announce({ kind: "created", projectId: result.id });
    // The first saved project is when keeping the data starts to matter.
    await requestPersistentStorage();
    return result;
  } catch (e) {
    if (e instanceof ApiError) throw new ImportError(e.code, e.message);
    throw e;
  }
}

