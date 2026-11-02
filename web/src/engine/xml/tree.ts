import { SaxesParser } from "saxes";

// A minimal element tree built with saxes, plus readers that reproduce Go
// encoding/xml's unmarshalling rules the Go importer relied on:
//  - elements and attributes are matched by local name (prefix ignored);
//  - a repeated element feeding a single field: the last one wins;
//  - a string field takes the element's own text, untrimmed, not the
//    text of nested elements;
//  - an int/float field is parsed after trimming; empty means 0, and
//    anything else unparsable fails the whole document.
// External entities and DTDs are never resolved (APP_DESIGN.md §16.2).

export interface XElement {
  name: string;
  attrs: Record<string, string>;
  children: (XElement | string)[];
}

export class XMLError extends Error {}

const MAX_DEPTH = 256;

function localName(qname: string): string {
  const i = qname.indexOf(":");
  return i < 0 ? qname : qname.slice(i + 1);
}

/** Parses a whole document; returns its root element. */
export function parseXML(text: string): XElement {
  const parser = new SaxesParser({ xmlns: false });
  const stack: XElement[] = [];
  let root: XElement | null = null;
  parser.on("opentag", (tag) => {
    if (stack.length >= MAX_DEPTH) throw new XMLError("xml: document nested too deeply");
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(tag.attributes as Record<string, string>)) attrs[localName(k)] = v;
    const el: XElement = { name: localName(tag.name), attrs, children: [] };
    if (stack.length > 0) stack[stack.length - 1].children.push(el);
    else if (!root) root = el;
    stack.push(el);
  });
  const onText = (t: string) => {
    if (stack.length > 0) stack[stack.length - 1].children.push(t);
  };
  parser.on("text", onText);
  parser.on("cdata", onText);
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.on("error", (e) => {
    throw new XMLError(`xml: ${e.message}`);
  });
  parser.write(text).close();
  if (!root) throw new XMLError("xml: no root element");
  return root;
}

/** Decodes bytes as XML text (UTF-8, or UTF-16 with a BOM). */
export function decodeXMLBytes(data: Uint8Array): string {
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder("utf-16be").decode(data);
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data);
  return new TextDecoder("utf-8").decode(data);
}

export function elements(el: XElement | undefined, name: string): XElement[] {
  if (!el) return [];
  return el.children.filter((c): c is XElement => typeof c !== "string" && c.name === name);
}

/** The last child element with this name (Go's single-field rule). */
export function child(el: XElement | undefined, name: string): XElement | undefined {
  const all = elements(el, name);
  return all[all.length - 1];
}

/** Follows a path of child names ("rootfiles>rootfile" style). */
export function path(el: XElement | undefined, ...names: string[]): XElement[] {
  let level: XElement[] = el ? [el] : [];
  for (const n of names) level = level.flatMap((e) => elements(e, n));
  return level;
}

/** The element's own character data, concatenated and untrimmed. */
export function ownText(el: XElement | undefined): string {
  if (!el) return "";
  return el.children.filter((c): c is string => typeof c === "string").join("");
}

export function text(el: XElement | undefined, name: string): string {
  return ownText(child(el, name));
}

export function attr(el: XElement | undefined, name: string): string {
  return el?.attrs[name] ?? "";
}

export function parseIntGo(s: string, what: string): number {
  if (s.length === 0) return 0;
  const t = s.trim();
  if (!/^[+-]?\d+$/.test(t)) throw new XMLError(`xml: invalid integer ${JSON.stringify(s)} in ${what}`);
  return Number(t);
}

export function parseFloatGo(s: string, what: string): number {
  if (s.length === 0) return 0;
  const t = s.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) throw new XMLError(`xml: invalid number ${JSON.stringify(s)} in ${what}`);
  return Number(t);
}

export function intChild(el: XElement | undefined, name: string): number {
  return parseIntGo(text(el, name), name);
}

export function floatChild(el: XElement | undefined, name: string): number {
  return parseFloatGo(text(el, name), name);
}

export function intAttr(el: XElement | undefined, name: string): number {
  return parseIntGo(attr(el, name), `@${name}`);
}

export function floatAttr(el: XElement | undefined, name: string): number {
  return parseFloatGo(attr(el, name), `@${name}`);
}

/** The names of an element's child elements, in order (Go `xml:",any"`). */
export function childNames(el: XElement | undefined): string[] {
  if (!el) return [];
  return el.children.filter((c): c is XElement => typeof c !== "string").map((c) => c.name);
}
