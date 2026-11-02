// Asks the browser not to evict this site's storage when disk runs low
// (§5 of docs/history/FRONTEND_MIGRATION_PLAN.md). Browsers may grant it silently, ask the
// user, or refuse; either way the app keeps working.

export type PersistenceState = "persisted" | "best-effort" | "unsupported";

export async function persistenceState(): Promise<PersistenceState> {
  if (!navigator.storage?.persisted) return "unsupported";
  try {
    return (await navigator.storage.persisted()) ? "persisted" : "best-effort";
  } catch {
    return "unsupported";
  }
}

export async function requestPersistentStorage(): Promise<PersistenceState> {
  const current = await persistenceState();
  if (current !== "best-effort" || !navigator.storage.persist) return current;
  try {
    return (await navigator.storage.persist()) ? "persisted" : "best-effort";
  } catch {
    return "best-effort";
  }
}
