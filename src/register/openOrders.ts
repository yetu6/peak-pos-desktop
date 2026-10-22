import { orderName } from "../lib/orderNumber";
import type { POSOrder } from "../lib/posContracts";
import { clockTime, orderPlaceWords } from "../lib/words";

/** The open orders the bar shows: still taking items or owing, never paid or cancelled. */
export function openOrdersOf(orders: readonly POSOrder[]): POSOrder[] {
  return orders.filter((order) => order.status !== "CLOSED" && order.status !== "VOIDED");
}

/**
 * The bar's order: the person's own orders first, then the rest, each oldest
 * first, as a waiter works through their tables. The order on the ticket
 * keeps its place: it is never moved away from under the person's finger.
 */
export function barOrder(orders: readonly POSOrder[], staffId: string | null | undefined): POSOrder[] {
  return [...orders].sort((a, b) => {
    const mineA = staffId && a.initiatedById === staffId ? 0 : 1;
    const mineB = staffId && b.initiatedById === staffId ? 0 : 1;
    if (mineA !== mineB) return mineA - mineB;
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
}

/** Everything on an order, as the list says it: "2 Soda, Samosa, Chips". */
export function openOrderItemsWords(order: POSOrder): string {
  const lines = (order.items ?? []).filter((line) => line.status !== "VOIDED");
  return lines.length ? lines.map((line) => (line.quantity > 1 ? `${line.quantity} ${line.name}` : line.name)).join(", ") : "Nothing on it yet";
}

/**
 * How a waiter knows an order at a glance, with or without tables (owner,
 * 2026-10-21: many places name no tables; the waiter keeps track): its table
 * or the name they typed, else its number; then what is on it, and when it was started.
 */
export function openOrderWords(order: POSOrder): { name: string; items: string; time: string } {
  const place = orderPlaceWords(order.serviceType, order.tableLabel, order.askForTable);
  const lines = (order.items ?? []).filter((line) => line.status !== "VOIDED");
  const shown = lines.slice(0, 2).map((line) => (line.quantity > 1 ? `${line.quantity} ${line.name}` : line.name));
  const more = lines.length > 2 ? ` +${lines.length - 2}` : "";
  return {
    name: place || orderName(order),
    items: lines.length ? `${shown.join(", ")}${more}` : "Nothing on it yet",
    time: clockTime(order.createdAt),
  };
}
