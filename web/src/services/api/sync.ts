// Tells other tabs of this app that a project changed (§18.2), so a stale
// tab reloads instead of working on old data. Revisions still guard every
// write; this only makes the other tab notice sooner.

export interface ProjectChange {
  kind: "created" | "updated" | "deleted";
  projectId: string;
  revision?: number;
}

const CHANNEL_NAME = "mlightnote-projects";
let channel: BroadcastChannel | null | undefined;

function projectChannel(): BroadcastChannel | null {
  if (channel === undefined) channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

export function announce(change: ProjectChange): void {
  projectChannel()?.postMessage(change);
}

/** Calls onChange for changes made in other tabs; returns an unsubscribe. */
export function onRemoteChange(onChange: (change: ProjectChange) => void): () => void {
  const ch = projectChannel();
  if (!ch) return () => undefined;
  const handler = (e: MessageEvent<ProjectChange>) => onChange(e.data);
  ch.addEventListener("message", handler);
  return () => ch.removeEventListener("message", handler);
}
