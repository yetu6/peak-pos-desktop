import { chromium } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { HARNESS_PORT, RESULTS_DIR, SCREENS_DIR } from "./harness";

const BASE_URL = `http://127.0.0.1:${HARNESS_PORT}`;
/** Fixtures that between them pull in every module the others need. */
const WARM_UP = ["system", "terminal", "splash"];

async function serverReady(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE_URL}/`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The fixture server did not answer on ${BASE_URL}`);
}

/**
 * Each run starts with no findings or screenshots from an earlier run, and
 * with the dev server's modules already prepared: Vite prepares dependencies
 * on first use and reloads the page when it does, which must not happen in
 * the middle of a measured page.
 */
export default async function globalSetup(): Promise<void> {
  rmSync(RESULTS_DIR, { recursive: true, force: true });
  rmSync(SCREENS_DIR, { recursive: true, force: true });
  mkdirSync(RESULTS_DIR, { recursive: true });
  mkdirSync(SCREENS_DIR, { recursive: true });

  await serverReady(Date.now() + 180_000);
  const browser = await chromium.launch();
  try {
    // A fresh page each time: Chromium runs out of request slots after a few
    // development-mode loads (hundreds of separate modules) in one tab.
    for (const fixture of WARM_UP) {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(`${BASE_URL}/?fixture=${fixture}`, { timeout: 180_000 });
      await page
        .waitForFunction(() => (document.getElementById("root")?.childElementCount ?? 0) > 0, undefined, {
          timeout: 180_000,
        })
        .catch((error: unknown) => {
          throw new Error(`Warm-up of ${fixture} did not render: ${String(error)}; page errors: ${errors.join(" | ") || "none"}`);
        });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
