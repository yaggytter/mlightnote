import { zipSync, type Zippable } from "fflate";
import { emptyOverlay, type EditOverlay } from "../domain/overlay";
import type { CanonicalScore, ImportReport } from "../domain/types";
import { sha256Hex } from "../util/sha256";
import { checkArchive, isZip, listEntries, readEntry, strictZipPath, type ZipEntryInfo, type ZipLimits } from "../zip/safezip";

// The .mlight project package (APP_DESIGN.md §10): a ZIP with an
// uncompressed mimetype first entry, a manifest listing every other
// entry's size and SHA-256, the canonical score, the edit overlay and the
// byte-exact original. Port of Go internal/mlight: packages written by the
// server version open here unchanged. Reading treats the file as hostile
// and rejects it whole on any failed check.

export const MLIGHT_MIME_TYPE = "application/vnd.mlightnote.project+zip";
const FORMAT_NAME = "mlightnote-project";
const SCHEMA_VERSION = "1.0.0";
const MINIMUM_READER_VERSION = "1.0.0";
const APPLICATION_VERSION = "0.1.0";
const FEATURE_CANONICAL_V1 = "canonical-score-v1";
const FEATURE_OVERLAY_V1 = "edit-overlay-v1";
const KNOWN_REQUIRED_FEATURES = new Set([FEATURE_CANONICAL_V1, FEATURE_OVERLAY_V1]);

const PATH_SCORE = "score/canonical-score.json";
const PATH_OVERLAY = "score/edit-overlay.json";
const PATH_SOURCE_INDEX = "sources/source-index.json";
const PATH_REPORT = "reports/import-report.json";

export const DEFAULT_LIMITS: ZipLimits = { maxEntries: 1000, maxUncompressed: 200 << 20, maxRatio: 200 };

/** ZIP timestamps are pinned so identical packages are identical bytes. */
const EPOCH = new Date(Date.UTC(2020, 0, 1));

export type MlightErrorKind = "NOT_MLIGHT" | "CORRUPT" | "NEWER_VERSION" | "UNSAFE_ENTRY" | "LIMIT_EXCEEDED";

export class MlightError extends Error {
  constructor(
    readonly kind: MlightErrorKind,
    message: string,
  ) {
    super(`mlight: ${message}`);
  }
}

export interface MlightSource {
  id: string;
  filename: string;
  mediaType: string;
  data: Uint8Array;
}

export interface MlightPackage {
  projectId: string;
  revision: number;
  /** RFC 3339 timestamps, as Go's time.Time JSON. */
  createdAt: string;
  updatedAt: string;
  score: CanonicalScore;
  overlay: EditOverlay;
  report: ImportReport;
  source: MlightSource;
  /** Optional entries this version doesn't understand, kept byte-for-byte. */
  extra: Map<string, Uint8Array>;
}

interface ManifestEntry {
  path: string;
  mediaType: string;
  size: number;
  sha256: string;
  required: boolean;
}

interface Manifest {
  format: string;
  schemaVersion: string;
  minimumReaderVersion: string;
  applicationVersion: string;
  projectId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  requiredFeatures: string[] | null;
  optionalFeatures: string[] | null;
  entries: ManifestEntry[] | null;
}

const encoder = new TextEncoder();
const json = (v: unknown) => encoder.encode(JSON.stringify(v, null, 2));

export function looksLikeMlight(data: Uint8Array): boolean {
  return data.length > 38 && isZip(data) && String.fromCharCode(...data.subarray(30, 38)) === "mimetype";
}

