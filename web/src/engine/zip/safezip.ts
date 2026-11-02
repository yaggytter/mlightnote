import { unzipSync, type UnzipFileInfo } from "fflate";

// Defensive ZIP reading shared by .mxl and .mlight (APP_DESIGN.md §16.3):
// entry count, total size and compression-ratio limits are checked from
// the central directory *before* anything is inflated, and unsafe or
// duplicate names reject the whole archive.

export class ZipError extends Error {}

export interface ZipLimits {
  maxEntries: number;
  maxUncompressed: number;
  maxRatio: number;
}

export interface ZipEntryInfo {
  name: string;
  size: number;
  originalSize: number;
  compression: number;
}

export function isZip(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

/** Lists entries without inflating any of them. */
export function listEntries(data: Uint8Array): ZipEntryInfo[] {
  const entries: ZipEntryInfo[] = [];
  try {
    unzipSync(data, {
      filter: (f: UnzipFileInfo) => {
        entries.push({ name: f.name, size: f.size, originalSize: f.originalSize, compression: f.compression });
        return false;
      },
    });
  } catch (e) {
    throw new ZipError(`zip: ${e instanceof Error ? e.message : String(e)}`);
  }
  return entries;
}

/** Rejects absolute paths, drive letters, backslashes, NULs and "..". */
export function safeZipPath(name: string): boolean {
  if (name === "" || name.startsWith("/") || /[\\\0]/.test(name) || (name.length >= 2 && name[1] === ":")) return false;
  const trimmed = name.endsWith("/") ? name.slice(0, -1) : name;
  if (trimmed.split("/").some((seg) => seg === "..")) return false;
  const clean = trimmed.split("/").filter((seg) => seg !== "." && seg !== "").join("/");
  return clean === trimmed || name.endsWith("/");
}

/**
 * The stricter rule for .mlight (APP_DESIGN.md §10.2): regular file paths
 * only, already canonical, no segment ending in a dot or a space.
 */
export function strictZipPath(name: string): boolean {
  if (!safeZipPath(name) || name.endsWith("/")) return false;
  return name.split("/").every((seg) => seg !== "" && seg !== "." && seg !== ".." && !seg.endsWith(".") && !seg.endsWith(" "));
}

/** Checks the whole archive against the limits; returns entries by lowercase name. */
export function checkArchive(data: Uint8Array, limits: ZipLimits, onError: (reason: string) => never): Map<string, ZipEntryInfo> {
  let entries: ZipEntryInfo[];
  try {
    entries = listEntries(data);
  } catch {
    onError("unreadable archive");
  }
  if (entries.length > limits.maxEntries) onError("too many entries");
  const byName = new Map<string, ZipEntryInfo>();
  let total = 0;
  for (const e of entries) {
    if (!safeZipPath(e.name)) onError(`unsafe entry ${JSON.stringify(e.name)}`);
    const key = e.name.toLowerCase();
    if (byName.has(key)) onError(`duplicate entry ${JSON.stringify(e.name)}`);
    byName.set(key, e);
    total += e.originalSize;
    if (total > limits.maxUncompressed) onError("exceeds size limit");
  }
  return byName;
}

/** Inflates one entry after checking its compression ratio. */
export function readEntry(data: Uint8Array, entry: ZipEntryInfo, limits: ZipLimits, onError: (reason: string) => never): Uint8Array {
  if (entry.size > 0 && Math.floor(entry.originalSize / entry.size) > limits.maxRatio) onError("suspicious compression ratio");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (f) => f.name === entry.name });
  } catch {
    onError("cannot inflate entry");
  }
  const out = files[entry.name];
  if (!out || out.length !== entry.originalSize) onError("entry size mismatch");
  return out;
}
