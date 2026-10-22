import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(path) && !/\.test\.|visual/.test(path) ? [path] : [];
  });
}

it("keeps cancellation jargon out of staff copy and labels escapes Back", () => {
  const failures: string[] = [];
  for (const path of files("src")) {
    const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const match of source.matchAll(/>\s*((?:Cancel|Close)|[A-Z][^<>{}\n]{0,200})\s*</g)) {
      const text = match[1].trim();
      if (/^(Cancel|Close)$/.test(text) || /\bvoid(?:ed|ing|s)?\b/i.test(text)) failures.push(`${path}: ${text}`);
    }
    if (path.endsWith("Words.ts")) {
      for (const match of source.matchAll(/"([^"\n]+)"/g)) {
        if (/\s/.test(match[1]) && /\bvoid(?:ed|ing|s)?\b/i.test(match[1])) failures.push(`${path}: ${match[1]}`);
      }
    }
  }
  expect(failures).toEqual([]);
});
