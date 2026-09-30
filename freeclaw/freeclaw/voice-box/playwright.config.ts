import { defineConfig } from "@playwright/test";

// Voice Box binds :5173 with `strictPort` (see vite.config.ts). On a shared
// machine another project may already own that port, and Playwright's
// `reuseExistingServer` would then silently test *that* app. VB_PORT /
// VB_BASE_URL let this suite run against Voice Box on a free port instead, and
// the global setup below refuses to run at all if the port serves something
// other than Voice Box.
const PORT = Number(process.env.VB_PORT || 5173);
const BASE_URL = process.env.VB_BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
