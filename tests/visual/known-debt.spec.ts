import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWN_DEBT, RESULTS_DIR, type FixtureResult } from "./harness";

/**
 * Runs after every fixture has been measured. A known finding that no longer
 * occurs at any size or theme has been fixed: it must come off the list, so
 * the list never hides a regression behind a stale entry.
 */
test("known debt still exists, so the list only shrinks", () => {
  const results = readdirSync(RESULTS_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(RESULTS_DIR, file), "utf8")) as FixtureResult);
  expect(results.length).toBeGreaterThan(0);

  const stale: string[] = [];
  for (const [fixture, debt] of Object.entries(KNOWN_DEBT)) {
    const seen = new Set(
      results.filter((result) => result.fixture === fixture).flatMap((result) => result.findings.map((finding) => finding.key)),
    );
    for (const key of debt?.keys ?? []) {
      if (!seen.has(key)) stale.push(`${fixture}: ${key} (owner ${debt?.owner}) no longer occurs; remove it`);
    }
  }
  expect(stale).toEqual([]);
});
