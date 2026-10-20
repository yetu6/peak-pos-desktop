/**
 * Plain words for Orders: finding an order, what happened to it (from the
 * times Yetu keeps), and the backend's refusals for the actions on it
 * (fbc-peak internal/pos operations.go SendOrder and RemoveItem,
 * receipts.go ReprintReceipt).
 */
import { stationWords } from "../kitchen/kitchenWords";
import { formatMoney, majorDigits } from "../lib/money";
import type { POSOrder, POSOrderPayment, POSStationTicket } from "../lib/posContracts";
import { otherWords, problemOf, stepRefusal, UNREACHABLE } from "../lib/problemWords";
import { clockTime, orderPlaceWords, orderStatusTone, orderStatusWords, paymentMethodWords, ticketStepWords, type Tone } from "../lib/words";
import { orderName, orderReference } from "../lib/orderNumber";
import { vatFigures } from "../lib/vatWords";

const AMOUNT_TYPED = /^\d+(\.\d*)?$/;

const SAID_NUMBER = /^(?:order\s*|#\s*)?(\d+)$/;

/**
 * Whether an order is the one typed in the search: its number for the day
 * ("42", "Order 42", "#42"), its reference ("POS-MR-261012-42"), its table or
 * room ("12", "Table 12", "Room 204"), or the start of its total as people
 * write it ("47790", "47,790", "TSh 47,7"). Typed digits are never looked for
 * inside a reference: every reference of the day carries the same date, so
 * "26" would find them all. An order with no number yet (taken offline, not
 * synced) goes by its reference, so there its digits count.
 */
export function orderMatches(order: POSOrder, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const said = SAID_NUMBER.exec(needle);
  if (said && orderReference(order) !== null && Number(said[1]) === order.dailyNumber) return true;
  if ((!said || orderReference(order) === null) && order.orderNumber.toLowerCase().includes(needle)) return true;
  const label = order.tableLabel?.trim().toLowerCase() ?? "";
  if (label && label.includes(needle)) return true;
  const place = orderPlaceWords(order.serviceType, order.tableLabel).toLowerCase();
  if (place && place.includes(needle)) return true;
  const amount = needle.replace(/^tsh/, "").replace(/[\s,]/g, "");
  if (!AMOUNT_TYPED.test(amount)) return false;
  return majorDigits(order.totalMinor).replace(/,/g, "").startsWith(amount);
}

const STEP_RANK: Record<POSStationTicket["status"], number> = { SENT: 0, PREPARING: 1, READY: 2, SERVED: 3 };

export interface TimelineEntry {
  /** A clock time from Yetu, or null where Yetu keeps none. */
  time: string | null;
  words: string;
}

/** A clock time for one of Yetu's times, or null when it gave none that can be read. */
function timeOf(at: string | null | undefined): string | null {
  return at && Number.isFinite(Date.parse(at)) ? clockTime(at) || null : null;
}

/**
 * F-259: the discount as the history says it, off what the guest saw (vatFigures):
 * "Discount of TSh 500 · Regular guest · asked by Zawadi Said, approved by Baraka Mushi".
 */
function discountWords(order: POSOrder, currency: string | undefined): string {
  const off = formatMoney(vatFigures(order).discountMinor, currency);
  const what = order.discountKind === "PERCENT" ? `${Number((order.discountInput / 100).toFixed(2))}% (${off})` : off;
  const asked = order.discountAskedByName?.trim();
  const approved = order.discountApprovedByName?.trim();
  const who = [asked ? `asked by ${asked}` : null, approved ? `approved by ${approved}` : null].filter(Boolean).join(", ");
  return [`Discount of ${what}`, order.discountReason?.trim() || null, who || null].filter(Boolean).join(" · ");
}

function paymentWords(payment: POSOrderPayment, currency: string | undefined): string {
  const amount = formatMoney(payment.amountMinor, currency);
  if (payment.paymentMethod === "ROOM_CHARGE") return `Charged to the room · ${amount}`;
  return `Paid ${amount} · ${paymentMethodWords(payment.paymentMethod)}`;
}

/**
 * What happened to an order, in time order, from the times Yetu keeps
 * (S5b): when it was started, when it was sent (its earliest station
 * ticket), when each station moved to the step it is at, the discount
 * (F-259), each payment, and when it was voided. What Yetu keeps no time for (not sent yet, a sent time
 * whose tickets have left Yetu's list, the order's own step) comes after.
 */
export function orderTimeline({
  order,
  tickets,
  currency,
}: {
  order: POSOrder;
  /** This order's station tickets still in the kitchen. */
  tickets: readonly POSStationTicket[];
  currency: string | undefined;
}): TimelineEntry[] {
  const timed: Array<{ at: number; entry: TimelineEntry }> = [];
  const untimed: TimelineEntry[] = [];
  const add = (at: string | null | undefined, words: string) => {
    const time = timeOf(at);
    if (time !== null && at) timed.push({ at: Date.parse(at), entry: { time, words } });
  };

  add(order.createdAt, "Started");
  const inKitchen = order.status !== "OPEN" && order.status !== "CLOSED" && order.status !== "VOIDED";
  if (order.status === "OPEN") untimed.push({ time: null, words: "Not sent to the kitchen yet" });
  const sent = tickets
    .map((ticket) => ticket.createdAt)
    .filter((at) => timeOf(at) !== null)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  if (sent) add(sent, "Sent to the kitchen");
  else if (inKitchen) untimed.push({ time: null, words: "Sent to the kitchen (time not known)" });

  if (inKitchen) {
    // Yetu puts an order at its slowest station's step and moves the stations with a whole-order step (S5b).
    // Where they still disagree, the order's own step is told, with no time.
    const slowest = Math.min(...tickets.map((ticket) => STEP_RANK[ticket.status]));
    if (tickets.length > 0 && slowest === STEP_RANK[order.status as POSStationTicket["status"]]) {
      for (const ticket of tickets) {
        if (ticket.status !== "SENT") add(ticket.lastStepAt, `${stationWords(ticket.station)}: ${ticketStepWords(ticket.status).toLowerCase()}`);
      }
    } else if (order.status !== "SENT") {
      untimed.push({ time: null, words: `Now: ${orderStatusWords(order.status)}` });
    }
  }

  // A line taken off before it was sent stays in the order's history (F-239).
  for (const line of order.items) {
    if (line.status !== "VOIDED" || !line.removedAt) continue;
    const who = line.removedByName?.trim();
    add(line.removedAt, `${line.quantity} × ${line.name} taken off before it was sent${who ? ` by ${who}` : ""}`);
  }
  // The discount, when it was given (F-259); one from before Yetu kept the time comes after, untimed.
  if (order.discountKind !== "NONE") {
    if (timeOf(order.discountAppliedAt) !== null) add(order.discountAppliedAt, discountWords(order, currency));
    else untimed.push({ time: null, words: discountWords(order, currency) });
  }
  for (const payment of order.payments ?? []) add(payment.createdAt, paymentWords(payment, currency));
  if (order.status === "VOIDED") {
    if (timeOf(order.closedAt) !== null) add(order.closedAt, orderStatusWords("VOIDED"));
    else untimed.push({ time: null, words: orderStatusWords("VOIDED") });
  }

  // Array sort is stable: what happened at the same minute keeps the order above.
  return [...timed.sort((a, b) => a.at - b.at).map(({ entry }) => entry), ...untimed];
}

export interface OrderProblem {
  kind: "stale" | "moved" | "permission" | "session" | "paid" | "missing" | "network" | "other";
  words: string;
}

/**
 * Sending an open order to the kitchen (operations.go SendOrder). Nothing on
 * it is ORDER_EMPTY; any other refusal that isn't the connection, the person
 * or the till (ORDER_STATE_CHANGED, STALE_VERSION) means the order may have
 * changed: the screen reloads it.
 */
export function sendProblem(error: unknown): OrderProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  const kind = stepRefusal(problem);
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  if (problem.code === "ORDER_EMPTY") return { kind: "other", words: "Add something to the order before sending it." };
  if (kind === "network") return { kind, words: otherWords(problem, UNREACHABLE) };
  if (kind === "permission") return { kind, words: "Only staff who take orders can send them to the kitchen. Ask one to help." };
  if (kind === "session") return { kind, words: otherWords(problem, "The order wasn't sent. Try again.") };
  return { kind: "moved", words: "This order changed on another till, or was already sent. It's been reloaded: check it before sending it again." };
}

