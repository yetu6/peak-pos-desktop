/**
 * Plain words for the register's refusals: discount and void (fbc-peak
 * internal/pos commerce.go ApplyDiscount, controls.go VoidOrder). Words for
 * refusals that aren't about the action come from the till's own (otherWords).
 */
import { otherWords, problemOf, UNREACHABLE } from "../lib/problemWords";

export interface RegisterProblem {
  kind: "supervisor" | "paid" | "stale" | "network" | "other";
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
  // A refused supervisor PIN or role: 403 FORBIDDEN since fbc-peak #252 (it was a 409 before).
  if (problem.code === "FORBIDDEN") {
    return {
      kind: "supervisor",
      words: "A different supervisor must approve the void. Their PIN wasn't accepted, or they can't approve voids.",
    };
  }
  // Another till changed the order first; the screen asks Yetu for it again (onStale).
  if (problem.code === "STALE_VERSION") {
    return { kind: "stale", words: "This order changed on another till. It's been reloaded: check it, then ask a supervisor again." };
  }
  // A part-paid order: INVALID_STATE (ErrOrderHasPayment); a paid or voided one: CONFLICT.
  if (problem.code === "INVALID_STATE" || /refund workflow/i.test(detail)) {
    return { kind: "paid", words: "This order has already taken payment, so it can't be voided." };
  }
  return { kind: "other", words: otherWords(problem, "The order wasn't voided. Try again.") };
}

/** Recording a payment (fbc-peak internal/pos/controls.go RecordTender). */
export function tenderProblem(error: unknown): RegisterProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  const detail = problem.detail ?? "";
  // Another till changed the order first; the sheet gets Yetu's latest figures (PaySheet).
  if (problem.code === "STALE_VERSION") {
    return { kind: "stale", words: "This order changed on another till. The amounts here are Yetu's latest: check them, then try again." };
  }
  if (detail === "tender exceeds remaining balance") {
    return { kind: "other", words: "That's more than is still owed. Check the amount, then try again." };
  }
  if (detail === "order remaining balance is already settled") return { kind: "paid", words: "This order is already paid." };
  if (/closed or voided order/i.test(detail)) return { kind: "paid", words: "This order is closed, so it can't take a payment." };
  if (problem.code === "FORBIDDEN") return { kind: "other", words: "Only a cashier or manager can take payment." };
  return { kind: "other", words: otherWords(problem, "The payment wasn't recorded. Try again.") };
}

/** Charging an order to a guest's room (fbc-peak internal/pos/operations.go ChargeRoom). */
export function roomChargeProblem(error: unknown): RegisterProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  const detail = problem.detail ?? "";
  if (detail === "room charge cannot follow a partial tender") {
    return { kind: "paid", words: "Charge to room isn't possible once part of the bill is paid." };
  }
  if (detail === "active stay with open folio not found") return { kind: "other", words: "That guest's bill isn't open. Ask the front desk." };
  if (detail === "order is not eligible for room charge") return { kind: "other", words: "This order can't go on a room bill." };
  return { kind: "other", words: otherWords(problem, "The room charge didn't go through. Try again.") };
}
