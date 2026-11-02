/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { thirdPartyLicenses } from "./thirdPartyLicenses.ts";

// The URL path the site is served under. "/" for the local nginx and the
// dev server; a site served under a path sets e.g.
// MLIGHTNOTE_BASE=/mlightnote/ (docs/DEPLOY.md).
function siteBase(): string {
  const base = process.env.MLIGHTNOTE_BASE ?? "/";
  if (!/^\/([A-Za-z0-9._-]+\/)*$/.test(base)) {
    throw new Error(`MLIGHTNOTE_BASE must be "/" or a path like "/mlightnote/" (got "${base}")`);
  }
  return base;
}

const licenses = thirdPartyLicenses();

export default defineConfig({
  base: siteBase(),
  plugins: [react(), licenses.main],
  worker: { plugins: () => [licenses.worker()] },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
});