/** Printing a copy of a paid order's receipt (needs pos.payment.record). */
export function reprintProblem(error: unknown): OrderProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  if (problem.code === "FORBIDDEN") return { kind: "permission", words: "Only a cashier or manager can print a copy of the receipt. Ask one to help." };
  if (problem.code === "NOT_FOUND") return { kind: "missing", words: "Yetu has no receipt for this order." };
  return { kind: "other", words: otherWords(problem, "The copy wasn't printed. Try again.") };
}

/** Printing a kitchen ticket again (S8a; needs pos.order.send, and paper kitchen tickets on this till). */
export function kitchenReprintProblem(error: unknown): OrderProblem | null {
  if (error instanceof Error && error.name === "KitchenPaperOff") return { kind: "other", words: error.message };
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  if (problem.code === "FORBIDDEN") return { kind: "permission", words: "Only staff who take orders can print a kitchen ticket again. Ask one to help." };
  if (problem.code === "NOT_FOUND") return { kind: "missing", words: "Nothing of this order has gone to the kitchen yet: send it first." };
  return { kind: "other", words: otherWords(problem, "The kitchen ticket wasn't printed again. Try again.") };
}

/** What happened when a kitchen ticket was printed again: the round, and whether the printer took it. */
export function kitchenReprintWords(roundNumber: number, roundsSent: number | undefined, failed: string | undefined): string {
  const ticket = (roundsSent ?? 0) > 1 ? `Round ${roundNumber}'s kitchen ticket` : "The kitchen ticket";
  if (failed) return `${ticket} was made again, but the printer didn't print it: ${failed}`;
  return `${ticket} went to the printer again, marked COPY.`;
}

