import { describe, expect, it } from "vitest";
import { terminalRoute } from "./terminalRoute";

describe("terminalRoute", () => {
  it("routes every pre-authentication phase to its own screen, independent of shift state", () => {
    expect(terminalRoute("bootstrapping", false, false)).toBe("STARTING");
    expect(terminalRoute("needs-url", false, false)).toBe("UNCONFIGURED");
    expect(terminalRoute("unpaired", false, false)).toBe("UNPROVISIONED");
    expect(terminalRoute("waiting", false, false)).toBe("PAIRING");
    expect(terminalRoute("locked", true, true)).toBe("LOCKED");
  });

  it("sends an authenticated terminal with no open shift to NO_SHIFT once the shift check has settled", () => {
    expect(terminalRoute("ready", true, false)).toBe("NO_SHIFT");
  });

  it("never flashes NO_SHIFT while the shift check is still in flight", () => {
    // shiftKnown=false models "usePosShift() hasn't resolved yet" — the
    // router must not guess an empty shift is a real NO_SHIFT state.
    expect(terminalRoute("ready", false, false)).toBe("OPERATIONAL");
  });

  it("sends an authenticated terminal with an open shift straight to the operational register", () => {
    expect(terminalRoute("ready", true, true)).toBe("OPERATIONAL");
  });

  it("sends a kitchen or bar display with no shift straight to its board (it takes no cash)", () => {
    expect(terminalRoute("ready", true, false, { shiftRequired: false })).toBe("OPERATIONAL");
    // A till still needs its shift.
    expect(terminalRoute("ready", true, false, { shiftRequired: true })).toBe("NO_SHIFT");
  });

  it("throws on an unrouted phase instead of silently falling through to a screen", () => {
    // @ts-expect-error deliberately invalid phase to exercise the exhaustiveness guard
    expect(() => terminalRoute("bogus", true, true)).toThrow(/unrouted terminal phase/);
  });
});