export function writeMlight(pkg: MlightPackage): Uint8Array {
  const srcPath = `sources/${pkg.source.id}/original.bin`;
  const files = new Map<string, { data: Uint8Array; mediaType: string; required: boolean }>();
  const add = (p: string, mediaType: string, data: Uint8Array, required: boolean) => files.set(p, { data, mediaType, required });

  add(PATH_SCORE, "application/json", json(pkg.score), true);
  add(PATH_OVERLAY, "application/json", json(pkg.overlay), true);
  add(
    PATH_SOURCE_INDEX,
    "application/json",
    json([{ id: pkg.source.id, filename: pkg.source.filename, mediaType: pkg.source.mediaType, path: srcPath, sha256: sha256Hex(pkg.source.data) }]),
    true,
  );
  add(srcPath, "application/octet-stream", pkg.source.data, true);
  add(PATH_REPORT, "application/json", json(pkg.report), false);
  for (const [p, data] of pkg.extra) if (!files.has(p)) add(p, "application/octet-stream", data, false);

  const paths = [...files.keys()].sort(); // byte order, like Go's sort.Strings for these ASCII paths
  const manifest: Manifest = {
    format: FORMAT_NAME,
    schemaVersion: SCHEMA_VERSION,
    minimumReaderVersion: MINIMUM_READER_VERSION,
    applicationVersion: APPLICATION_VERSION,
    projectId: pkg.projectId,
    revision: pkg.revision,
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
    requiredFeatures: [FEATURE_CANONICAL_V1, FEATURE_OVERLAY_V1],
    optionalFeatures: [],
    entries: paths.map((p) => {
      const f = files.get(p)!;
      return { path: p, mediaType: f.mediaType, size: f.data.length, sha256: sha256Hex(f.data), required: f.required };
    }),
  };

  // Insertion order is entry order: mimetype, manifest, then sorted paths.
  const zipFiles: Zippable = {
    mimetype: [encoder.encode(MLIGHT_MIME_TYPE), { level: 0, mtime: EPOCH }],
    "manifest.json": [json(manifest), { level: 6, mtime: EPOCH }],
  };
  for (const p of paths) zipFiles[p] = [files.get(p)!.data, { level: 6, mtime: EPOCH }];
  return zipSync(zipFiles);
}

export function readMlight(data: Uint8Array, limits: ZipLimits = DEFAULT_LIMITS): MlightPackage {
  let entries: ZipEntryInfo[];
  try {
    entries = listEntries(data);
  } catch {
    throw new MlightError("NOT_MLIGHT", "not an .mlight package");
  }
  if (entries.length === 0 || entries[0].name !== "mimetype" || entries[0].compression !== 0) {
    throw new MlightError("NOT_MLIGHT", "not an .mlight package");
  }
  const fail = (reason: string): never => {
    throw new MlightError(/size limit|too many|ratio/.test(reason) ? "LIMIT_EXCEEDED" : "UNSAFE_ENTRY", reason);
  };
  for (const e of entries) if (!strictZipPath(e.name)) fail(`unsafe entry ${JSON.stringify(e.name)}`);
  checkArchive(data, limits, fail);

  const corrupt = (reason: string): never => {
    throw new MlightError("CORRUPT", reason);
  };
  const contents = new Map<string, Uint8Array>();
  for (const e of entries) contents.set(e.name, readEntry(data, e, limits, (r) => (/ratio/.test(r) ? fail(r) : corrupt(r))));

  if (new TextDecoder().decode(contents.get("mimetype")) !== MLIGHT_MIME_TYPE) throw new MlightError("NOT_MLIGHT", "wrong mimetype");
  const m = decodeManifest(contents.get("manifest.json"));
  if (!m || m.format !== FORMAT_NAME) corrupt("invalid manifest");
  const manifest = m!;
  if (major(manifest.schemaVersion) !== major(SCHEMA_VERSION) || major(manifest.minimumReaderVersion) > major(SCHEMA_VERSION)) {
    throw new MlightError("NEWER_VERSION", "requires a newer version of the app");
  }
  for (const feat of manifest.requiredFeatures ?? []) {
    if (!KNOWN_REQUIRED_FEATURES.has(feat)) throw new MlightError("NEWER_VERSION", `unknown required feature ${feat}`);
  }

  const declared = new Map<string, ManifestEntry>();
  for (const e of manifest.entries ?? []) {
    if (declared.has(e.path)) corrupt(`duplicate manifest entry ${e.path}`);
    declared.set(e.path, e);
    const b = contents.get(e.path);
    if (!b || b.length !== e.size || sha256Hex(b) !== e.sha256) corrupt(`${e.path} failed size/checksum verification`);
  }
  for (const name of contents.keys()) {
    if (name !== "mimetype" && name !== "manifest.json" && !declared.has(name)) corrupt(`undeclared entry ${JSON.stringify(name)}`);
  }

  const score = parseJSON<CanonicalScore>(contents.get(PATH_SCORE), corrupt);
  const overlay = parseJSON<EditOverlay>(contents.get(PATH_OVERLAY), corrupt);
  if (!overlay || typeof overlay !== "object") corrupt("invalid overlay");
  const fullOverlay: EditOverlay = { ...emptyOverlay(), ...overlay, parts: overlay.parts ?? {} };
  const report = contents.has(PATH_REPORT) ? parseJSON<ImportReport>(contents.get(PATH_REPORT), corrupt) : { Warnings: null };
  const index = parseJSON<{ id: string; filename: string; mediaType: string; path: string; sha256: string }[]>(contents.get(PATH_SOURCE_INDEX), corrupt);
  if (!Array.isArray(index) || index.length === 0) corrupt("empty source index");
  const src = contents.get(index[0].path);
  if (!src || sha256Hex(src) !== index[0].sha256) corrupt("source checksum mismatch");

  const known = new Set([PATH_SCORE, PATH_OVERLAY, PATH_SOURCE_INDEX, PATH_REPORT, index[0].path]);
  const extra = new Map<string, Uint8Array>();
  for (const [p, e] of declared) {
    if (known.has(p)) continue;
    if (e.required) throw new MlightError("NEWER_VERSION", `unknown required entry ${p}`);
    extra.set(p, contents.get(p)!);
  }
  return {
    projectId: manifest.projectId,
    revision: manifest.revision,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    score,
    overlay: fullOverlay,
    report: report ?? { Warnings: null },
    source: { id: index[0].id, filename: index[0].filename, mediaType: index[0].mediaType, data: src! },
    extra,
  };
}

