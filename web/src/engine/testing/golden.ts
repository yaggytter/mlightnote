// Test-only helpers for comparing the TypeScript engine with the Go
// golden data (docs/history/FRONTEND_MIGRATION_PLAN.md §3).
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";

export const REPO_ROOT = path.resolve(__dirname, "../../../..");
const GOLDEN_DIR = path.resolve(__dirname, "../__golden__");

export interface Fixture {
  name: string;
  source: string;
}

export function fixtures(): Fixture[] {
  return JSON.parse(readFileSync(path.join(GOLDEN_DIR, "manifest.json"), "utf8")) as Fixture[];
}

export function hasGolden(f: Fixture, file: string): boolean {
  return existsSync(path.join(GOLDEN_DIR, f.name, file + ".gz"));
}

export function goldenText(f: Fixture, file: string): string {
  return gunzipSync(readFileSync(path.join(GOLDEN_DIR, f.name, file + ".gz"))).toString("utf8");
}

export function goldenJSON(f: Fixture, file: string): unknown {
  return JSON.parse(goldenText(f, file));
}

/** A golden file stored as-is (not gzipped), e.g. package.mlight. */
export function goldenRaw(f: Fixture, file: string): Uint8Array | null {
  const p = path.join(GOLDEN_DIR, f.name, file);
  return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
}

export function sourceBytes(f: Fixture): Uint8Array {
  return new Uint8Array(readFileSync(path.join(REPO_ROOT, f.source)));
}

/**
 * Canonical form for comparing Go and TS JSON: drops what Go's omitempty
 * (and zero values vs. absent fields) would make differ without meaning —
 * null, false, 0, "", [] and {} — and rounds floats to 1e-9.
 */
export function normalize(v: unknown): unknown {
  if (v === null || v === undefined || v === false || v === "" || v === 0) return undefined;
  if (typeof v === "number") return Math.round(v * 1e9) / 1e9 || undefined;
  if (Array.isArray(v)) {
    const arr = v.map((x) => normalize(x) ?? null);
    return arr.length ? arr : undefined;
  }
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const n = normalize((v as Record<string, unknown>)[k]);
      if (n !== undefined) out[k] = n;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return v;
}

/** Points at the first difference between two normalized values. */
export function firstDifference(a: unknown, b: unknown, at = "$"): string | null {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) return `${at}: ${JSON.stringify(a)?.slice(0, 200)} vs ${JSON.stringify(b)?.slice(0, 200)}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${at}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && typeof a === "object" && b && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...keys].sort()) {
      const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${at}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${at}: ${JSON.stringify(a)?.slice(0, 200)} vs ${JSON.stringify(b)?.slice(0, 200)}`;
}

/** First differing line of two texts, with context. */
export function firstLineDifference(a: string, b: string): string | null {
  if (a === b) return null;
  const la = a.split("\n");
  const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return `line ${i + 1}:\n  ts: ${la[i]}\n  go: ${lb[i]}`;
  }
  return "texts differ";
}
