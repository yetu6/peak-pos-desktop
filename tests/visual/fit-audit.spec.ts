import { test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { VISUAL_FIXTURE_NAMES } from "../../src/visual/fixtureNames";
import { FIT_SIZES, measureFit } from "./fit";
import { RESULTS_DIR } from "./harness";
import { join } from "node:path";

for (const size of FIT_SIZES.filter((s) => s.height < 768)) {
  test(`audit ${size.width}x${size.height}`, async ({ browser }) => {
    test.setTimeout(900_000);
    const out: Record<string, unknown> = {};
    for (const fixture of VISUAL_FIXTURE_NAMES) {
      const page = await browser.newPage({ viewport: size });
      await page.addInitScript(() => localStorage.setItem("yetu-till-theme", "light"));
      await page.goto(`/?fixture=${fixture}`);
      await page.waitForFunction(() => (document.getElementById("root")?.childElementCount ?? 0) > 0);
      await page.evaluate(async () => { await document.fonts.ready; await new Promise((r) => setTimeout(r, 150)); });
      const f = await measureFit(page);
      if (f.length) out[fixture] = f;
      await page.close();
    }
    writeFileSync(join(RESULTS_DIR, `fit-audit-${size.width}x${size.height}.json`), JSON.stringify(out, null, 1));
  });
}
