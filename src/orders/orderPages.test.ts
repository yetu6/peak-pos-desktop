import { describe, expect, it, vi } from "vitest";
import type { POSOrder, POSOrderPage } from "../lib/posContracts";
import { ORDER } from "../visual/registerData";
import { IncompleteOrdersError, listEveryPage, listWholeList } from "./orderPages";

/**
 * Yetu's orders list pages by a cursor (fbc-peak orders_list.go): each page gives `nextCursor`, null on the last.
 * This stands in for it with the same rules: a page of orders in Yetu's order, and a cursor only it hands out.
 */
function yetuPages(total: number, pageSize: number) {
  const orders: POSOrder[] = Array.from({ length: total }, (_, index) => ({ ...ORDER, id: `order-${index + 1}`, dailyNumber: index + 1 }));
  const asked: Array<string | undefined> = [];
  const fetchPage = vi.fn(async (cursor?: string): Promise<POSOrderPage> => {
    asked.push(cursor);
    const start = cursor === undefined ? 0 : Number(cursor.replace("after-", ""));
    if (!Number.isInteger(start)) throw new Error("a cursor Yetu never gave");
    const items = orders.slice(start, start + pageSize);
    const next = start + pageSize < total ? `after-${start + pageSize}` : null;
    return { items, nextCursor: next };
  });
  return { orders, fetchPage, asked };
}

describe("listEveryPage", () => {
  it("asks for the next page with the cursor Yetu gave, until there is none, keeping Yetu's order", async () => {
    const yetu = yetuPages(120, 50);
    const result = await listEveryPage(yetu.fetchPage, 10);
    expect(yetu.asked).toEqual([undefined, "after-50", "after-100"]);
    expect(result.orders.map((order) => order.id)).toEqual(yetu.orders.map((order) => order.id));
    expect(result.complete).toBe(true);
  });

  it("asks once when everything fits on one page", async () => {
    const yetu = yetuPages(7, 50);
    const result = await listEveryPage(yetu.fetchPage, 10);
    expect(yetu.fetchPage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ orders: yetu.orders, complete: true });
  });

  it("stops at its ceiling of pages and says the list is not complete", async () => {
    const yetu = yetuPages(500, 50);
    const result = await listEveryPage(yetu.fetchPage, 3);
    expect(yetu.fetchPage).toHaveBeenCalledTimes(3);
    expect(result.orders).toHaveLength(150);
    expect(result.complete).toBe(false);
  });

  it("an order on two pages (it moved while paging) is kept once", async () => {
    const yetu = yetuPages(3, 2);
    yetu.fetchPage.mockImplementationOnce(async () => ({ items: yetu.orders.slice(0, 2), nextCursor: "after-1" }));
    const result = await listEveryPage(yetu.fetchPage, 10);
    expect(result.orders.map((order) => order.id)).toEqual(["order-1", "order-2", "order-3"]);
  });

  it("a page that fails fails the list: no part of it is taken for all of it", async () => {
    const yetu = yetuPages(120, 50);
    yetu.fetchPage.mockImplementationOnce(async () => ({ items: yetu.orders.slice(0, 50), nextCursor: "after-50" }));
    yetu.fetchPage.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(listEveryPage(yetu.fetchPage, 10)).rejects.toThrow("Failed to fetch");
  });
});

describe("listWholeList", () => {
  it("gives every open order when the pages end", async () => {
    const yetu = yetuPages(120, 50);
    await expect(listWholeList(yetu.fetchPage, 3)).resolves.toHaveLength(120);
  });

  it("refuses a list cut at the ceiling rather than show part of it as all", async () => {
    const yetu = yetuPages(160, 50);
    await expect(listWholeList(yetu.fetchPage, 3)).rejects.toBeInstanceOf(IncompleteOrdersError);
  });
});
