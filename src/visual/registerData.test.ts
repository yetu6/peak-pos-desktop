import { describe, expect, it } from "vitest";
import type { POSOrder } from "../lib/posContracts";
import { CASH_RECEIVED, CHANGE_GIVEN, ORDER, PAID_ORDER, PRODUCTS, RECEIPT, SENT_ORDER, SPLIT_ORDER } from "./registerData";

/**
 * The fixtures' figures are what Yetu would work out from their own lines
 * (fbc-peak AddItem and recomputeOrderTotalsFromLines): a line's gross is
 * its unit price (options included) times its quantity, its VAT is the gross
 * at the item's rate rounded half up, its total is gross plus VAT; the
 * order's subtotal, VAT and total are the sums, less any discount.
 */
function lineVat(grossMinor: number, rateBp: number): number {
  return Math.floor((grossMinor * rateBp + 5000) / 10000);
}

function expectYetuArithmetic(order: POSOrder) {
  let subtotal = 0;
  let vat = 0;
  for (const line of order.items.filter((item) => item.status !== "VOIDED")) {
    const product = PRODUCTS.find((candidate) => candidate.id === line.productId);
    expect(product, `${line.name} is on the menu`).toBeDefined();
    const gross = line.unitPriceMinor * line.quantity;
    expect(line.taxMinor, `${line.name} VAT`).toBe(lineVat(gross, product!.taxRateBp));
    expect(line.totalMinor, `${line.name} total`).toBe(gross + line.taxMinor);
    subtotal += gross;
    vat += line.taxMinor;
  }
  expect(order.subtotalMinor).toBe(subtotal);
  expect(order.taxMinor).toBe(vat);
  expect(order.totalMinor).toBe(subtotal + vat - order.discountMinor);
  expect(order.remainingMinor).toBe(order.totalMinor - order.paidMinor);
}

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
