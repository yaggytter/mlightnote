import { defineConfig } from "@playwright/test";

// Runs e2e-docker/ against the Docker Compose stack started by `make deploy`
// (web published on 127.0.0.1:${MLIGHTNOTE_PORT:-8080}); it starts no servers.
// MLIGHTNOTE_SMOKE_URL points it at another deployment instead, e.g. the
// public site (docs/DEPLOY.md).
const port = process.env.MLIGHTNOTE_PORT ?? "8080";
const baseURL = process.env.MLIGHTNOTE_SMOKE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e-docker",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    viewport: { width: 1400, height: 1000 },
  },
});
