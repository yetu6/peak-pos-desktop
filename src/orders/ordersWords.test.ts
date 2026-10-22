import { describe, expect, it } from "vitest";
import type { POSOrder, POSOrderPayment, POSStationTicket } from "../lib/posContracts";
import { clockTime } from "../lib/words";
import { billProblem, itemVoidWords, orderMatches, orderStateWords, orderTimeline, quantityProblem, removeProblem, reprintProblem, sendProblem, voidedWords } from "./ordersWords";

function order(extra: Partial<POSOrder> = {}): POSOrder {
  return {
    id: "order-1",
    shiftId: "shift-1",
    orderNumber: "POS-MR-261012-42",
    dailyNumber: 42,
    createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    closedAt: null,
    payments: [],
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
  it("finds an order by its number for the day, as staff say it", () => {
    expect(orderMatches(order(), "42")).toBe(true);
    expect(orderMatches(order(), "Order 42")).toBe(true);
    expect(orderMatches(order(), "order 42")).toBe(true);
    expect(orderMatches(order(), "#42")).toBe(true);
    expect(orderMatches(order(), "43")).toBe(false);
    // The number, not its digits: order 42 is not order 4 or order 2.
    expect(orderMatches(order({ totalMinor: 1_180_000 }), "order 4")).toBe(false);
  });

  it("finds an order by its reference, but never by the date inside every reference", () => {
    expect(orderMatches(order(), "POS-MR-261012-42")).toBe(true);
    expect(orderMatches(order(), "mr-261012-42")).toBe(true);
    // Every order today has 261012 in its reference: typed digits are a number, a table or an amount.
    expect(orderMatches(order({ tableLabel: "3", totalMinor: 1_180_000 }), "26")).toBe(false);
    expect(orderMatches(order({ tableLabel: "3", totalMinor: 1_180_000 }), "261012")).toBe(false);
  });

  it("finds an order with no number yet (taken offline, not synced) by its reference", () => {
    const offline = order({ dailyNumber: undefined as unknown as number, orderNumber: "OFF-T1-0007", tableLabel: "3", totalMinor: 1_180_000 });
    expect(orderMatches(offline, "0007")).toBe(true);
    expect(orderMatches(offline, "off-t1")).toBe(true);
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

describe("orderTimeline", () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const startedAt = minutesAgo(25);
  const sentAt = minutesAgo(20);
  const ticket = (station: POSStationTicket["station"], status: POSStationTicket["status"], lastStepAt = sentAt): POSStationTicket => ({
    id: `t-${station}`,
    orderId: "order-1",
    orderNumber: "0142",
    dailyNumber: 42,
    station,
    status,
    serviceType: "DINE_IN",
    version: 1,
    createdAt: sentAt,
    lastStepAt,
    items: [],
  });
  const paid = (paymentMethod: POSOrderPayment["paymentMethod"], amountMinor: number, createdAt: string): POSOrderPayment => ({
    id: `pay-${createdAt}`,
    paymentMethod,
    amountMinor,
    createdAt,
    recordedByName: "Grace Mushi",
  });
  const timeline = (extra: Partial<POSOrder>, tickets: POSStationTicket[] = []) =>
    orderTimeline({ order: order({ createdAt: startedAt, ...extra }), tickets, currency: "TZS" });
  const STARTED = { time: clockTime(startedAt), words: "Started" };

  it("starts with when the order was started, and says an open order hasn't gone to the kitchen", () => {
    expect(timeline({})).toEqual([STARTED, { time: null, words: "Not sent to the kitchen yet" }]);
  });

  it("gives when it was sent, then when each station moved to its step", () => {
    expect(timeline({ status: "PREPARING" }, [ticket("GRILL", "PREPARING", minutesAgo(15)), ticket("BAR", "READY", minutesAgo(12))])).toEqual([
      STARTED,
      { time: clockTime(sentAt), words: "Sent to the kitchen" },
      { time: clockTime(minutesAgo(15)), words: "Grill: preparing" },
      { time: clockTime(minutesAgo(12)), words: "Bar: ready" },
    ]);
  });

  it("a station not yet started has no step of its own to tell", () => {
    expect(timeline({ status: "SENT" }, [ticket("GRILL", "SENT")])).toEqual([STARTED, { time: clockTime(sentAt), words: "Sent to the kitchen" }]);
  });

  it("says the time sent isn't known when Yetu no longer lists its tickets", () => {
    expect(timeline({ status: "SENT" })).toEqual([STARTED, { time: null, words: "Sent to the kitchen (time not known)" }]);
    expect(timeline({ status: "SERVED" })).toEqual([
      STARTED,
      { time: null, words: "Sent to the kitchen (time not known)" },
      { time: null, words: "Now: Served" },
    ]);
  });

  it("trusts the order's own step when its stations weren't moved with it", () => {
    expect(timeline({ status: "SERVED" }, [ticket("GENERAL", "SENT")])).toEqual([
      STARTED,
      { time: clockTime(sentAt), words: "Sent to the kitchen" },
      { time: null, words: "Now: Served" },
    ]);
  });

  it("tells each payment when it was taken, in time order with the kitchen's steps", () => {
    expect(
      timeline({ status: "PREPARING", paidMinor: 1_000_000, payments: [paid("CASH", 1_000_000, minutesAgo(18))] }, [
        ticket("GRILL", "PREPARING", minutesAgo(15)),
      ]),
    ).toEqual([
      STARTED,
      { time: clockTime(sentAt), words: "Sent to the kitchen" },
      { time: clockTime(minutesAgo(18)), words: "Paid TSh 10,000 · Cash" },
      { time: clockTime(minutesAgo(15)), words: "Grill: preparing" },
    ]);
  });

  it("a paid order: each payment, a split's too, and a room charge", () => {
    expect(
      timeline({ status: "CLOSED", payments: [paid("MOBILE_MONEY", 2_000_000, minutesAgo(5)), paid("CASH", 2_779_000, minutesAgo(4))] }),
    ).toEqual([
      STARTED,
      { time: clockTime(minutesAgo(5)), words: "Paid TSh 20,000 · Mobile money" },
      { time: clockTime(minutesAgo(4)), words: "Paid TSh 27,790 · Cash" },
    ]);
    expect(timeline({ status: "CLOSED", payments: [paid("ROOM_CHARGE", 4_779_000, minutesAgo(3))] })).toEqual([
      STARTED,
      { time: clockTime(minutesAgo(3)), words: "Charged to the room · TSh 47,790" },
    ]);
  });

  it("a voided order says when it was voided", () => {
    expect(timeline({ status: "VOIDED", closedAt: minutesAgo(2) })).toEqual([STARTED, { time: clockTime(minutesAgo(2)), words: "Cancelled" }]);
  });

  it("leaves out a time Yetu didn't give, rather than guess", () => {
    expect(orderTimeline({ order: order({ createdAt: "" }), tickets: [], currency: "TZS" })).toEqual([
      { time: null, words: "Not sent to the kitchen yet" },
    ]);
  });
});

describe("refusals", () => {
  it("send: any refusal that isn't the connection, the person or the till means the order may have changed", () => {
    const changed = "This order changed on another till, or was already sent. It's been reloaded: check it before sending it again.";
    expect(sendProblem(refused({ code: "STALE_VERSION" }))).toEqual({ kind: "moved", words: changed });
    // Yetu answers a send of an order that is no longer open with a plain error (HTTP 500 today).
    expect(sendProblem(refused({ code: "INTERNAL_ERROR", detail: "only a non-empty open order can be sent" }))).toEqual({ kind: "moved", words: changed });
    expect(sendProblem(refused({ code: "FORBIDDEN" }))).toEqual({ kind: "permission", words: "Only staff who take orders can send them to the kitchen. Ask one to help." });
    expect(sendProblem(new TypeError("Failed to fetch"))?.kind).toBe("network");
    expect(sendProblem(refused({ code: "SESSION_EXPIRED" }))?.kind).toBe("session");
    expect(sendProblem(null)).toBeNull();
  });

  it("print a copy: a person who can't, no receipt, anything else", () => {
    expect(reprintProblem(refused({ code: "FORBIDDEN" }))?.words).toBe("Only a cashier or manager can print the bill again. Ask one to help.");
    expect(reprintProblem(refused({ code: "NOT_FOUND" }))?.words).toBe("There is no bill for this order.");
    expect(reprintProblem(refused({ code: "CONFLICT" }))?.words).toBe("The copy wasn't printed. Try again.");
  });

  it("change how many of an item: gone to the kitchen, paid, another till, anything else", () => {
    expect(quantityProblem(refused({ code: "ITEM_NOT_CHANGEABLE" }))).toEqual({
      kind: "stale",
      words: "This item can't be changed now. The order has been reloaded: if it hasn't gone to the kitchen, remove it and add it again.",
    });
    expect(quantityProblem(refused({ code: "INVALID_STATE" }))).toEqual({ kind: "paid", words: "This order has taken payment, so its items can't be changed." });
    expect(quantityProblem(refused({ code: "STALE_VERSION" }))?.kind).toBe("stale");
    expect(quantityProblem(refused({ code: "CONFLICT" }))?.words).toBe("The quantity wasn't changed. Try again.");
    expect(quantityProblem(new TypeError("Failed to fetch"))?.kind).toBe("network");
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

// F-243: the kitchen is told of a void only when it had heard of the order.
describe("voidedWords", () => {
  it("an order never sent was only on this till", () => {
    expect(voidedWords(order({ status: "OPEN", roundsSent: 0 }))).toBe("Order 42 was cancelled.");
    expect(voidedWords(order({ status: "OPEN" }))).toBe("Order 42 was cancelled.");
  });
  it("an order the kitchen has says it was told", () => {
    expect(voidedWords(order({ status: "SENT", roundsSent: 1 }))).toBe("Order 42 was cancelled. The kitchen has been told.");
    // Round 2 being taken on an order whose first round went: still the kitchen's.
    expect(voidedWords(order({ status: "OPEN", roundsSent: 1 }))).toBe("Order 42 was cancelled. The kitchen has been told.");
    // A Yetu before rounds: sent is a status.
    expect(voidedWords(order({ status: "PREPARING" }))).toBe("Order 42 was cancelled. The kitchen has been told.");
  });
});

// F-239: Order 3 had a Vegetable curry added and taken off; its history said nothing of it.
describe("orderTimeline: lines taken off before they were sent (F-239)", () => {
  it("says what was taken off, when and by whom", () => {
    const removedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const timeline = orderTimeline({
      order: order({
        status: "OPEN",
        items: [
          { id: "l1", productId: "p1", name: "Vegetable curry", quantity: 1, unitPriceMinor: 1_800_000, taxMinor: 0, totalMinor: 1_800_000, status: "VOIDED", removedAt, removedByName: "Zawadi Said" },
          { id: "l2", productId: "p2", name: "Soda", quantity: 2, unitPriceMinor: 150_000, taxMinor: 0, totalMinor: 300_000, status: "VOIDED" },
        ],
      }),
      tickets: [],
      currency: "TZS",
    });
    expect(timeline).toContainEqual({ time: clockTime(removedAt), words: "1 × Vegetable curry taken off before it was sent by Zawadi Said" });
    // A line voided without a removal (a Yetu before F-239) says nothing new.
    expect(timeline.map((entry) => entry.words).join(" ")).not.toContain("Soda");
  });
});

describe("orderTimeline: items voided after they were sent (fbc-peak 00125)", () => {
  const voidedAt = new Date(Date.now() - 4 * 60_000).toISOString();
  const tusker = { id: "l1", productId: "p1", name: "Tusker", quantity: 2, unitPriceMinor: 500_000, taxMinor: 152_542, totalMinor: 1_000_000, status: "SENT" as const, roundNumber: 1 };
  const spilled = { id: "v1", itemId: "l1", name: "Tusker", quantity: 1, taxMinor: 76_271, totalMinor: 500_000, reason: "Spilled", wholeOrder: false, askedByName: "Baraka Mushi", approvedByName: "Neema Kweka", createdAt: voidedAt };

  it("says what was voided, why, who asked and who approved", () => {
    const timeline = orderTimeline({ order: order({ status: "SENT", items: [tusker], voids: [spilled] }), tickets: [], currency: "TZS" });
    expect(timeline).toContainEqual({ time: clockTime(voidedAt), words: "1 × Tusker cancelled: Spilled · asked by Baraka Mushi, approved by Neema Kweka" });
  });

  it("an order whose items were all voided says Yetu closed it", () => {
    const timeline = orderTimeline({
      order: order({ status: "VOIDED", closedAt: voidedAt, items: [{ ...tusker, status: "VOIDED" }], voids: [{ ...spilled, quantity: 2 }] }),
      tickets: [],
      currency: "TZS",
    });
    expect(timeline.map((entry) => entry.words)).toContain("Closed automatically: every item was cancelled");
  });

  // Review 2026-10-21: one item voided, the other taken off before it was sent.
  it("an order emptied by a void and a removal says nothing was left, not that every item was voided", () => {
    const chips = { id: "l2", productId: "p2", name: "Chips", quantity: 1, unitPriceMinor: 300_000, taxMinor: 0, totalMinor: 300_000, status: "VOIDED" as const, removedAt: voidedAt, removedByName: "Baraka Mushi" };
    const timeline = orderTimeline({
      order: order({ status: "VOIDED", closedAt: voidedAt, items: [{ ...tusker, status: "VOIDED" }, chips], voids: [{ ...spilled, quantity: 2 }] }),
      tickets: [],
      currency: "TZS",
    });
    const words = timeline.map((entry) => entry.words);
    expect(words).toContain("Closed automatically: nothing was left on it");
    expect(words).not.toContain("Closed automatically: every item was cancelled");
  });

  it("a whole-order void says why and who asked, once, not line by line", () => {
    const whole = { ...spilled, quantity: 2, reason: "Wrong table", wholeOrder: true };
    const words = orderTimeline({
      order: order({ status: "VOIDED", closedAt: voidedAt, voidApprovedByName: "Neema Kweka", items: [{ ...tusker, status: "VOIDED" }], voids: [whole] }),
      tickets: [],
      currency: "TZS",
    }).map((entry) => entry.words);
    expect(words).toContain("Cancelled: Wrong table · asked by Baraka Mushi, approved by Neema Kweka");
    expect(words.join(" ")).not.toContain("2 × Tusker cancelled");
  });

  it("names nobody it wasn't told", () => {
    expect(itemVoidWords({ quantity: 1, name: "Soda", reason: "Spilled", askedByName: "", approvedByName: "Neema Kweka" })).toBe("1 × Soda cancelled: Spilled · approved by Neema Kweka");
  });
});

describe("orderTimeline: the discount (F-259)", () => {
  const soda = { id: "l1", productId: "p1", name: "Soda", quantity: 1, unitPriceMinor: 250_000, taxMinor: 38_136, totalMinor: 250_000, status: "ADDED" as const };

  it("says when, how much off as the guest saw it, why, who asked and who approved", () => {
    const appliedAt = new Date(Date.now() - 3 * 60_000).toISOString();
    const timeline = orderTimeline({
      // Order 8 at Bahari: TSh 500 off a TSh 2,500 soda, VAT inside the price; Yetu keeps 423.73 net.
      order: order({
        pricesIncludeTax: true,
        items: [soda],
        subtotalMinor: 211_864,
        discountKind: "AMOUNT",
        discountInput: 50_000,
        discountMinor: 42_373,
        discountReason: "Regular guest",
        taxMinor: 30_509,
        totalMinor: 200_000,
        discountAppliedAt: appliedAt,
        discountAskedByName: "Zawadi Said",
        discountApprovedByName: "Baraka Mushi",
      }),
      tickets: [],
      currency: "TZS",
    });
    expect(timeline).toContainEqual({
      time: clockTime(appliedAt),
      words: "Discount of TSh 500 · Regular guest · asked by Zawadi Said, approved by Baraka Mushi",
    });
  });

  it("gives a percent with its money, and a discount from before Yetu kept its time without one", () => {
    const timeline = orderTimeline({
      order: order({
        subtotalMinor: 400_000,
        discountKind: "PERCENT",
        discountInput: 1_000,
        discountMinor: 40_000,
        discountReason: "Staff meal",
        discountApprovedByName: "Baraka Mushi",
        taxMinor: 64_800,
        totalMinor: 424_800,
      }),
      tickets: [],
      currency: "TZS",
    });
    expect(timeline).toContainEqual({ time: null, words: "Discount of 10% (TSh 400) · Staff meal · approved by Baraka Mushi" });
  });

  it("says nothing of a discount when there is none", () => {
    const words = orderTimeline({ order: order({ items: [soda] }), tickets: [], currency: "TZS" }).map((entry) => entry.words);
    expect(words.join(" ")).not.toContain("Discount");
  });
});

// F-260 (fbc-peak #286): Order 10's four soups were taken off before they were
// sent; it stayed open at TSh 0. Yetu now closes such an order itself, naming
// no supervisor, and the till says so rather than calling it voided.
describe("an order Yetu closed with nothing on it (F-260)", () => {
  const removedAt = new Date(Date.now() - 3 * 60_000).toISOString();
  const soup = { id: "l1", productId: "p1", name: "Soup of the day", quantity: 1, unitPriceMinor: 900_000, taxMinor: 0, totalMinor: 900_000 };
  const emptied = order({ status: "VOIDED", closedAt: removedAt, items: [{ ...soup, status: "VOIDED", removedAt, removedByName: "Zawadi Said" }] });

  it("its history and its state say it had nothing left on it", () => {
    const words = orderTimeline({ order: emptied, tickets: [], currency: "TZS" }).map((entry) => entry.words);
    expect(words).toContain("Closed automatically: nothing was left on it");
    expect(words).not.toContain("Cancelled");
    expect(orderStateWords(emptied)).toEqual({ words: "Nothing on it", tone: "neutral" });
  });

  it("a void says who approved it, and stays a void", () => {
    const voided = order({ status: "VOIDED", closedAt: removedAt, voidApprovedByName: "Baraka Mushi", items: [{ ...soup, status: "VOIDED", removedAt }] });
    expect(orderTimeline({ order: voided, tickets: [], currency: "TZS" }).map((entry) => entry.words)).toContain("Cancelled · approved by Baraka Mushi");
    expect(orderStateWords(voided).words).toBe("Cancelled");
    // From a Yetu before #286 no void names its supervisor: one with a line sent, or none at all, is still a void.
    const sentThenVoided = order({ status: "VOIDED", closedAt: removedAt, items: [{ ...soup, status: "VOIDED" }] });
    expect(orderStateWords(sentThenVoided).words).toBe("Cancelled");
    expect(orderStateWords(order({ status: "VOIDED", closedAt: removedAt, items: [] })).words).toBe("Cancelled");
  });
});

// fbc-peak #288 (2026-10-20): the guest gets the bill before paying; each one is in the order's history.
describe("the bill before payment", () => {
  it("each bill printed is in the history, with who printed it", () => {
    const printedAt = new Date(Date.now() - 4 * 60_000).toISOString();
    const words = orderTimeline({
      order: order({ billPrints: [{ printedAt, printedByName: "Zawadi Said" }, { printedAt }] }),
      tickets: [],
      currency: "TZS",
    });
    expect(words).toContainEqual({ time: clockTime(printedAt), words: "Bill printed by Zawadi Said" });
    expect(words).toContainEqual({ time: clockTime(printedAt), words: "Bill printed" });
  });

  it("says why a bill wasn't printed", () => {
    expect(billProblem(refused({ code: "BILL_NOTHING_ON_IT" }))?.words).toBe("Nothing is on this order yet, so there is no bill to print.");
    expect(billProblem(refused({ code: "BILL_ORDER_NOT_OPEN" }))).toEqual({ kind: "moved", words: "This order is paid or cancelled now. It's been reloaded." });
    expect(billProblem(refused({ code: "FORBIDDEN" }))?.kind).toBe("permission");
    expect(billProblem(refused({ code: "TAB_WAITING_FOR_SHIFT" }))?.words).toBe("Take this tab over first, then print its bill.");
  });
});
