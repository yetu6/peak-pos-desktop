import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PHASES = [
  "bootstrapping",
  "needs-url",
  "unpaired",
  "waiting",
  "locked",
  "ready",
] as const;

describe("boot sequence docs", () => {
  it("names every DevicePhase the shell actually uses", () => {
    const root = process.cwd();
    const doc = readFileSync(join(root, "docs/boot-sequence.md"), "utf8");
    const src = readFileSync(join(root, "src/auth/DeviceSessionProvider.tsx"), "utf8");
    for (const phase of PHASES) {
      expect(src).toContain(`"${phase}"`);
      expect(doc).toContain(`\`${phase}\``);
    }
    expect(doc).toMatch(/UNKNOWN is not READY/);
    expect(doc).toMatch(/no in-app auto-update/i);
    expect(doc).toMatch(/does not/i);
  });
});
