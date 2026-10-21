import { describe, expect, it } from "vitest";
import { CASH_DENOMINATIONS } from "../lib/money";
import {
  cashMovementProblem,
  closeShiftProblem,
  countOutcome,
  dayCloseProblem,
  differenceWords,
  noteCountMinor,
} from "./cashWords";

/** The hooks reject with the backend's problem as JSON in the message (usePosData `unwrap`). */
function problem(code: string, detail: string): Error {
  return new Error(JSON.stringify({ code, detail, status: 409, title: "x" }));
}

describe("closing a shift: the backend's refusals in words", () => {
  // fbc-peak internal/pos/controls.go CloseShift: a code for each since S5b, except a refused approval (CONFLICT).
  it("names each refusal and what to do", () => {
    expect(closeShiftProblem(problem("SHIFT_HAS_OPEN_ORDERS", "shift has open orders"))).toEqual({
      kind: "open-orders",
      words: "Some orders on this shift are still open. Hand them over to the next shift, or take payment for them first.",
    });
    expect(closeShiftProblem(problem("SHIFT_OFFLINE_CASH_UNRESOLVED", "shift has unresolved offline cash"))?.kind).toBe("offline-cash");
    expect(closeShiftProblem(problem("CONFLICT", "supervisor approval failed"))).toEqual({
      kind: "supervisor",
      words: "The drawer doesn't match what Yetu expects, so a manager must approve. Their PIN wasn't accepted, or they can't approve this.",
    });
    expect(closeShiftProblem(problem("SHIFT_NOT_OPEN", "shift is not open"))?.kind).toBe("not-open");
  });

  it("never shows the backend's own words or a code", () => {
    const words = closeShiftProblem(problem("CONFLICT", "something new: pq error 23505"))?.words ?? "";
    expect(words).toBe("The shift couldn't be closed. Try again.");
    expect(closeShiftProblem(new TypeError("Failed to fetch"))?.words).toBe(
      "Can't reach Yetu. Check the internet connection, then try again.",
    );
    expect(closeShiftProblem(null)).toBeNull();
  });
});

describe("refusals that aren't about cash keep the till's own words", () => {
  // usePosData / posErrors describePosError: a session, a till or a feature, not this action.
  const cases: Array<[string, string]> = [
    ["SESSION_EXPIRED", "You were signed out. Enter your PIN to carry on."],
    ["CAPABILITY_NOT_ENABLED", "This isn't switched on for your business. Ask a manager to switch it on in Yetu."],
    ["DEVICE_REVOKED", "This till was disconnected from your restaurant. Ask a manager to connect it again."],
  ];

  it.each(cases)("%s on closing a shift, cash in or out, and closing the day", (code, words) => {
    const refusal = problem(code, "detail from the backend");
    expect(closeShiftProblem(refusal)?.words).toBe(words);
    expect(cashMovementProblem(refusal, "CASH_OUT")?.words).toBe(words);
    expect(dayCloseProblem(refusal)?.words).toBe(words);
  });
});

describe("closing the day: what blocks it, in words", () => {
  // fbc-peak internal/pos/business_day.go, returned as INVALID_STATE.
  it("counts the shifts still open", () => {
    expect(
      dayCloseProblem(problem("INVALID_STATE", "a shift for this business date is still open: 2 shift(s) for 2026-10-12")),
    ).toEqual({ kind: "shifts-open", words: "2 shifts are still open today. Close every till's shift, then close the day." });
    expect(
      dayCloseProblem(problem("INVALID_STATE", "a shift for this business date is still open: 1 shift(s) for 2026-10-12"))?.words,
    ).toBe("1 shift is still open today. Close every till's shift, then close the day.");
  });

  it("counts the tabs still open: the day closes once they are settled (S17b)", () => {
    // fbc-peak business_day.go: "<n> open tab(s) for <day>", after the shifts are closed.
    expect(
      dayCloseProblem(problem("INVALID_STATE", "a shift for this business date is still open: 2 open tab(s) for 2026-10-19")),
    ).toEqual({
      kind: "tabs-open",
      words: "2 tabs are still open today. Take payment for them, charge them to a room or cancel them, then close the day.",
    });
  });

  it("names unsent offline cash and night audit", () => {
    expect(
      dayCloseProblem(problem("INVALID_STATE", "a shift for this business date is still open: 3 unresolved offline cash operation(s)")),
    ).toEqual({
      kind: "offline-cash",
      words: "3 cash sales made without internet haven't been settled. Reconnect those tills or sort them out in Yetu, then close the day.",
    });
    expect(
      dayCloseProblem(problem("INVALID_STATE", "This property's business date is controlled by Lodging Night Audit, not POS Day Close."))?.kind,
    ).toBe("night-audit");
    expect(dayCloseProblem(problem("FORBIDDEN", "x"))?.kind).toBe("permission");
  });

  it("never shows an ISO date or the backend's sentence", () => {
    const words = dayCloseProblem(problem("INVALID_STATE", "a shift for this business date is still open: 2 shift(s) for 2026-10-12"))?.words;
    expect(words).not.toMatch(/\d{4}-\d{2}-\d{2}|shift\(s\)/);
  });
});

describe("cash in and out: the backend's refusals in words", () => {
  it("says a cash-out needs a different supervisor", () => {
    expect(
      cashMovementProblem(problem("FORBIDDEN", "Taking cash out of the drawer needs a supervisor's approval: their name and PIN."), "CASH_OUT"),
    ).toEqual({
      kind: "supervisor",
      words: "A different supervisor must approve taking cash out. Their PIN wasn't accepted, or they can't approve this.",
    });
    expect(cashMovementProblem(problem("SHIFT_NOT_OPEN", "no open shift on this terminal"), "CASH_IN")?.kind).toBe("no-shift");
  });
});

describe("count and difference", () => {
  it("compares the count with Yetu's expected figure, without working out money", () => {
    expect(countOutcome(7_400_000, 7_400_000)).toBe("balanced");
    expect(countOutcome(7_450_000, 7_400_000)).toBe("over");
    expect(countOutcome(7_350_000, 7_400_000)).toBe("short");
  });

  it("words the difference Yetu worked out", () => {
    expect(differenceWords(0, "TZS")).toBe("Balanced");
    expect(differenceWords(50_000, "TZS")).toBe("Over by TSh 500");
    expect(differenceWords(-50_000, "TZS")).toBe("Short by TSh 500");
  });
});

describe("note-by-note counting", () => {
  it("keeps the notes and coins in a named setting", () => {
    expect(CASH_DENOMINATIONS.TZS).toEqual([10_000, 5_000, 2_000, 1_000, 500, 200, 100, 50]);
  });

  it("adds a count in whole minor units", () => {
    expect(noteCountMinor({ 10000: 7, 5000: 0, 2000: 2, 500: 1 })).toBe(7_450_000);
    expect(noteCountMinor({})).toBe(0);
  });
});
