/**
 * Reading Yetu's orders list a page at a time (GET /pos/orders?view=open|paid,
 * fbc-peak orders_list.go since S5b): each page gives `nextCursor`, passed
 * back as `cursor` for the next, and null on the last. The till asks at
 * Yetu's own page size (YETU_POS_ORDERS_PAGE_DEFAULT), never one of its own,
 * so a page size the server was set to refuse can't stop the list.
 */
import type { POSOrder, POSOrderPage } from "../lib/posContracts";

export interface EveryPage {
  orders: POSOrder[];
  /** False when the ceiling of pages was reached with more still to come. */
  complete: boolean;
}

/**
 * Every page, in Yetu's order, up to `mostPages` pages. An order that moved
 * between two pages while they were read is kept once, where it came first.
 * A page that fails fails the whole list: part of it is never taken for all.
 */
export async function listEveryPage(fetchPage: (cursor?: string) => Promise<POSOrderPage>, mostPages: number): Promise<EveryPage> {
  const orders: POSOrder[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < mostPages; page++) {
    const { items, nextCursor } = await fetchPage(cursor);
    for (const order of items) {
      if (seen.has(order.id)) continue;
      seen.add(order.id);
      orders.push(order);
    }
    if (!nextCursor) return { orders, complete: true };
    cursor = nextCursor;
  }
  return { orders, complete: false };
}
