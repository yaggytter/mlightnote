import { EditError, ValidationError } from "../editing/commands";

// Service failures carry the same status, code and Japanese message as the
// Go API's error envelope (§12.1), so the UI branches on identical codes.
// Only plain data crosses the Worker boundary: structured clone drops
// custom fields on Error subclasses.

export interface ErrorDetail {
  field: string;
  reason: string;
}

export interface SerializedError {
  status: number;
  code: string;
  message: string;
  details?: ErrorDetail[];
}

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
  }

  toJSON(): SerializedError {
    return { status: this.status, code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

export const notFound = () => new ServiceError(404, "PROJECT_NOT_FOUND", "プロジェクトが見つかりません。");
export const internal = (message: string) => new ServiceError(500, "INTERNAL_ERROR", message);

export function editingError(err: unknown): ServiceError {
  if (err instanceof ServiceError) return err;
  if (err instanceof ValidationError) {
    return new ServiceError(422, "VALIDATION_FAILED", "入力値が不正です。", [{ field: err.field, reason: err.reason }]);
  }
  if (err instanceof EditError) {
    switch (err.code) {
      case "REVISION_CONFLICT":
        return new ServiceError(409, "REVISION_CONFLICT", "他の画面で先に変更されました。最新の状態を読み込み直してください。");
      case "COMMAND_ID_REUSED":
        return new ServiceError(409, "COMMAND_ID_REUSED", "同じコマンドIDが異なる内容で再利用されました。");
      case "NOTHING_TO_UNDO":
        return new ServiceError(409, "NOTHING_TO_UNDO", "元に戻せる操作がありません。");
      case "NOTHING_TO_REDO":
        return new ServiceError(409, "NOTHING_TO_REDO", "やり直せる操作がありません。");
    }
  }
  return internal("内部エラーが発生しました。");
}

/** Any thrown value as plain data, for postMessage. */
export function serializeError(err: unknown): SerializedError {
  if (err instanceof ServiceError) return err.toJSON();
  return internal("内部エラーが発生しました。").toJSON();
}
