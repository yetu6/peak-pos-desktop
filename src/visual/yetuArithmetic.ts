import { expect } from "vitest";
import type { POSOrder } from "../lib/posContracts";
import { PRODUCTS } from "./registerData";

/**
 * For the fixture data's tests: an order's figures are what Yetu would work
 * out from its own lines (fbc-peak AddItem and recomputeOrderTotalsFromLines).
 * A line's gross is its unit price (options included) times its quantity, its
 * VAT is the gross at the item's rate rounded half up, its total is gross
 * plus VAT; the order's subtotal, VAT and total are the sums, less any
 * discount, and what remains is the total less what was paid.
 */
export function lineVat(grossMinor: number, rateBp: number): number {
  return Math.floor((grossMinor * rateBp + 5000) / 10000);
}

export function expectYetuArithmetic(order: POSOrder) {
  let subtotal = 0;
  let vat = 0;
  for (const line of order.items.filter((item) => item.status !== "VOIDED")) {
    const product = PRODUCTS.find((candidate) => candidate.id === line.productId);
    expect(product, `${line.name} is on the menu`).toBeDefined();
    const options = (line.modifiers ?? []).reduce((sum, modifier) => sum + modifier.priceDeltaMinor, 0);
    expect(line.unitPriceMinor, `${line.name} unit price`).toBe(product!.priceMinor + options);
    const gross = line.unitPriceMinor * line.quantity;
    expect(line.taxMinor, `${line.name} VAT`).toBe(lineVat(gross, product!.taxRateBp));
    expect(line.totalMinor, `${line.name} total`).toBe(gross + line.taxMinor);
    subtotal += gross;
    vat += line.taxMinor;
  }
  expect(order.subtotalMinor, `${order.orderNumber} subtotal`).toBe(subtotal);
  expect(order.taxMinor, `${order.orderNumber} VAT`).toBe(vat);
  expect(order.totalMinor, `${order.orderNumber} total`).toBe(subtotal + vat - order.discountMinor);
  expect(order.remainingMinor, `${order.orderNumber} still to pay`).toBe(order.totalMinor - order.paidMinor);
}
