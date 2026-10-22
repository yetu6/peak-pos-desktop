import { describe, expect, it } from "vitest";
import type { POSOrder } from "../lib/posContracts";
import { barOrder, openOrderWords, openOrdersOf } from "./openOrders";

function order(over: Partial<POSOrder>): POSOrder {
  return {
    id: "o", shiftId: "s", orderNumber: "0007", dailyNumber: 7, createdAt: "2026-10-21T14:05:00Z", closedAt: null, payments: [],
    status: "OPEN", serviceType: "DINE_IN", initiatedById: "amina", initiatedByName: "Amina", subtotalMinor: 0, discountMinor: 0,
    discountKind: "NONE", discountInput: 0, taxMinor: 0, totalMinor: 0, paidMinor: 0, remainingMinor: 0, version: 1, items: [],
    ...over,
  } as POSOrder;
}
const line = (name: string, quantity = 1, status: "ADDED" | "SENT" | "VOIDED" = "ADDED") =>
  ({ id: name, productId: name, name, quantity, unitPriceMinor: 1, taxMinor: 0, totalMinor: 1, status });

describe("the open-orders bar (owner, 2026-10-21)", () => {
  it("says when each order was started, as the waiter reads a clock (W4: Order 7 · 2 Soda, Samosa · 14:05)", () => {
    const started = order({ createdAt: new Date(2026, 9, 21, 14, 5).toISOString(), items: [line("Soda", 2), line("Samosa")] as POSOrder["items"] });
    expect(openOrderWords(started)).toEqual({ name: "Order 7", items: "2 Soda, Samosa", time: "14:05" });
  });

  it("names an order by its table, the name the waiter typed, or its number", () => {
    expect(openOrderWords(order({ tableLabel: "9" })).name).toBe("Table 9");
    expect(openOrderWords(order({ tableLabel: "T4" })).name).toBe("Table T4");
    expect(openOrderWords(order({ tableLabel: "12A" })).name).toBe("Table 12A");
    expect(openOrderWords(order({ tableLabel: "Mama Neema" })).name).toBe("Mama Neema");
    expect(openOrderWords(order({ tableLabel: "Window" })).name).toBe("Window");
    expect(openOrderWords(order({ tableLabel: "Bar stool 3" })).name).toBe("Bar stool 3");
    expect(openOrderWords(order({ tableLabel: "  " })).name).toBe("Order 7");
    expect(openOrderWords(order({ serviceType: "TAKEAWAY", tableLabel: "9" })).name).toBe("Order 7");
  });

  it("says what is on it, the first two and how many more, never what was cancelled", () => {
    expect(openOrderWords(order({ items: [line("Soda", 2), line("Samosa")] })).items).toBe("2 Soda, Samosa");
    expect(openOrderWords(order({ items: [line("Soda"), line("Chips"), line("Tea"), line("Cake")] })).items).toBe("Soda, Chips +2");
    expect(openOrderWords(order({ items: [line("Soda", 1, "VOIDED")] })).items).toBe("Nothing on it yet");
  });

  it("shows only orders still open, the person's own first, oldest first", () => {
    const mineLate = order({ id: "a", createdAt: "2026-10-21T15:00:00Z" });
    const othersEarly = order({ id: "b", initiatedById: "zawadi", createdAt: "2026-10-21T13:00:00Z" });
    const mineEarly = order({ id: "c", createdAt: "2026-10-21T14:00:00Z" });
    const paid = order({ id: "d", status: "CLOSED" });
    const cancelled = order({ id: "e", status: "VOIDED" });
    const shown = barOrder(openOrdersOf([mineLate, othersEarly, mineEarly, paid, cancelled]), "amina");
    expect(shown.map((o) => o.id)).toEqual(["c", "a", "b"]);
  });
});
