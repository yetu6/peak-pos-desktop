import { describe, expect, it } from "vitest";
import { canApplyUpdater, updaterBlockedReason } from "./updaterGate";

describe("updaterGate", () => {
  it("allows apply only when locked or unpaired", () => {
    expect(canApplyUpdater("locked")).toBe(true);
    expect(canApplyUpdater("unpaired")).toBe(true);
    expect(canApplyUpdater("ready")).toBe(false);
    expect(canApplyUpdater("waiting")).toBe(false);
    expect(canApplyUpdater("bootstrapping")).toBe(false);
    expect(canApplyUpdater("needs-url")).toBe(false);
  });

  it("explains why ready blocks apply", () => {
    expect(updaterBlockedReason("ready")).toMatch(/switch staff/i);
    expect(updaterBlockedReason("locked")).toBeNull();
  });
});
