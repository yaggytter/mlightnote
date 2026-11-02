import type { SerializedError } from "./service/errors";
import type { EngineService } from "./service/service";

// The message shapes between the page and the engine Worker.

export type EngineOp = {
  [K in keyof EngineService]: EngineService[K] extends (...args: never[]) => Promise<unknown> ? K : never;
}[keyof EngineService];

export type EngineArgs<K extends EngineOp> = Parameters<EngineService[K]>;
export type EngineResult<K extends EngineOp> = Awaited<ReturnType<EngineService[K]>>;

export interface EngineRequest {
  id: number;
  op: EngineOp;
  args: unknown[];
}

export type EngineResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: SerializedError };
