// Entity IDs (APP_DESIGN.md §9.3). Swappable so golden tests can make IDs
// reproducible — the same sequence the Go oracle uses.
let source: () => string = () => crypto.randomUUID();

export function newID(): string {
  return source();
}

/** Replaces the ID generator; returns a function restoring the previous one. */
export function setIDSource(next: () => string): () => void {
  const prev = source;
  source = next;
  return () => {
    source = prev;
  };
}

/** "id-000001", "id-000002", ... — the deterministic sequence goldens use. */
export function sequentialIDs(): () => string {
  let n = 0;
  return () => `id-${String(++n).padStart(6, "0")}`;
}
