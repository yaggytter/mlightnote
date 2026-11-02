import type { EngineArgs, EngineOp, EngineRequest, EngineResponse, EngineResult } from "../../engine/protocol";
import { ApiError } from "./client";

// Calls into the in-browser engine (a module Worker, same origin, so the
// production CSP `default-src 'self'` allows it). Failures come back as
// ApiError with the engine's code and message.

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

function engineWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../../engine/worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent<EngineResponse>) => {
    const res = ev.data;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.value);
    else p.reject(new ApiError(res.error.status, res.error));
  };
  worker.onerror = (ev) => {
    ev.preventDefault();
    const err = new ApiError(500, { code: "ENGINE_FAILED", message: "処理エンジンの起動に失敗しました。ページを再読み込みしてください。" });
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function callEngine<K extends EngineOp>(op: K, args: EngineArgs<K>, transfer: Transferable[] = []): Promise<EngineResult<K>> {
  const id = nextId++;
  const request: EngineRequest = { id, op, args };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    engineWorker().postMessage(request, transfer);
  });
}
