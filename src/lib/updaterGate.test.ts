import { describe, expect, it } from "vitest";
import { DEFAULT_UPDATE_WINDOW, canApplyUpdater, inUpdateWindow, updateWindowFrom, updaterBlockedReason } from "./updaterGate";

const at = (hour: number, minute = 0) => new Date(2026, 9, 23, hour, minute);
const NIGHT = updateWindowFrom(DEFAULT_UPDATE_WINDOW);

describe("updaterGate", () => {
  it("installs only when nobody is signed in: locked or unpaired", () => {
    expect(canApplyUpdater("locked", at(1), false, NIGHT)).toBe(true);
    expect(canApplyUpdater("unpaired", at(1), false, NIGHT)).toBe(true);
    for (const phase of ["ready", "waiting", "bootstrapping", "needs-url"] as const) {
      expect(canApplyUpdater(phase, at(1), false, NIGHT)).toBe(false);
      expect(canApplyUpdater(phase, at(1), true, NIGHT)).toBe(false);
    }
  });

  it("restarts the till only inside the night window (owner, 23 Oct: from midnight)", () => {
    expect(DEFAULT_UPDATE_WINDOW).toBe("00:00-05:00");
    expect(canApplyUpdater("locked", at(23, 59), false, NIGHT)).toBe(false);
    expect(canApplyUpdater("locked", at(0, 0), false, NIGHT)).toBe(true);
    expect(canApplyUpdater("locked", at(4, 59), false, NIGHT)).toBe(true);
    expect(canApplyUpdater("locked", at(5, 0), false, NIGHT)).toBe(false);
    expect(canApplyUpdater("locked", at(14, 0), false, NIGHT)).toBe(false);
  });

  it("a till just started installs before anyone signs in, whatever the hour", () => {
    expect(canApplyUpdater("locked", at(9, 30), true, NIGHT)).toBe(true);
    expect(canApplyUpdater("ready", at(9, 30), true, NIGHT)).toBe(false);
  });

  it("reads the window as HH:MM-HH:MM, across midnight too, and falls back to the default", () => {
    const late = updateWindowFrom("03:00-06:30");
    expect(inUpdateWindow(at(2, 59), late)).toBe(false);
    expect(inUpdateWindow(at(6, 29), late)).toBe(true);
    expect(inUpdateWindow(at(6, 30), late)).toBe(false);
    const across = updateWindowFrom("23:00-02:00");
    expect(inUpdateWindow(at(23, 30), across)).toBe(true);
    expect(inUpdateWindow(at(1, 0), across)).toBe(true);
    expect(inUpdateWindow(at(2, 0), across)).toBe(false);
    expect(inUpdateWindow(at(12, 0), across)).toBe(false);
    for (const bad of [undefined, "", "midnight", "25:00-05:00", "00:00-00:00", "0:00-5:00x"]) {
      expect(updateWindowFrom(bad)).toEqual(NIGHT);
    }
  });

  it("says when a ready update will install, in words", () => {
    expect(updaterBlockedReason("ready", at(14), false, NIGHT)).toMatch(/switch staff/i);
    expect(updaterBlockedReason("locked", at(14), false, NIGHT)).toBe(
      "It installs between 00:00 and 05:00 while the till is locked, or when the till is next started.",
    );
    expect(updaterBlockedReason("locked", at(1), false, NIGHT)).toBeNull();
    expect(updaterBlockedReason("locked", at(14), true, NIGHT)).toBeNull();
  });
});
