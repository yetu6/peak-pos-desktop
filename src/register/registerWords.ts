/**
 * Plain words for the register's refusals: discount and void (fbc-peak
 * internal/pos commerce.go ApplyDiscount, controls.go VoidOrder). Words for
 * refusals that aren't about the action come from the till's own (otherWords).
 */
import { otherWords, problemOf, UNREACHABLE } from "../lib/problemWords";

export interface RegisterProblem {
  kind: "supervisor" | "paid" | "network" | "other";
  words: string;
}

export function discountProblem(error: unknown): RegisterProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  const detail = problem.detail ?? "";
  // A refused supervisor PIN or role is written as FORBIDDEN (ErrPOSPermissionDenied).
  if (problem.code === "FORBIDDEN") {
    return {
      kind: "supervisor",
      words: "A different supervisor must approve the discount. Their PIN wasn't accepted, or they can't approve discounts.",
    };
  }
  if (/after a tender/i.test(detail)) return { kind: "paid", words: "A discount can't be added once part of the bill is paid." };
  return { kind: "other", words: otherWords(problem, "The discount wasn't applied. Try again.") };
}

export function voidProblem(error: unknown): RegisterProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  const detail = problem.detail ?? "";
  if (detail === "supervisor approval failed" || problem.code === "FORBIDDEN") {
    return {
      kind: "supervisor",
      words: "A different supervisor must approve the void. Their PIN wasn't accepted, or they can't approve voids.",
    };
  }
  // A part-paid order: INVALID_STATE (ErrOrderHasPayment); a paid or voided one: CONFLICT.
  if (problem.code === "INVALID_STATE" || /refund workflow/i.test(detail)) {
    return { kind: "paid", words: "This order has already taken payment, so it can't be voided." };
  }
  return { kind: "other", words: otherWords(problem, "The order wasn't voided. Try again.") };
}
