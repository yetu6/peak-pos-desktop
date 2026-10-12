import { describe, expect, it } from "vitest";
import { CASH_RECEIVED, CHANGE_GIVEN, ORDER, PAID_ORDER, RECEIPT, SENT_ORDER, SPLIT_ORDER } from "./registerData";
import { expectYetuArithmetic } from "./yetuArithmetic";

describe("the Sell fixtures' figures", () => {
  it.each([
    ["on the ticket", ORDER],
    ["sent to the kitchen", SENT_ORDER],
    ["part paid", SPLIT_ORDER],
    ["paid", PAID_ORDER],
  ])("order 0142 %s adds up from its lines", (_name, order) => {
    expectYetuArithmetic(order);
  });

  it("is one order everywhere: the same lines and totals on the ticket, when paid and on the receipt", () => {
    for (const order of [SENT_ORDER, SPLIT_ORDER, PAID_ORDER]) {
      expect(order.orderNumber).toBe(ORDER.orderNumber);
      expect(order.items.map(({ name, quantity, totalMinor }) => [name, quantity, totalMinor])).toEqual(
        ORDER.items.map(({ name, quantity, totalMinor }) => [name, quantity, totalMinor]),
      );
      expect(order.totalMinor).toBe(ORDER.totalMinor);
    }
    expect(PAID_ORDER.paidMinor).toBe(PAID_ORDER.totalMinor);
    const doc = RECEIPT.document;
    expect(doc.orderNumber).toBe(ORDER.orderNumber);
    expect(doc.items.map(({ name, quantity, totalMinor }) => [name, quantity, totalMinor])).toEqual(
      ORDER.items.map(({ name, quantity, totalMinor }) => [name, quantity, totalMinor]),
    );
    expect([doc.subtotalMinor, doc.taxMinor, doc.totalMinor]).toEqual([ORDER.subtotalMinor, ORDER.taxMinor, ORDER.totalMinor]);
  });

  it("gives change from the cash handed over for the paid order", () => {
    expect(CHANGE_GIVEN).toBe(CASH_RECEIVED - PAID_ORDER.totalMinor);
  });
});
