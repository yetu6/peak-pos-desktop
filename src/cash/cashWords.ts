/**
 * Plain words for shift and cash: the backend's refusals (read from the
 * problem the hooks reject with), the outcome of a count, and note-by-note
 * totals. Money shown here always comes from the backend, except the person's
 * own count, which is input.
 */
import { formatMoney, MINOR_PER_MAJOR } from "../lib/money";
import type { CashMovementType } from "../lib/posContracts";
import { otherWords, problemOf, UNREACHABLE } from "../lib/problemWords";
import { noApproverWords } from "../register/registerWords";

export interface CashProblem<K extends string> {
  kind: K | "network" | "permission" | "other";
  words: string;
}

/**
 * Closing a shift (fbc-peak internal/pos/controls.go CloseShift), by code.
 * One refusal still has no code of its own: a drawer that doesn't match whose
 * approval wasn't accepted is a 409 CONFLICT "supervisor approval failed"
 * (http.go CloseShift keeps it as it was), so that one is read by its words.
 */
export function closeShiftProblem(
  error: unknown,
): CashProblem<"open-orders" | "offline-cash" | "supervisor" | "no-approver" | "not-open"> | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  switch (problem.code) {
    case "SHIFT_HAS_OPEN_ORDERS":
      return {
        kind: "open-orders",
        words: "Some orders on this till are still open. Take payment for them or void them, then close the shift.",
      };
    case "SHIFT_OFFLINE_CASH_UNRESOLVED":
      return {
        kind: "offline-cash",
        words: "Cash taken without internet hasn't been settled yet. Reconnect so it can be sent, or ask a manager to sort it out in Yetu.",
      };
    case "SHIFT_NOT_OPEN":
      return { kind: "not-open", words: "This shift is already closed." };
    case "NO_APPROVER_SET":
      return { kind: "no-approver", words: noApproverWords("a count that doesn't match") };
    case "FORBIDDEN":
      return { kind: "permission", words: "Only a cashier or manager can close the shift. Ask one to close it." };
  }
  if (problem.code === "CONFLICT" && problem.detail === "supervisor approval failed") {
    return {
      kind: "supervisor",
      words: "The drawer doesn't match what Yetu expects, so a manager must approve. Their PIN wasn't accepted, or they can't approve this.",
    };
  }
  return { kind: "other", words: otherWords(problem, "The shift couldn't be closed. Try again.") };
}

/**
 * Closing the business day. fbc-peak internal/pos/business_day.go refuses
 * with INVALID_STATE: shifts still open, offline cash not settled, or a hotel
 * whose night audit closes the day.
 */
export function dayCloseProblem(
  error: unknown,
): CashProblem<"shifts-open" | "offline-cash" | "night-audit"> | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  const detail = problem.detail ?? "";
  const shifts = /(\d+) shift\(s\)/.exec(detail);
  if (shifts) {
    const n = Number(shifts[1]);
    return {
      kind: "shifts-open",
      words: `${n} ${n === 1 ? "shift is" : "shifts are"} still open today. Close every till's shift, then close the day.`,
    };
  }
  const offline = /(\d+) unresolved offline cash/.exec(detail);
  if (offline) {
    const n = Number(offline[1]);
    return {
      kind: "offline-cash",
      words: `${n} cash ${n === 1 ? "sale" : "sales"} made without internet haven't been settled. Reconnect those tills or sort them out in Yetu, then close the day.`,
    };
  }
  if (/Night Audit/i.test(detail)) {
    return { kind: "night-audit", words: "This hotel closes the day with the night audit in Yetu, not on the till." };
  }
  if (problem.code === "FORBIDDEN") return { kind: "permission", words: "Only a manager can close the day. Ask one to close it." };
  return { kind: "other", words: otherWords(problem, "The day couldn't be closed. Try again.") };
}

/**
 * Cash in and out (fbc-peak internal/pos/cash.go), by code. Every refusal of
 * the approval is FORBIDDEN, as is a role that may not move cash: taking cash
 * out always asks a supervisor, so there it is the supervisor's approval.
 */
export function cashMovementProblem(
  error: unknown,
  movementType: CashMovementType,
): CashProblem<"supervisor" | "no-approver" | "no-shift"> | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  switch (problem.code) {
    case "SHIFT_NOT_OPEN":
      return { kind: "no-shift", words: "No shift is open on this till." };
    case "NO_APPROVER_SET":
      return { kind: "no-approver", words: noApproverWords("taking cash out") };
    case "FORBIDDEN":
      return movementType === "CASH_OUT"
        ? {
            kind: "supervisor",
            words: "A different supervisor must approve taking cash out. Their PIN wasn't accepted, or they can't approve this.",
          }
        : { kind: "permission", words: "Only a cashier or manager can put cash in or take it out. Ask one to help." };
  }
  return { kind: "other", words: otherWords(problem, "That wasn't recorded. Try again.") };
}

/** The count against Yetu's expected figure: a comparison, not a sum. */
export function countOutcome(countedMinor: number, expectedMinor: number): "balanced" | "over" | "short" {
  if (countedMinor === expectedMinor) return "balanced";
  return countedMinor > expectedMinor ? "over" : "short";
}

/** The difference Yetu worked out on closing (varianceMinor), in words. */
export function differenceWords(varianceMinor: number, currency: string): string {
  if (varianceMinor === 0) return "Balanced";
  const amount = formatMoney(Math.abs(varianceMinor), currency);
  return varianceMinor > 0 ? `Over by ${amount}` : `Short by ${amount}`;
}

/** A note-by-note count (denomination in major units → how many) as a whole number of minor units. */
export function noteCountMinor(counts: Readonly<Record<number, number>>): number {
  return Object.entries(counts).reduce(
    (total, [denomination, count]) => total + Number(denomination) * MINOR_PER_MAJOR * Math.max(0, Math.floor(count)),
    0,
  );
}

/** Opening the shift (pos.shift.open): who may, the connection, or the refusal in words. */
export function openShiftProblem(error: unknown): CashProblem<never> | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  if (problem.code === "FORBIDDEN") return { kind: "permission", words: "Only a cashier or manager can open the shift. Ask one to open it." };
  return { kind: "other", words: otherWords(problem, "The shift wasn't opened. Try again.") };
}
