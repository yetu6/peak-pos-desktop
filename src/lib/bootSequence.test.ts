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

describe("boot sequence", () => {
  it("names every DevicePhase the shell actually uses", () => {
    const root = process.cwd();
    const src = readFileSync(join(root, "src/auth/DeviceSessionProvider.tsx"), "utf8");
    for (const phase of PHASES) {
      expect(src).toContain(`"${phase}"`);
    }
    expect(src).toMatch(/shellStateOf/);
  });
});
