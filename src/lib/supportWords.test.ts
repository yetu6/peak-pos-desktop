import { describe, expect, it } from "vitest";
import {
  computerWords,
  liveUpdatesWords,
  offlineReadyWords,
  savedSalesWords,
  tillKindWords,
  yetuAnswersWords,
} from "./supportWords";

// The owner, 2026-10-19: friendly, easily understood words in the whole till,
// not technical ones. The details for support read like the rest of the till.
describe("details for support, in staff words", () => {
  it("says whether the till's saved sales are up to date", () => {
    expect(savedSalesWords("Live")).toBe("Up to date");
    expect(savedSalesWords("Reconnecting")).toBe("Reconnecting");
    expect(savedSalesWords("Offline · 3 waiting")).toBe("Offline, 3 waiting to send");
    expect(savedSalesWords("Offline · Sales available")).toBe("Offline, can still sell");
    expect(savedSalesWords("Sync issue")).toBe("A manager needs to look");
  });

  it("says whether cash without internet and the offline menu are ready", () => {
    expect(offlineReadyWords("ACTIVE")).toBe("Ready");
    expect(offlineReadyWords("STAGED")).toBe("Getting ready");
    expect(offlineReadyWords("MISSING")).toBe("Not yet: sign in with a connection");
    expect(offlineReadyWords("EXPIRED")).toBe("Ran out: sign in with a connection");
    expect(offlineReadyWords("REVOKED")).toBe("Stopped by a manager");
    expect(offlineReadyWords("SUPERSEDED")).toBe("Replaced by a newer one");
  });

  it("says whether live updates are on, never the engineering behind them", () => {
    expect(liveUpdatesWords({ phase: "connected", attempt: 0 })).toBe("On");
    expect(liveUpdatesWords({ phase: "connecting", attempt: 0 })).toBe("Connecting");
    expect(liveUpdatesWords({ phase: "reconnecting", attempt: 3 })).toBe("Reconnecting (try 3)");
    expect(liveUpdatesWords({ phase: "disconnected", attempt: 0 })).toBe("Off");
    expect(liveUpdatesWords({ phase: "error", attempt: 0 })).toBe("Off for now");
  });

  it("names the computer and the kind of till as people say them", () => {
    expect(computerWords("linux", "x86_64")).toBe("Linux, 64-bit");
    expect(computerWords("windows", "x86_64")).toBe("Windows, 64-bit");
    expect(computerWords("macos", "aarch64")).toBe("Mac, 64-bit");
    expect(computerWords("", "")).toBe("Not known");
    expect(tillKindWords("POS")).toBe("Orders and payments");
    expect(tillKindWords("CASHIER")).toBe("Payments");
    expect(tillKindWords("KITCHEN_DISPLAY")).toBe("Kitchen screen");
    expect(tillKindWords("BAR_DISPLAY")).toBe("Bar screen");
    expect(tillKindWords("offline-cash")).toBe("Cash only, offline");
  });

  it("says whether Yetu answers, without a status code", () => {
    expect(yetuAnswersWords(null)).toBe("Checking");
    expect(yetuAnswersWords({ status: "reachable" })).toBe("Answers");
    expect(yetuAnswersWords({ status: "unreachable" })).toBe("Can't be reached");
  });
});
