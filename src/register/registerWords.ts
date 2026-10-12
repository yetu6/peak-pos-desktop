/**
 * Plain words for the register's refusals: discount and void (fbc-peak
 * internal/pos commerce.go ApplyDiscount, controls.go VoidOrder). Words for
 * refusals that aren't about the action come from the till's own (otherWords).
 */
import { describePosError } from "../lib/posErrors";
import { otherWords, problemOf, UNREACHABLE } from "../lib/problemWords";

export interface RegisterProblem {
  kind: "supervisor" | "paid" | "stale" | "network" | "permission" | "other";
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
  if (problem.code === "FORBIDDEN") return { kind: "permission", words: "Only a cashier or manager can take payment. Ask one to help." };
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

/**
 * What each step on Sell is, for its permission refusal. Yetu checks
 * pos.order.create, pos.order.item.add / .remove and pos.order.send
 * (fbc-peak internal/pos operations.go); marking an item sold out checks
 * pos.order.create too. All of them belong to the staff who take orders.
 */
export const SELL_STEPS = {
  create: "start a new order",
  add: "add items to an order",
  remove: "remove items from an order",
  send: "send them to the kitchen",
  availability: "mark items sold out",
} as const;

/** A refused step on Sell: who may do it (403), the connection, or the refusal in words. */
export function sellProblem(error: unknown, step: keyof typeof SELL_STEPS): RegisterProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  if (problem.code === "FORBIDDEN") {
    return { kind: "permission", words: `Only staff who take orders can ${SELL_STEPS[step]}. Ask one to help.` };
  }
  const described = describePosError(problem);
  if (described.kind === "NETWORK_ERROR" || described.kind === "SERVER_UNAVAILABLE") return { kind: "network", words: described.message };
  if (described.kind === "STALE_VERSION") return { kind: "stale", words: described.message };
  return { kind: "other", words: described.message };
}

/**
 * What Yetu's answer to a request means for one whose earlier answer was lost.
 * Yetu replays a key that succeeded before any other check (fbc-peak
 * idempotency.Begin, inside the same transaction as the payment), so:
 * - "unsure": no answer about the request yet (the connection, Yetu busy or
 *   down, or the first request still running: IDEMPOTENT_REQUEST_IN_PROGRESS);
 * - "cannot-tell": refused before Yetu looked at the request (the session, the
 *   till or the property), so its fate is still unknown and can't be asked here;
 * - "refused": Yetu looked and refused it, so it was not recorded.
 */
export function afterLostAnswer(error: unknown): "unsure" | "cannot-tell" | "refused" {
  const problem = problemOf(error);
  if (problem === "network") return "unsure";
  if (!problem) return "refused";
  if (problem.code === "IDEMPOTENT_REQUEST_IN_PROGRESS") return "unsure";
  switch (describePosError(problem).kind) {
    case "NETWORK_ERROR":
    case "SERVER_UNAVAILABLE":
    case "RETRYABLE_INFRASTRUCTURE_ERROR":
    case "RATE_LIMITED":
      return "unsure";
    case "AUTHENTICATION_REQUIRED":
    case "SESSION_EXPIRED":
    case "DEVICE_REVOKED":
    case "CAPABILITY_NOT_ENABLED":
      return "cannot-tell";
    default:
      return "refused";
  }
}

/** A payment or room charge Yetu refused after its first answer was lost: what to say. */
export function lostAnswerRefusalWords(error: unknown, room: boolean): string {
  const what = room ? "charge" : "payment";
  const kind = afterLostAnswer(error);
  if (kind === "cannot-tell") {
    return `Yetu couldn't answer for this ${what} because your session ended. Sign in again, then check this order in Orders before taking any money.`;
  }
  const refusal = room ? roomChargeProblem(error) : tenderProblem(error);
  // Refused because the order moved on: stale, already paid, more than is owed, not eligible.
  if (refusal && (refusal.kind === "stale" || refusal.kind === "paid" || refusal.kind === "other")) {
    const problem = problemOf(error);
    const moved =
      problem !== "network" &&
      problem !== null &&
      (problem.code === "STALE_VERSION" || problem.code === "CONFLICT" || problem.code === "INVALID_STATE");
    if (moved) {
      return `This order was paid or changed on another till, so this ${what} wasn't recorded. The amounts here are Yetu's latest: check them before taking any money.`;
    }
  }
  return refusal?.words ?? `The ${what} wasn't recorded. Try again.`;
}
