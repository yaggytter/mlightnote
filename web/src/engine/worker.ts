/// <reference lib="webworker" />
import { serializeError, ServiceError } from "./service/errors";
import { EngineService } from "./service/service";
import { IndexedDBStore, openDatabase } from "./storage/db";
import type { EngineOp, EngineRequest, EngineResponse } from "./protocol";

// The engine's thread: parsing, transcription and rendering run here so a
// large file never freezes the page. One message in, one message out.

const OPS: ReadonlySet<string> = new Set<EngineOp>([
  "importFile",
  "listProjects",
  "getProject",
  "command",
  "undo",
  "redo",
  "save",
  "packageFile",
  "report",
  "parts",
  "render",
  "playbackPlan",
  "deleteProject",
]);

const service = openDatabase().then((db) => new EngineService(new IndexedDBStore(db)));

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (ev: MessageEvent<EngineRequest>) => {
  const { id, op, args } = ev.data;
  let response: EngineResponse;
  const transfer: Transferable[] = [];
  try {
    if (!OPS.has(op)) throw new ServiceError(400, "UNKNOWN_OPERATION", "不明な操作です。");
    const svc = await service.catch(() => {
      throw new ServiceError(500, "STORAGE_UNAVAILABLE", "ブラウザの保存領域（IndexedDB）を開けませんでした。プライベートブラウズ中の場合は通常のウィンドウでお試しください。");
    });
    const value: unknown = await (svc[op] as (...a: unknown[]) => Promise<unknown>).apply(svc, args);
    const data = (value as { data?: unknown } | null)?.data;
    if (data instanceof Uint8Array) transfer.push(data.buffer as ArrayBuffer);
    response = { id, ok: true, value };
  } catch (e) {
    response = { id, ok: false, error: serializeError(e) };
  }
  self.postMessage(response, transfer);
};
