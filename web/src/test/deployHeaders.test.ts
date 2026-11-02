import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The local nginx and the public host (Cloudflare Pages `_headers`) must
// send the same security headers, or the smoke test of one says nothing
// about the other (APP_DESIGN.md §16.1).
const ROOT = path.resolve(__dirname, "../../..");
const HEADERS_FILE = path.join(ROOT, "web/public/_headers");

function nginxHeaders(): Record<string, string> {
  const conf = readFileSync(path.join(ROOT, "deploy/nginx.conf"), "utf8");
  return Object.fromEntries([...conf.matchAll(/add_header\s+(\S+)\s+"([^"]*)"\s+always;/g)].map((m) => [m[1].toLowerCase(), m[2]]));
}

/** The headers of the `/*` block in a Cloudflare Pages `_headers` file. */
function pagesHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  let inAll = false;
  for (const line of readFileSync(HEADERS_FILE, "utf8").split("\n")) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      inAll = line.trim() === "/*";
      continue;
    }
    const i = line.indexOf(":");
    if (inAll && i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

describe("deployment headers", () => {
  it("nginx sets a strict CSP, nosniff and no-referrer", () => {
    expect(nginxHeaders()).toMatchObject({
      "content-security-policy": expect.stringContaining("default-src 'self'"),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
  });

  it("the public host sends the same security headers for every path", () => {
    expect(existsSync(HEADERS_FILE)).toBe(true);
    expect(pagesHeaders()).toMatchObject(nginxHeaders());
  });
});
