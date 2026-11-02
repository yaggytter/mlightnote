import { defineConfig } from "@playwright/test";

// E2E with the engine in the browser (the default): no API server,
// every project lives in the test page's IndexedDB. Each test gets a fresh
// browser context, so tests never see each other's projects.
const HOST = "[::1]";
const WEB = `http://${HOST}:5173`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: WEB,
    viewport: { width: 1400, height: 1000 },
    acceptDownloads: true,
  },
  webServer: {
    // The local binary, not npx: npx may make a registry round-trip first.
    command: `node_modules/.bin/vite --config web/vite.config.ts web --host ::1 --port 5173 --strictPort`,
    url: WEB,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
