import { describe, expect, it } from "vitest";
import { createBackoff } from "./backoff";

describe("createBackoff", () => {
  it("stays within [0, cap] for any random draw", () => {
    const backoff = createBackoff({ baseMs: 100, maxMs: 1_000 });
    for (let attempt = 1; attempt <= 10; attempt++) {
      const delay = backoff.delayMs(attempt);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(1_000);
    }
  });

  it("grows the window with the attempt (exponential cap)", () => {
    const backoff = createBackoff({ baseMs: 100, maxMs: 8_000, random: () => 1 });
    const first = backoff.delayMs(1);
    const fourth = backoff.delayMs(4);
    expect(first).toBe(200); // 100 * 2^1
    expect(fourth).toBe(1_600); // 100 * 2^4
  });

  it("caps the window at maxMs", () => {
    const backoff = createBackoff({ baseMs: 100, maxMs: 1_000, random: () => 1 });
    expect(backoff.delayMs(20)).toBe(1_000);
  });

  it("returns 0 on the first attempt when jitter draws 0", () => {
    const backoff = createBackoff({ baseMs: 100, maxMs: 1_000, random: () => 0 });
    expect(backoff.delayMs(1)).toBe(0);
  });
});