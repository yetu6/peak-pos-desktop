import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { BRIDGE_PORT, LIVE_API_URL, TILL_PORT } from "./liveSettings";

/**
 * The PRODUCTION build of the till (vite build, served by vite preview), against
 * the same live API as the live suite: does realtime go Live outside a
 * development build too? (React's StrictMode double effect only runs in
 * development, so this is where the dev-only defect can't hide a production one.)
 * Same API and seed as tests/e2e-live/playwright.config.ts; see its header.
 * It serves on the live suite's port, the one origin the live API allows, so
 * the two never run at once.
 */
const output = join(import.meta.dirname, "output", "preview");

export default defineConfig({
  testDir: ".",
  testMatch: /\.preview\.spec\.ts$/,
  outputDir: join(output, "playwright"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${TILL_PORT}`,
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `bunx vite build --outDir tests/e2e-live/.work/dist --emptyOutDir && bunx vite preview --outDir tests/e2e-live/.work/dist --port ${TILL_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${TILL_PORT}/`,
      reuseExistingServer: false,
      timeout: 300_000,
      cwd: "../..",
      env: { VITE_PEAK_VISUAL_FIXTURE: "", VITE_PEAK_API_URL: "" },
    },
    {
      command: "node scripts/realtime-bridge.mjs",
      port: BRIDGE_PORT,
      reuseExistingServer: false,
      timeout: 30_000,
      cwd: "../..",
      env: {
        PEAK_REALTIME_URL: `${LIVE_API_URL.replace(/^http/, "ws")}/api/v1/pos/realtime/ws`,
        PEAK_BRIDGE_PORT: String(BRIDGE_PORT),
      },
    },
  ],
});
