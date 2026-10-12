import { describe, expect, it } from "vitest";
import {
  KITCHEN_LATE_AFTER_MINUTES,
  KITCHEN_NEW_MARKER_SECONDS,
  KITCHEN_WARN_AFTER_MINUTES,
} from "./kitchenSettings";
import { isNewTicket, kitchenProblem, nextStepFor, stationWords, stepDoneWords, ticketAge } from "./kitchenWords";

const MINUTE = 60_000;
const NOW = Date.now();
const sentMinutesAgo = (minutes: number) => new Date(NOW - minutes * MINUTE).toISOString();

describe("kitchen settings", () => {
  it("warn at 10 minutes and late at 15 by default (kitchen.warnAfterMinutes / kitchen.lateAfterMinutes)", () => {
    expect(KITCHEN_WARN_AFTER_MINUTES).toBe(10);
    expect(KITCHEN_LATE_AFTER_MINUTES).toBe(15);
    expect(KITCHEN_NEW_MARKER_SECONDS).toBe(30);
  });
});

describe("ticketAge", () => {
  it("says the age in words and minutes from the time it was sent", () => {
    expect(ticketAge(sentMinutesAgo(4), NOW)).toEqual({ words: "On time · 4 min", tone: "neutral", minutes: 4 });
    expect(ticketAge(sentMinutesAgo(12), NOW)).toEqual({ words: "Getting late · 12 min", tone: "warning", minutes: 12 });
    expect(ticketAge(sentMinutesAgo(18), NOW)).toEqual({ words: "Late · 18 min", tone: "danger", minutes: 18 });
  });

  it("turns at the named thresholds, not before", () => {
    const warn = KITCHEN_WARN_AFTER_MINUTES;
    const late = KITCHEN_LATE_AFTER_MINUTES;
    expect(ticketAge(new Date(NOW - warn * MINUTE + 1).toISOString(), NOW).tone).toBe("neutral");
    expect(ticketAge(sentMinutesAgo(warn), NOW).tone).toBe("warning");
    expect(ticketAge(new Date(NOW - late * MINUTE + 1).toISOString(), NOW).tone).toBe("warning");
    expect(ticketAge(sentMinutesAgo(late), NOW).tone).toBe("danger");
  });

  it("follows other thresholds when a business sets them", () => {
    expect(ticketAge(sentMinutesAgo(6), NOW, { warnAfterMinutes: 5, lateAfterMinutes: 8 }).words).toBe("Getting late · 6 min");
    expect(ticketAge(sentMinutesAgo(8), NOW, { warnAfterMinutes: 5, lateAfterMinutes: 8 }).words).toBe("Late · 8 min");
  });

  it("counts whole minutes and never below none (a till clock behind Yetu's)", () => {
    expect(ticketAge(new Date(NOW - 59_000).toISOString(), NOW).words).toBe("On time · 0 min");
    expect(ticketAge(new Date(NOW + 2 * MINUTE).toISOString(), NOW).words).toBe("On time · 0 min");
  });

  it("says so when Yetu gave no time it was sent, rather than guess", () => {
    expect(ticketAge(undefined, NOW)).toEqual({ words: "Sent time not known", tone: "neutral", minutes: null });
    expect(ticketAge("not a time", NOW)).toEqual({ words: "Sent time not known", tone: "neutral", minutes: null });
  });
});

describe("isNewTicket", () => {
  it("marks a ticket nobody has started for its first 30 seconds", () => {
    expect(isNewTicket("SENT", new Date(NOW - 5_000).toISOString(), NOW)).toBe(true);
    expect(isNewTicket("SENT", new Date(NOW - (KITCHEN_NEW_MARKER_SECONDS * 1000 - 1)).toISOString(), NOW)).toBe(true);
    expect(isNewTicket("SENT", new Date(NOW - KITCHEN_NEW_MARKER_SECONDS * 1000).toISOString(), NOW)).toBe(false);
  });

  it("drops the marker once someone starts it, and never marks a ticket with no sent time", () => {
    expect(isNewTicket("PREPARING", new Date(NOW - 5_000).toISOString(), NOW)).toBe(false);
    expect(isNewTicket("SENT", undefined, NOW)).toBe(false);
  });
});

describe("nextStepFor", () => {
  it("follows Yetu's steps, one at a time: New, Preparing, Ready, Served", () => {
    expect(nextStepFor("SENT")).toEqual({ target: "PREPARING", words: "Start", pendingWords: "Starting…" });
    expect(nextStepFor("PREPARING")).toEqual({ target: "READY", words: "Ready", pendingWords: "Marking ready…" });
    expect(nextStepFor("READY")).toEqual({ target: "SERVED", words: "Served", pendingWords: "Marking served…" });
    expect(nextStepFor("SERVED")).toBeNull();
  });
});

describe("stepDoneWords", () => {
  it("says what just happened to which order", () => {
    expect(stepDoneWords("PREPARING", "0142")).toBe("Order 0142 started.");
    expect(stepDoneWords("READY", "0142")).toBe("Order 0142 is ready.");
    expect(stepDoneWords("SERVED", "0142", "GRILL")).toBe("Order 0142 (Grill) is served.");
  });
});

describe("stationWords", () => {
  it("names each station the backend has, and never shows a code", () => {
    expect(stationWords("GENERAL")).toBe("Kitchen");
    expect(stationWords("HOT")).toBe("Hot kitchen");
    expect(stationWords("COLD")).toBe("Cold kitchen");
    expect(stationWords("BAR")).toBe("Bar");
    expect(stationWords("GRILL")).toBe("Grill");
    expect(stationWords("PASTRY")).toBe("Pastry");
    expect(stationWords("SUSHI")).toBe("Other station");
  });
});

describe("kitchenProblem", () => {
  const refused = (problem: Record<string, unknown>) => new Error(JSON.stringify(problem));
  const MOVED = "This ticket was moved on another screen. The board shows where it is now.";

  it("takes any refusal that isn't about the connection, the person or the till to mean the ticket may have moved", () => {
    // A stale version, a wrong step (Yetu answers that with a 500 today), or anything it doesn't name.
    for (const code of ["STALE_VERSION", "INTERNAL_ERROR", "CONFLICT", "INVALID_STATE", "NOT_FOUND", "SOMETHING_NEW"]) {
      expect(kitchenProblem(refused({ code, detail: "order is not in the required prior state" })), code).toEqual({ kind: "moved", words: MOVED });
    }
    expect(kitchenProblem(refused({}))).toEqual({ kind: "moved", words: MOVED });
  });

  it("says who can move tickets when the role or this screen's stations don't allow it", () => {
    expect(kitchenProblem(refused({ code: "FORBIDDEN" }))).toEqual({
      kind: "permission",
      words: "This ticket can't be moved from here. Your role or this screen's kitchen stations don't allow it. Ask a manager.",
    });
  });

  it("says the connection is down, or Yetu is busy, as something to try again", () => {
    expect(kitchenProblem(new TypeError("Failed to fetch"))?.kind).toBe("network");
    expect(kitchenProblem(refused({ code: "SERVICE_UNAVAILABLE" }))?.kind).toBe("network");
  });

  it("keeps the till's own words for a session or till that can't act", () => {
    expect(kitchenProblem(refused({ code: "SESSION_EXPIRED" }))).toEqual({ kind: "session", words: "Your session expired — enter your PIN again." });
    expect(kitchenProblem(refused({ code: "DEVICE_REVOKED" }))?.kind).toBe("session");
    expect(kitchenProblem(null)).toBeNull();
  });
});
