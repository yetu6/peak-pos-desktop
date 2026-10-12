import { describe, expect, it } from "vitest";
import type { POSOrder, POSReceipt, POSStationTicket } from "../lib/posContracts";
import { clockTime } from "../lib/words";
import { orderMatches, orderTimeline, paidThisShift, removeProblem, reprintProblem, sendProblem } from "./ordersWords";

function order(extra: Partial<POSOrder> = {}): POSOrder {
  return {
    id: "order-1",
    shiftId: "shift-1",
    orderNumber: "0142",
    status: "OPEN",
    serviceType: "DINE_IN",
    tableLabel: "12",
    initiatedById: "staff-1",
    initiatedByName: "Amina Hassan",
    subtotalMinor: 4_050_000,
    discountMinor: 0,
    discountKind: "NONE",
    discountInput: 0,
    taxMinor: 729_000,
    totalMinor: 4_779_000,
    paidMinor: 0,
    remainingMinor: 4_779_000,
    version: 4,
    items: [],
    ...extra,
  };
}

const refused = (problem: Record<string, unknown>) => new Error(JSON.stringify(problem));

describe("orderMatches", () => {
  it("finds an order by its number", () => {
    expect(orderMatches(order(), "0142")).toBe(true);
    expect(orderMatches(order(), "142")).toBe(true);
    expect(orderMatches(order(), "0143")).toBe(false);
  });

  it("finds an order by its table or room, with or without the word", () => {
    expect(orderMatches(order(), "table 12")).toBe(true);
    expect(orderMatches(order(), "Table 1")).toBe(true);
    expect(orderMatches(order({ serviceType: "ROOM_SERVICE", tableLabel: "204" }), "room 204")).toBe(true);
    expect(orderMatches(order({ serviceType: "ROOM_SERVICE", tableLabel: "204" }), "204")).toBe(true);
    expect(orderMatches(order({ serviceType: "ROOM_SERVICE", tableLabel: "204" }), "table 204")).toBe(false);
  });

  it("finds an order by its total, typed as people write it", () => {
    expect(orderMatches(order(), "47790")).toBe(true);
    expect(orderMatches(order(), "47,790")).toBe(true);
    expect(orderMatches(order(), "TSh 47,790")).toBe(true);
    expect(orderMatches(order(), "47,7")).toBe(true);
    expect(orderMatches(order(), "57,790")).toBe(false);
  });

  it("doesn't find every order from one stray digit of an amount in the middle", () => {
    expect(orderMatches(order({ orderNumber: "0150", tableLabel: "3" }), "77")).toBe(false);
  });

  it("doesn't take the currency or a comma alone for an amount", () => {
    expect(orderMatches(order(), "TSh")).toBe(false);
    expect(orderMatches(order(), ",")).toBe(false);
  });

  it("finds everything when nothing is typed", () => {
    expect(orderMatches(order(), "   ")).toBe(true);
  });
});

describe("paidThisShift", () => {
  it("keeps this shift's paid orders, the latest first", () => {
    const orders = [
      order({ id: "a", status: "CLOSED" }),
      order({ id: "b", status: "OPEN" }),
      order({ id: "c", status: "CLOSED", shiftId: "shift-0" }),
      order({ id: "d", status: "VOIDED" }),
      order({ id: "e", status: "CLOSED" }),
    ];
    expect(paidThisShift(orders, "shift-1").map((entry) => entry.id)).toEqual(["e", "a"]);
    expect(paidThisShift(orders, undefined)).toEqual([]);
  });
});

