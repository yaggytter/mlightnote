import { checkArchive, isZip, listEntries, readEntry, type ZipLimits } from "../../zip/safezip";
import { attr, decodeXMLBytes, parseXML, path } from "../../xml/tree";

export class MXLError extends Error {}

const LIMITS: ZipLimits = { maxEntries: 1000, maxUncompressed: 200 << 20, maxRatio: 200 };

/** A compressed MusicXML file: a ZIP with META-INF/container.xml. */
export function looksLikeMXL(data: Uint8Array): boolean {
  if (!isZip(data)) return false;
  try {
    return listEntries(data).some((e) => e.name === "META-INF/container.xml");
  } catch {
    return false;
  }
}

/** Returns the score that container.xml's first rootfile names. */
export function extractMXL(data: Uint8Array): Uint8Array {
  const fail = (reason: string): never => {
    throw new MXLError(`musicxml: invalid .mxl container: ${reason}`);
  };
  const byName = checkArchive(data, LIMITS, fail);
  const container = byName.get("meta-inf/container.xml");
  if (!container) fail("missing META-INF/container.xml");
  let fullPath = "";
  try {
    const rootfiles = path(parseXML(decodeXMLBytes(readEntry(data, container!, LIMITS, fail))), "rootfiles", "rootfile");
    fullPath = attr(rootfiles[0], "full-path");
    if (rootfiles.length === 0) fail("no rootfile");
  } catch (e) {
    if (e instanceof MXLError) throw e;
    fail("no rootfile");
  }
  const root = byName.get(fullPath.toLowerCase());
  if (!root) fail(`rootfile ${JSON.stringify(fullPath)} not found`);
  return readEntry(data, root!, LIMITS, fail);
}
