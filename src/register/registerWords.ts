/**
 * Plain words for the register's refusals: discount and void (fbc-peak
 * internal/pos commerce.go ApplyDiscount, controls.go VoidOrder), payment and
 * room charge. Each refusal is worded by its code (fbc-peak errors.go since
 * S5b), never by the sentence Yetu writes. Words for refusals that aren't
 * about the action come from the till's own (otherWords).
 */
import { describePosError } from "../lib/posErrors";
import { otherWords, problemOf, READ_AFTER_RECORD_FAILED, UNREACHABLE } from "../lib/problemWords";

export interface RegisterProblem {
  kind: "supervisor" | "no-approver" | "paid" | "stale" | "network" | "permission" | "other";
  words: string;
}

/** Nobody is chosen to approve this kind here (fbc-peak #258, 409 NO_APPROVER_SET): the owner chooses. */
export function noApproverWords(what: string): string {
  return `No one is set to approve ${what} here yet. The owner chooses who approves in Team rules.`;
}

export function discountProblem(error: unknown): RegisterProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  switch (problem.code) {
    // A refused supervisor PIN or role is written as FORBIDDEN (ErrPOSPermissionDenied).
    case "FORBIDDEN":
      return {
        kind: "supervisor",
        words: "A different supervisor must approve the discount. Their PIN wasn't accepted, or they can't approve discounts.",
      };
    case "NO_APPROVER_SET":
      return { kind: "no-approver", words: noApproverWords("discounts") };
    case "ORDER_HAS_PAYMENT":
      return { kind: "paid", words: "A discount can't be added once part of the bill is paid." };
    case "ORDER_STATE_CHANGED":
      return { kind: "paid", words: "This order is paid or voided, so it can't take a discount." };
  }
  return { kind: "other", words: otherWords(problem, "The discount wasn't applied. Try again.") };
}

export function voidProblem(error: unknown): RegisterProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  switch (problem.code) {
    // A refused supervisor PIN or role: 403 FORBIDDEN since fbc-peak #252 (it was a 409 before).
    case "FORBIDDEN":
      return {
        kind: "supervisor",
        words: "A different supervisor must approve the void. Their PIN wasn't accepted, or they can't approve voids.",
      };
    case "NO_APPROVER_SET":
      return { kind: "no-approver", words: noApproverWords("voids") };
    // Another till changed the order first; the screen asks Yetu for it again (onStale).
    case "STALE_VERSION":
      return { kind: "stale", words: "This order changed on another till. It's been reloaded: check it, then ask a supervisor again." };
    // Part of it is paid: INVALID_STATE (ErrOrderHasPayment, unchanged by S5b).
    case "INVALID_STATE":
      return { kind: "paid", words: "This order has already taken payment, so it can't be voided." };
    case "ORDER_STATE_CHANGED":
      return { kind: "paid", words: "This order is already paid or voided, so it can't be voided." };
  }
  return { kind: "other", words: otherWords(problem, "The order wasn't voided. Try again.") };
}

/** Recording a payment (fbc-peak internal/pos/controls.go RecordTender). */
export function tenderProblem(error: unknown): RegisterProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  switch (problem.code) {
    // Another till changed the order first; the sheet gets Yetu's latest figures (PaySheet).
    case "STALE_VERSION":
      return { kind: "stale", words: "This order changed on another till. The amounts here are Yetu's latest: check them, then try again." };
    case "TENDER_EXCEEDS_BALANCE":
      return { kind: "other", words: "That's more than is still owed. Check the amount, then try again." };
    case "ORDER_ALREADY_PAID":
      return { kind: "paid", words: "This order is already paid." };
    case "ORDER_STATE_CHANGED":
      return { kind: "paid", words: "This order is closed, so it can't take a payment." };
    case "FORBIDDEN":
      return { kind: "permission", words: "Only a cashier or manager can take payment. Ask one to help." };
  }
  return { kind: "other", words: otherWords(problem, "The payment wasn't recorded. Try again.") };
}

/** Charging an order to a guest's room (fbc-peak internal/pos/operations.go ChargeRoom). */
export function roomChargeProblem(error: unknown): RegisterProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  switch (problem.code) {
    case "ORDER_HAS_PAYMENT":
      return { kind: "paid", words: "Charge to room isn't possible once part of the bill is paid." };
    case "FOLIO_NOT_OPEN":
      return { kind: "other", words: "That guest's bill isn't open. Ask the front desk." };
    // Only an order sent to the kitchen and not paid can go on a room bill.
    case "ORDER_STATE_CHANGED":
      return { kind: "other", words: "This order can't go on a room bill." };
  }
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
  quantity: "change how many of an item",
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
  const words = SELL_REFUSALS[step][problem.code ?? ""];
  if (words) return { kind: "other", words };
  const described = describePosError(problem);
  if (described.kind === "NETWORK_ERROR" || described.kind === "SERVER_UNAVAILABLE") return { kind: "network", words: described.message };
  if (described.kind === "STALE_VERSION") return { kind: "stale", words: described.message };
  return { kind: "other", words: described.message };
}

