/**
 * Plain words for Orders: finding an order, what happened to it (from the
 * times Yetu keeps), and the backend's refusals for the actions on it
 * (fbc-peak internal/pos operations.go SendOrder and RemoveItem,
 * receipts.go ReprintReceipt).
 */
import { stationWords } from "../kitchen/kitchenWords";
import { majorDigits } from "../lib/money";
import type { POSOrder, POSReceipt, POSStationTicket } from "../lib/posContracts";
import { otherWords, problemOf, stepRefusal, UNREACHABLE } from "../lib/problemWords";
import { clockTime, orderPlaceWords, orderStatusWords, paymentMethodWords, ticketStepWords, type SettlementMethod } from "../lib/words";

const AMOUNT_TYPED = /^\d+(\.\d*)?$/;

/**
 * Whether an order is the one typed in the search: its number, its table or
 * room ("12", "Table 12", "Room 204"), or the start of its total as people
 * write it ("47790", "47,790", "TSh 47,7").
 */
export function orderMatches(order: POSOrder, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (order.orderNumber.toLowerCase().includes(needle)) return true;
  const label = order.tableLabel?.trim().toLowerCase() ?? "";
  if (label && label.includes(needle)) return true;
  const place = orderPlaceWords(order.serviceType, order.tableLabel).toLowerCase();
  if (place && place.includes(needle)) return true;
  const amount = needle.replace(/^tsh/, "").replace(/[\s,]/g, "");
  if (!AMOUNT_TYPED.test(amount)) return false;
  return majorDigits(order.totalMinor).replace(/,/g, "").startsWith(amount);
}

/**
 * This shift's paid orders, the latest first. Yetu's order list has no
 * date or status of its own to ask for (GET /pos/orders takes only
 * `active`), so the till keeps the paid orders that belong to its open shift.
 */
export function paidThisShift(orders: readonly POSOrder[], shiftId: string | undefined): POSOrder[] {
  return orders.filter((order) => order.status === "CLOSED" && order.shiftId === shiftId).reverse();
}

const STEP_RANK: Record<POSStationTicket["status"], number> = { SENT: 0, PREPARING: 1, READY: 2, SERVED: 3 };

export interface TimelineEntry {
  /** A clock time from Yetu, or null where Yetu keeps none. */
  time: string | null;
  words: string;
}

function paidWords(method: string): string {
  if (method === "ROOM_CHARGE") return "Charged to the room";
  if (method === "SPLIT") return "Paid: split payment";
  return `Paid: ${paymentMethodWords(method as SettlementMethod).toLowerCase()}`;
}

/**
 * What happened to an order, from the times Yetu keeps: sent (its earliest
 * station ticket), where each station is now, and paid (its receipt). Yetu
 * keeps no time for when an order was started or for each kitchen step.
 */
export function orderTimeline({
  order,
  tickets,
  receipt,
}: {
  order: POSOrder;
  /** This order's station tickets still in the kitchen. */
  tickets: readonly POSStationTicket[];
  receipt?: POSReceipt;
}): TimelineEntry[] {
  if (order.status === "OPEN") return [{ time: null, words: "Not sent to the kitchen yet" }];
  if (order.status === "VOIDED") return [{ time: null, words: orderStatusWords("VOIDED") }];
  if (order.status === "CLOSED") {
    const doc = receipt?.document;
    return doc ? [{ time: clockTime(doc.settledAt) || null, words: paidWords(doc.tenderMethod) }] : [{ time: null, words: "Paid" }];
  }
  const sent = tickets
    .map((ticket) => ticket.createdAt)
    .filter((at) => Number.isFinite(Date.parse(at)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const entries: TimelineEntry[] = [
    sent ? { time: clockTime(sent), words: "Sent to the kitchen" } : { time: null, words: "Sent to the kitchen (time not known)" },
  ];
  // Yetu puts an order at its slowest station's step when a display moves a
  // station; a selling till moves the whole order and leaves its stations as
  // they were. The stations are told only while they agree with the order.
  const slowest = Math.min(...tickets.map((ticket) => STEP_RANK[ticket.status]));
  if (tickets.length > 0 && slowest === STEP_RANK[order.status as POSStationTicket["status"]]) {
    for (const ticket of tickets) {
      entries.push({ time: null, words: `Now: ${stationWords(ticket.station)} ${ticketStepWords(ticket.status).toLowerCase()}` });
    }
  } else if (order.status !== "SENT") {
    entries.push({ time: null, words: `Now: ${orderStatusWords(order.status)}` });
  }
  return entries;
}

export interface OrderProblem {
  kind: "stale" | "moved" | "permission" | "session" | "paid" | "missing" | "network" | "other";
  words: string;
}

/**
 * Sending an open order to the kitchen. Yetu answers a send of an order that
 * is no longer open with a plain error (HTTP 500, operations.go SendOrder),
 * so any refusal that isn't the connection, the person or the till means the
 * order may have changed: the screen reloads it.
 */
export function sendProblem(error: unknown): OrderProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  const kind = stepRefusal(problem);
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  if (kind === "network") return { kind, words: otherWords(problem, UNREACHABLE) };
  if (kind === "permission") return { kind, words: "Only staff who take orders can send them to the kitchen." };
  if (kind === "session") return { kind, words: otherWords(problem, "The order wasn't sent. Try again.") };
  return { kind: "moved", words: "This order changed on another till, or was already sent. It's been reloaded: check it before sending it again." };
}

/** Printing a copy of a paid order's receipt (needs pos.payment.record). */
export function reprintProblem(error: unknown): OrderProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  if (problem.code === "FORBIDDEN") return { kind: "permission", words: "Only a cashier or manager can print a copy of the receipt." };
  if (problem.code === "NOT_FOUND") return { kind: "missing", words: "Yetu has no receipt for this order." };
  return { kind: "other", words: otherWords(problem, "The copy wasn't printed. Try again.") };
}

/** Removing a line that hasn't gone to the kitchen. */
export function removeProblem(error: unknown): OrderProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "network", words: UNREACHABLE };
  // ErrOrderHasPayment: INVALID_STATE (migration 00090 refuses it in the database too).
  if (problem.code === "INVALID_STATE") return { kind: "paid", words: "This order has taken payment, so its items can't be removed." };
  if (problem.code === "STALE_VERSION") {
    return { kind: "stale", words: "This order changed on another till. It's been reloaded: check it, then try again." };
  }
  return { kind: "other", words: otherWords(problem, "The item wasn't removed. Try again.") };
}
