import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { BRIDGE_PORT, LIVE_API_URL, TILL_PORT } from "./liveSettings";

/**
 * The redesigned till, end to end, against a live Yetu API (no fixtures, no
 * mocked fetch): Vite's dev server serves the real app with no
 * VITE_PEAK_VISUAL_FIXTURE, and the dev realtime bridge
 * (scripts/realtime-bridge.mjs, the path a till in a plain browser uses)
 * forwards the till's socket to the same API. Start that API first with
 * tests/e2e-live/live-api.sh (db, seed, api); see the spec's header.
 *
 * Separate from the pixel harness (tests/visual): its own port, one worker,
 * and everything it writes goes to tests/e2e-live/output (gitignored).
 */
const output = join(import.meta.dirname, "output");

export default defineConfig({
  testDir: ".",
  testMatch: /\.live\.spec\.ts$/,
  outputDir: join(output, "playwright"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: join(output, "results.json") }], ["html", { outputFolder: join(output, "report"), open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${TILL_PORT}`,
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: "on",
    screenshot: "on",
    video: "off",
  },
  webServer: [
    {
      // VITE_PEAK_API_URL stays unset: the person types the server address,
      // exactly as a till with no address built in asks for it.
      command: `bunx vite --port ${TILL_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${TILL_PORT}/`,
      reuseExistingServer: false,
      timeout: 180_000,
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