function parseJSON<T>(b: Uint8Array | undefined, corrupt: (r: string) => never): T {
  if (!b) corrupt("missing entry");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b)) as T;
  } catch {
    return corrupt("invalid JSON");
  }
}

const MANIFEST_FIELDS: Record<keyof Manifest, "string" | "number" | "array"> = {
  format: "string",
  schemaVersion: "string",
  minimumReaderVersion: "string",
  applicationVersion: "string",
  projectId: "string",
  revision: "number",
  createdAt: "string",
  updatedAt: "string",
  requiredFeatures: "array",
  optionalFeatures: "array",
  entries: "array",
};
const ENTRY_FIELDS: Record<keyof ManifestEntry, "string" | "number" | "boolean"> = { path: "string", mediaType: "string", size: "number", sha256: "string", required: "boolean" };

/** Strict decode, like Go's DisallowUnknownFields: unknown keys or wrong types reject. */
function decodeManifest(b: Uint8Array | undefined): Manifest | null {
  let v: unknown;
  try {
    v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b));
  } catch {
    return null;
  }
  if (!isRecord(v)) return null;
  for (const [k, val] of Object.entries(v)) {
    const want = (MANIFEST_FIELDS as Record<string, string>)[k];
    if (!want) return null;
    if (val === null) continue;
    if (want === "array" ? !Array.isArray(val) : typeof val !== want) return null;
  }
  for (const list of ["requiredFeatures", "optionalFeatures"] as const) {
    if (v[list] != null && !(v[list] as unknown[]).every((x) => typeof x === "string")) return null;
  }
  for (const e of (v.entries as unknown[] | null) ?? []) {
    if (!isRecord(e)) return null;
    for (const [k, val] of Object.entries(e)) {
      const want = (ENTRY_FIELDS as Record<string, string>)[k];
      if (!want || typeof val !== want) return null;
    }
  }
  const m = v as Partial<Manifest>;
  return {
    format: m.format ?? "",
    schemaVersion: m.schemaVersion ?? "",
    minimumReaderVersion: m.minimumReaderVersion ?? "",
    applicationVersion: m.applicationVersion ?? "",
    projectId: m.projectId ?? "",
    revision: m.revision ?? 0,
    createdAt: m.createdAt ?? "",
    updatedAt: m.updatedAt ?? "",
    requiredFeatures: m.requiredFeatures ?? null,
    optionalFeatures: m.optionalFeatures ?? null,
    entries: (m.entries ?? []).map((e) => ({ path: e.path ?? "", mediaType: e.mediaType ?? "", size: e.size ?? 0, sha256: e.sha256 ?? "", required: e.required ?? false })),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function major(version: string): number {
  const i = version.indexOf(".");
  const n = Number(i >= 0 ? version.slice(0, i) : version);
  return Number.isInteger(n) ? n : Number.MAX_SAFE_INTEGER;
}