/** S17b: taking over a tab handed over to the next shift. */
export function takeOverProblem(error: unknown): OrderProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  if (problem.code === "SHIFT_NOT_OPEN") return { kind: "other", words: "Open a shift on this till, then take the tab over." };
  if (problem.code === "TAB_NOT_WAITING") return { kind: "moved", words: "Another till has taken this tab over. It's been reloaded." };
  if (problem.code === "FORBIDDEN") return { kind: "permission", words: "Only staff who take orders can take a tab over. Ask one to help." };
  return { kind: "other", words: otherWords(problem, "The tab wasn't taken over. Try again.") };
}

/** How many of a line that hasn't gone to the kitchen (the stepper). */
export function quantityProblem(error: unknown): OrderProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  if (problem.code === "INVALID_STATE") return { kind: "paid", words: "This order has taken payment, so its items can't be changed." };
  // It went to the kitchen meanwhile (sent on another till): reloaded, so the screen shows it as Yetu has it.
  if (problem.code === "ITEM_NOT_CHANGEABLE") {
    return { kind: "stale", words: "This item can't be changed now. The order has been reloaded: if it hasn't gone to the kitchen, remove it and add it again." };
  }
  if (problem.code === "STALE_VERSION") {
    return { kind: "stale", words: "This order changed on another till. It's been reloaded: check it, then try again." };
  }
  return { kind: "other", words: otherWords(problem, "The quantity wasn't changed. Try again.") };
}

/** Removing a line that hasn't gone to the kitchen. */
export function removeProblem(error: unknown): OrderProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  // ErrOrderHasPayment: INVALID_STATE (migration 00090 refuses it in the database too).
  if (problem.code === "INVALID_STATE") return { kind: "paid", words: "This order has taken payment, so its items can't be removed." };
  // It went to the kitchen meanwhile (sent on another till): reloaded, so the screen shows it as Yetu has it.
  if (problem.code === "ITEM_NOT_REMOVABLE") {
    return { kind: "stale", words: "This item has gone to the kitchen, so it can't be removed. The order has been reloaded." };
  }
  if (problem.code === "STALE_VERSION") {
    return { kind: "stale", words: "This order changed on another till. It's been reloaded: check it, then try again." };
  }
  return { kind: "other", words: otherWords(problem, "The item wasn't removed. Try again.") };
}

/**
 * An order's state on a list, in words: Partly refunded or Refunded once
 * money went back on it (Yetu's refundedMinor, S10a), else its status.
 */
export function orderStateWords(order: Pick<POSOrder, "status" | "totalMinor" | "refundedMinor">): { words: string; tone: Tone } {
  const refunded = order.refundedMinor ?? 0;
  if (refunded > 0) return { words: refunded >= order.totalMinor ? "Refunded" : "Partly refunded", tone: "danger" };
  return { words: orderStatusWords(order.status), tone: orderStatusTone(order.status) };
}

/** Whether the kitchen heard of an order: a round went, or it moved on from open (F-243). */
export function reachedTheKitchen(order: Pick<POSOrder, "status" | "roundsSent">): boolean {
  return (order.roundsSent ?? 0) > 0 || order.status !== "OPEN";
}

/**
 * What the till says once an order is voided: the kitchen is told only of an
 * order it had heard of (F-243); one never sent was only ever on this till.
 */
export function voidedWords(order: Pick<POSOrder, "dailyNumber" | "orderNumber" | "status" | "roundsSent">): string {
  return `${orderName(order)} was voided.${reachedTheKitchen(order) ? " The kitchen has been told." : ""}`;
}

/** What voiding does, said before the supervisor approves it (F-243). */
export function voidSheetWords(order: Pick<POSOrder, "status" | "roundsSent">): string {
  return reachedTheKitchen(order)
    ? "Takes the whole order off and tells the kitchen. This is not a refund: no money moves."
    : "Takes the whole order off. It never went to the kitchen. This is not a refund: no money moves.";
}
