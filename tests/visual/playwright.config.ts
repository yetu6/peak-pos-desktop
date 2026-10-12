import { defineConfig } from "@playwright/test";
import { HARNESS_PORT, OUTPUT_DIR } from "./harness";

/**
 * Pixel harness: serves the development visual fixtures (Vite dev server, so
 * `?fixture=` is reachable) and checks every fixture at every supported size
 * in both themes. Screenshots and findings go to visual-output/ (gitignored).
 * No golden images yet: the screens change in S2-S6.
 */
export default defineConfig({
  testDir: ".",
  outputDir: `${OUTPUT_DIR}/playwright`,
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: Number(process.env.VISUAL_WORKERS ?? 4),
  timeout: 120_000,
  reporter: [["list"], ["html", { outputFolder: `${OUTPUT_DIR}/report`, open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${HARNESS_PORT}`,
    browserName: "chromium",
    headless: true,
    deviceScaleFactor: 1,
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    { name: "fixtures", testMatch: /fixtures\.spec\.ts$/ },
    { name: "known-debt", testMatch: /known-debt\.spec\.ts$/, dependencies: ["fixtures"] },
  ],
  webServer: {
    command: `bunx vite --port ${HARNESS_PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${HARNESS_PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    cwd: "../..",
  },
});