/** Each step's own refusals on Sell, by code (fbc-peak operations.go since S5b). */
const SELL_REFUSALS: Record<keyof typeof SELL_STEPS, Readonly<Record<string, string>>> = {
  create: { SHIFT_NOT_OPEN: "No shift is open on this till. Open a shift first." },
  add: {
    PRODUCT_UNAVAILABLE: "That item is sold out or not on the menu now.",
    ORDER_STATE_CHANGED: "This order has gone to the kitchen. Start a new sale to add more.",
  },
  remove: { ITEM_NOT_REMOVABLE: "This item has gone to the kitchen, so it can't be removed." },
  quantity: {
    ITEM_NOT_CHANGEABLE: "This item can't be changed now. If it hasn't gone to the kitchen, remove it and add it again.",
    INVALID_STATE: "This order has taken payment, so its items can't be changed.",
  },
  send: {
    ORDER_EMPTY: "Add something to the order before sending it.",
    ORDER_STATE_CHANGED: "This order was already sent, paid or voided.",
  },
  availability: {},
};

/**
 * The refusals that say the order moved on before this request: another till
 * changed it, paid some or all of it, or closed it (fbc-peak errors.go since
 * S5b; CONFLICT and INVALID_STATE are the codes these had before).
 */
const ORDER_MOVED_CODES: ReadonlySet<string> = new Set([
  "STALE_VERSION",
  "ORDER_STATE_CHANGED",
  "ORDER_ALREADY_PAID",
  "ORDER_HAS_PAYMENT",
  "TENDER_EXCEEDS_BALANCE",
  "CONFLICT",
  "INVALID_STATE",
]);

/**
 * The refusals that prove a payment or room charge was not recorded: Yetu
 * replays a key that succeeded before any other check (fbc-peak
 * idempotency.Begin, inside the same transaction as the payment), so one of
 * these can only come from Yetu looking at the request and refusing it (the
 * order moved on, it is paid or closed, the guest's bill isn't open, or the
 * request itself is invalid).
 */
const NOT_RECORDED_CODES: ReadonlySet<string> = new Set([...ORDER_MOVED_CODES, "FOLIO_NOT_OPEN", "VALIDATION_FAILED"]);

/**
 * What Yetu's answer to a request means for one whose earlier answer was lost:
 * - "refused": only for a code that proves it was not recorded (above);
 * - "cannot-tell": refused before Yetu looked at the request (the session, the
 *   till or the property), so its fate can't be asked from here;
 * - "unsure": everything else, a missing code, a proxy's text page, a 404 or
 *   403 (the order read after a recorded payment can fail too) included: the
 *   same request is sent again until Yetu answers for it.
 */
export function afterLostAnswer(error: unknown): "unsure" | "cannot-tell" | "refused" {
  const problem = problemOf(error);
  if (!problem || problem === "network") return "unsure";
  if (problem.code && NOT_RECORDED_CODES.has(problem.code)) return "refused";
  switch (describePosError(problem).kind) {
    case "AUTHENTICATION_REQUIRED":
    case "SESSION_EXPIRED":
    case "DEVICE_REVOKED":
    case "CAPABILITY_NOT_ENABLED":
      return "cannot-tell";
    default:
      return "unsure";
  }
}

/**
 * A first answer to a payment or room charge that is no answer at all: the
 * connection, Yetu busy or down, a page that isn't Yetu's (no code), the
 * request still running, or the order read after a recorded payment failing.
 * Anything else with a code is Yetu's answer to the request (a refusal).
 */
export function firstAnswerLost(error: unknown): boolean {
  const problem = problemOf(error);
  if (!problem || problem === "network" || !problem.code) return true;
  if (problem.code === "IDEMPOTENT_REQUEST_IN_PROGRESS" || problem.code === READ_AFTER_RECORD_FAILED) return true;
  const kind = describePosError(problem).kind;
  return kind === "NETWORK_ERROR" || kind === "SERVER_UNAVAILABLE" || kind === "RETRYABLE_INFRASTRUCTURE_ERROR";
}

/** A payment or room charge Yetu refused after its first answer was lost: what to say. */
export function lostAnswerRefusalWords(error: unknown, room: boolean): string {
  const what = room ? "charge" : "payment";
  const kind = afterLostAnswer(error);
  if (kind === "cannot-tell") {
    return `Yetu couldn't answer for this ${what} because you were signed out. Sign in again, then check this order in Orders before taking any money.`;
  }
  const refusal = room ? roomChargeProblem(error) : tenderProblem(error);
  // Refused because the order moved on: stale, already paid, more than is owed, not eligible.
  if (refusal && (refusal.kind === "stale" || refusal.kind === "paid" || refusal.kind === "other")) {
    const problem = problemOf(error);
    const moved = problem !== "network" && problem !== null && ORDER_MOVED_CODES.has(problem.code ?? "");
    if (moved) {
      return `This order was paid or changed on another till, so this ${what} wasn't recorded. The amounts here are Yetu's latest: check them before taking any money.`;
    }
  }
  return refusal?.words ?? `The ${what} wasn't recorded. Try again.`;
}