describe("orderTimeline", () => {
  const sentAt = new Date(Date.now() - 20 * 60_000).toISOString();
  const settledAt = new Date(Date.now() - 2 * 60_000).toISOString();
  const ticket = (station: POSStationTicket["station"], status: POSStationTicket["status"]): POSStationTicket => ({
    id: `t-${station}`,
    orderId: "order-1",
    orderNumber: "0142",
    station,
    status,
    serviceType: "DINE_IN",
    version: 1,
    createdAt: sentAt,
    items: [],
  });

  it("says an open order hasn't gone to the kitchen", () => {
    expect(orderTimeline({ order: order(), tickets: [] })).toEqual([{ time: null, words: "Not sent to the kitchen yet" }]);
  });

  it("gives the time it was sent, then where each station is now (Yetu keeps no time for the steps)", () => {
    expect(
      orderTimeline({ order: order({ status: "PREPARING" }), tickets: [ticket("GRILL", "PREPARING"), ticket("BAR", "READY")] }),
    ).toEqual([
      { time: clockTime(sentAt), words: "Sent to the kitchen" },
      { time: null, words: "Now: Grill preparing" },
      { time: null, words: "Now: Bar ready" },
    ]);
  });

  it("doesn't say an order just sent is sent twice", () => {
    expect(orderTimeline({ order: order({ status: "SENT" }), tickets: [] })).toEqual([
      { time: null, words: "Sent to the kitchen (time not known)" },
    ]);
  });

  it("says the time sent isn't known when Yetu no longer lists its tickets", () => {
    expect(orderTimeline({ order: order({ status: "SERVED" }), tickets: [] })).toEqual([
      { time: null, words: "Sent to the kitchen (time not known)" },
      { time: null, words: "Now: Served" },
    ]);
  });

  it("trusts the order's own step when its stations weren't moved with it (a selling till moved the whole order)", () => {
    expect(orderTimeline({ order: order({ status: "SERVED" }), tickets: [ticket("GENERAL", "SENT")] })).toEqual([
      { time: clockTime(sentAt), words: "Sent to the kitchen" },
      { time: null, words: "Now: Served" },
    ]);
  });

  it("ends a paid order with when and how it was paid, from its receipt", () => {
    const receipt = { document: { settledAt, tenderMethod: "SPLIT" } } as unknown as POSReceipt;
    expect(orderTimeline({ order: order({ status: "CLOSED" }), tickets: [], receipt })).toEqual([
      { time: clockTime(settledAt), words: "Paid: split payment" },
    ]);
    const room = { document: { settledAt, tenderMethod: "ROOM_CHARGE" } } as unknown as POSReceipt;
    expect(orderTimeline({ order: order({ status: "CLOSED" }), tickets: [], receipt: room })).toEqual([
      { time: clockTime(settledAt), words: "Charged to the room" },
    ]);
  });

  it("says a paid order is paid while its receipt is still loading", () => {
    expect(orderTimeline({ order: order({ status: "CLOSED" }), tickets: [] })).toEqual([{ time: null, words: "Paid" }]);
  });
});

describe("refusals", () => {
  it("send: a changed order, a person who can't send, anything else", () => {
    expect(sendProblem(refused({ code: "STALE_VERSION" }))?.words).toBe(
      "This order changed on another till. It's been reloaded: check it, then send it again.",
    );
    expect(sendProblem(refused({ code: "FORBIDDEN" }))?.words).toBe("Only staff who take orders can send them to the kitchen.");
    expect(sendProblem(refused({ code: "INTERNAL_ERROR", detail: "only a non-empty open order can be sent" }))?.kind).toBe("other");
    expect(sendProblem(null)).toBeNull();
  });

  it("print a copy: a person who can't, no receipt, anything else", () => {
    expect(reprintProblem(refused({ code: "FORBIDDEN" }))?.words).toBe("Only a cashier or manager can print a copy of the receipt.");
    expect(reprintProblem(refused({ code: "NOT_FOUND" }))?.words).toBe("Yetu has no receipt for this order.");
    expect(reprintProblem(refused({ code: "CONFLICT" }))?.words).toBe("The copy wasn't printed. Try again.");
  });

  it("remove an item: an order that has taken money, anything else", () => {
    expect(removeProblem(refused({ code: "INVALID_STATE" }))?.words).toBe(
      "This order has taken payment, so its items can't be removed.",
    );
    expect(removeProblem(refused({ code: "CONFLICT", detail: "only an unsent item on an open order can be removed" }))?.words).toBe(
      "The item wasn't removed. Try again.",
    );
  });
});
