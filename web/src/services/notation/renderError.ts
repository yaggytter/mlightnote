/**
 * Describes a failed score render for the user. The notation engine
 * (OSMD/VexFlow) often throws plain objects rather than Error instances —
 * e.g. `{ code: "BadArguments", message: "Beams can only be applied to…" }`
 * — so the cause is read from whatever was thrown, instead of hiding it
 * behind a generic message.
 */
export function describeRenderError(error: unknown): string {
  const detail = errorDetail(error);
  return detail ? `楽譜を描画できませんでした（描画エンジンのエラー：${detail}）。` : "楽譜を描画できませんでした。";
}

function errorDetail(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (error && typeof error === "object") {
    const { code, message } = error as { code?: unknown; message?: unknown };
    const text = typeof message === "string" ? message.trim() : "";
    const name = typeof code === "string" ? code : "";
    if (text) return name && !text.startsWith(name) ? `${name}: ${text}` : text;
    const str = String(error);
    return str === "[object Object]" ? "" : str;
  }
  return "";
}
