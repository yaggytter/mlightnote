import type { CanonicalScore, ImportReport } from "../domain/types";
import { parseMIDI } from "../importers/midi/smf";
import { transcribe } from "../importers/midi/transcribe";
import { extractMXL, looksLikeMXL } from "../importers/musicxml/mxl";
import { parseMusicXML } from "../importers/musicxml/parser";
import { looksLikeMlight, MLIGHT_MIME_TYPE } from "../mlight/archive";
import { decodeXMLBytes } from "../xml/tree";
import { ServiceError } from "./errors";

// Format detection and parsing for a new import (port of the Go
// handleImport). Nothing is stored here; the caller persists the result
// only if this succeeds.

export const MEDIA_MUSICXML = "application/vnd.recordare.musicxml+xml";
export const MEDIA_MXL = "application/vnd.recordare.musicxml";
export const MEDIA_MIDI = "audio/midi";

/** The Go server's default upload limit (MLIGHTNOTE_MAX_UPLOAD_BYTES). */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const SNIFF_BYTES = 4096;

export function detectMediaType(data: Uint8Array): string {
  if (data.length >= 4 && String.fromCharCode(...data.subarray(0, 4)) === "MThd") return MEDIA_MIDI;
  if (looksLikeMlight(data)) return MLIGHT_MIME_TYPE;
  if (looksLikeMXL(data)) return MEDIA_MXL;
  const head = new TextDecoder("latin1").decode(data.subarray(0, SNIFF_BYTES));
  return head.includes("<score-partwise") ? MEDIA_MUSICXML : "";
}

export const unsupportedFormat = () =>
  new ServiceError(
    422,
    "IMPORT_UNSUPPORTED_FORMAT",
    "対応していないファイル形式です。MusicXML（.xml／.musicxml／.mxl、score-partwise）、MIDI（SMF Format 0/1、PPQ）、.mlight のみ受け付けます。",
  );

export const tooLarge = () => new ServiceError(400, "IMPORT_INVALID_UPLOAD", "アップロードを読み取れませんでした。ファイルサイズの上限を確認してください。");

export interface Parsed {
  score: CanonicalScore;
  report: ImportReport;
}

export function parseScore(mediaType: string, data: Uint8Array): Parsed {
  if (mediaType === MEDIA_MIDI) return parseMidi(data);
  let xml = data;
  if (mediaType === MEDIA_MXL) {
    try {
      xml = extractMXL(data);
    } catch {
      throw new ServiceError(422, "IMPORT_INVALID_MXL", "圧縮MusicXML（.mxl）を展開できませんでした。ファイルが壊れているか、安全でない内容を含んでいます。");
    }
  }
  try {
    return parseMusicXML(decodeXMLBytes(xml));
  } catch {
    throw new ServiceError(422, "IMPORT_PARSE_FAILED", "MusicXMLを解析できませんでした。ファイルが壊れているか、対応していない構造の可能性があります。");
  }
}

// Failures map by stage, as in Go: a file that parses but can't be
// transcribed (e.g. too long) gets the transcription message.
function parseMidi(data: Uint8Array): Parsed {
  let file;
  try {
    file = parseMIDI(data);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "SMPTE_DIVISION") {
      throw new ServiceError(422, "IMPORT_UNSUPPORTED_MIDI_DIVISION", "SMPTEタイムコード形式のMIDIには対応していません。PPQ形式のファイルのみ受け付けます。");
    }
    if (code === "UNSUPPORTED_FORMAT") {
      throw new ServiceError(422, "IMPORT_UNSUPPORTED_MIDI_FORMAT", "SMF Format 2には対応していません。Format 0または1のファイルのみ受け付けます。");
    }
    throw new ServiceError(422, "IMPORT_PARSE_FAILED", "MIDIファイルを解析できませんでした。ファイルが壊れている可能性があります。");
  }
  try {
    return transcribe(file);
  } catch {
    throw new ServiceError(422, "IMPORT_PARSE_FAILED", "MIDIから譜面を採譜できませんでした。");
  }
}

/** The file name without its extension (Go strings.TrimSuffix + filepath.Ext). */
export function baseTitle(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(0, dot) : base;
}
