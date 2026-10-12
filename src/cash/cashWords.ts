/**
 * Plain words for shift and cash: the backend's refusals (read from the
 * problem the hooks reject with), the outcome of a count, and note-by-note
 * totals. Money shown here always comes from the backend, except the person's
 * own count, which is input.
 */
import { formatMoney, MINOR_PER_MAJOR } from "../lib/money";
import { describePosError, type PosErrorKind } from "../lib/posErrors";

interface ProblemLike {
  code?: string;
  detail?: string;
}

/** The backend problem inside a rejected hook call (usePosData `unwrap` puts it in the message as JSON). */
function problemOf(error: unknown): ProblemLike | "network" | null {
  if (!error) return null;
  if (error instanceof TypeError || /Failed to fetch|NetworkError|ECONNREFUSED/i.test(String(error))) return "network";
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : null;
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object") return parsed as ProblemLike;
    } catch {
      return {};
    }
  }
  return typeof error === "object" ? (error as ProblemLike) : {};
}

const UNREACHABLE = "Can't reach Yetu. Check the internet connection, then try again.";

/**
 * Refusals about this action (a conflict whose detail isn't one we name, a
 * validation message, or nothing recognisable) get the action's own words;
 * the backend's sentence never reaches the screen. Everything else is about
 * the session, the till or the property (session expired, till revoked,
 * feature not enabled, Yetu unavailable) and keeps the words the rest of the
 * till uses for it.
 */
const ACTION_WORDS_FOR: ReadonlySet<PosErrorKind> = new Set(["BUSINESS_CONFLICT", "VALIDATION_ERROR", "UNKNOWN"]);

function otherWords(problem: ProblemLike, actionWords: string): string {
  const described = describePosError(problem);
  return ACTION_WORDS_FOR.has(described.kind) ? actionWords : described.message;
}

export interface CashProblem<K extends string> {
  kind: K | "network" | "permission" | "other";
  words: string;
}

/**
 * Closing a shift. fbc-peak internal/pos/controls.go CloseShift refuses with
 * CONFLICT and one of these details.
 */
export function closeShiftProblem(
  error: unknown,
): CashProblem<"open-orders" | "offline-cash" | "supervisor" | "not-open"> | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  const detail = problem.detail ?? "";
  if (detail === "shift has open orders") {
    return {
      kind: "open-orders",
      words: "Some orders on this till are still open. Take payment for them or void them, then close the shift.",
    };
  }
  if (detail === "shift has unresolved offline cash") {
    return {
      kind: "offline-cash",
      words: "Cash taken without internet hasn't been settled yet. Reconnect so it can be sent, or ask a manager to sort it out in Yetu.",
    };
  }
  if (detail === "supervisor approval failed") {
    return {
      kind: "supervisor",
      words: "The drawer doesn't match what Yetu expects, so a manager must approve. Their PIN wasn't accepted, or they can't approve this.",
    };
  }
  if (detail === "shift is not open") return { kind: "not-open", words: "This shift is already closed." };
  // Today this never matches: fbc-peak internal/pos/http.go CloseShift writes
  // every error from the close, the pos.shift.close permission check
  // included, as CONFLICT with the error text as detail. A missing permission
  // therefore arrives as a CONFLICT we don't name and gets the action's own
  // words. Kept for when the backend answers FORBIDDEN (recorded as a backend
  // follow-up).
  if (problem.code === "FORBIDDEN") return { kind: "permission", words: "Only a cashier or manager can close the shift." };
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
  if (problem.code === "FORBIDDEN") return { kind: "permission", words: "Only a manager can close the day." };
  return { kind: "other", words: otherWords(problem, "The day couldn't be closed. Try again.") };
}

/** Cash in and out. fbc-peak internal/pos/cash.go. */
export function cashMovementProblem(error: unknown): CashProblem<"supervisor" | "no-shift"> | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  const detail = problem.detail ?? "";
  if (/supervisor/i.test(detail)) {
    return {
      kind: "supervisor",
      words: "A different supervisor must approve taking cash out. Their PIN wasn't accepted, or they can't approve this.",
    };
  }
  if (detail === "no open shift on this terminal") return { kind: "no-shift", words: "No shift is open on this till." };
  if (problem.code === "FORBIDDEN") {
    return { kind: "permission", words: "Only a cashier or manager can put cash in or take it out." };
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
