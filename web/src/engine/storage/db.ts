import type { CanonicalScore, ImportReport } from "../domain/types";
import type { State } from "../editing/commands";

// Project storage in IndexedDB (replaces Go internal/storage). Every
// service operation runs inside ONE transaction: IndexedDB serializes
// overlapping readwrite transactions, across tabs too, which is what the
// Go server's per-project lock provided. Inside a transaction only
// IndexedDB requests may be awaited, or it auto-commits early.

const DB_NAME = "mlightnote";
const DB_VERSION = 1;
const PROJECTS = "projects";
const DATA = "data";

/** One row of the project index (Go domain.Project). */
export interface ProjectMeta {
  id: string;
  title: string;
  sourceName: string;
  mediaType: string;
  sha256: string;
  size: number;
  createdAt: string;
  warningCount: number;
}

/** The per-project blobs, stored under [projectId, kind]. */
export interface ProjectData {
  original: Uint8Array;
  score: CanonicalScore;
  report: ImportReport;
  state: State;
}

export class StorageError extends Error {}

export interface Tx {
  getMeta(id: string): Promise<ProjectMeta | undefined>;
  listMeta(): Promise<ProjectMeta[]>;
  get<K extends keyof ProjectData>(id: string, kind: K): Promise<ProjectData[K] | undefined>;
  putMeta(meta: ProjectMeta): Promise<void>;
  put<K extends keyof ProjectData>(id: string, kind: K, value: ProjectData[K]): Promise<void>;
  deleteProject(id: string): Promise<void>;
}

export interface ProjectStore {
  run<T>(mode: IDBTransactionMode, fn: (tx: Tx) => Promise<T>): Promise<T>;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new StorageError("IndexedDB request failed"));
  });
}

export function openDatabase(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading the schema: step aside rather than block it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new StorageError("cannot open IndexedDB"));
    req.onblocked = () => reject(new StorageError("IndexedDB is blocked by another tab"));
  });
}

function txFor(t: IDBTransaction): Tx {
  const projects = t.objectStore(PROJECTS);
  const data = t.objectStore(DATA);
  return {
    getMeta: (id) => request(projects.get(id) as IDBRequest<ProjectMeta | undefined>),
    listMeta: () => request(projects.getAll() as IDBRequest<ProjectMeta[]>),
    get: (id, kind) => request(data.get([id, kind])),
    putMeta: async (meta) => {
      await request(projects.put(meta));
    },
    put: async (id, kind, value) => {
      await request(data.put(value, [id, kind]));
    },
    deleteProject: async (id) => {
      await request(projects.delete(id));
      await request(data.delete(IDBKeyRange.bound([id], [id, []])));
    },
  };
}

export class IndexedDBStore implements ProjectStore {
  constructor(private readonly db: IDBDatabase) {}

  async run<T>(mode: IDBTransactionMode, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const t = this.db.transaction([PROJECTS, DATA], mode);
    const done = new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error ?? new StorageError("transaction failed"));
      t.onabort = () => reject(t.error ?? new StorageError("transaction aborted"));
    });
    let result: T;
    try {
      result = await fn(txFor(t));
    } catch (e) {
      try {
        t.abort(); // nothing from a failed operation is kept
      } catch {
        // already finished
      }
      done.catch(() => undefined);
      throw e;
    }
    await done; // resolve only once the writes are durable
    return result;
  }
}
