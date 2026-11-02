export interface ApiErrorBody {
  code: string;
  message: string;
  details?: { field: string; reason: string }[];
}

// A failed engine operation, with the stable code callers branch on (e.g.
// REVISION_CONFLICT), never on message text. The codes and messages are
// those of the original server API (§12.1).
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: ApiErrorBody["details"];
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}
