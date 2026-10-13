import type { POSCatalogProduct, POSCategory, POSOrder, POSOrderItem, POSReceipt, POSRoomChargeCandidate } from "../lib/posContracts";

/**
 * The Sell fixtures' data in the backend's shapes: one menu and one order
 * (POS-7c41e09b, numbered as Yetu numbers orders) seen on the ticket, in
 * Pay, when paid and on its receipt.
 */

export const CURRENCY = "TZS";

export const CATEGORIES: POSCategory[] = [
  { id: "coffee", outletId: "o", code: "COF", name: "Coffee", sortOrder: 1, isActive: true },
  { id: "breakfast", outletId: "o", code: "BRK", name: "Breakfast", sortOrder: 2, isActive: true },
  { id: "mains", outletId: "o", code: "MNS", name: "Mains", sortOrder: 3, isActive: true },
  { id: "drinks", outletId: "o", code: "DRK", name: "Drinks", sortOrder: 4, isActive: true },
  { id: "desserts", outletId: "o", code: "DST", name: "Desserts", sortOrder: 5, isActive: true },
];

function item(id: string, name: string, categoryId: string, priceMinor: number, extra: Partial<POSCatalogProduct> = {}): POSCatalogProduct {
  return { id, categoryId, code: id.toUpperCase(), name, priceMinor, currency: CURRENCY, taxRateBp: 1800, isAvailable: true, ...extra };
}

export const BURGER: POSCatalogProduct = item("burger", "House burger", "mains", 2_200_000, {
  modifierGroups: [
    {
      id: "cook",
      productId: "burger",
      name: "Cooked",
      minSelect: 1,
      maxSelect: 1,
      isActive: true,
      options: [
        { id: "rare", groupId: "cook", name: "Rare", priceDeltaMinor: 0, isAvailable: true },
        { id: "medium", groupId: "cook", name: "Medium", priceDeltaMinor: 0, isAvailable: true },
        { id: "well", groupId: "cook", name: "Well done", priceDeltaMinor: 0, isAvailable: true },
      ],
    },
    {
      id: "extras",
      productId: "burger",
      name: "Extras",
      minSelect: 0,
      maxSelect: 2,
      isActive: true,
      options: [
        { id: "cheese", groupId: "extras", name: "Cheese", priceDeltaMinor: 150_000, isAvailable: true },
        { id: "egg", groupId: "extras", name: "Fried egg", priceDeltaMinor: 100_000, isAvailable: true },
        { id: "bacon", groupId: "extras", name: "Bacon", priceDeltaMinor: 250_000, isAvailable: true },
      ],
    },
  ],
});

export const PRODUCTS: POSCatalogProduct[] = [
  item("capp", "Cappuccino", "coffee", 650_000),
  item("flat", "Flat white", "coffee", 700_000),
  item("spiced", "Spiced Zanzibar coffee with ginger and cardamom", "coffee", 800_000),
  item("breakfast", "Full breakfast", "breakfast", 1_800_000),
  item("avo", "Avocado toast", "breakfast", 1_450_000, { isAvailable: false }),
  BURGER,
  item("chicken", "Grilled chicken", "mains", 2_500_000),
  item("curry", "Coconut curry", "mains", 2_150_000),
  item("nyama", "Nyama choma", "mains", 2_800_000),
  item("tusker", "Tusker lager", "drinks", 500_000),
  item("juice", "Passion juice", "drinks", 600_000),
  item("water", "Sparkling water", "drinks", 400_000),
  item("tart", "Chocolate tart", "desserts", 950_000),
];

/**
 * A line as Yetu builds it (fbc-peak AddItem): the item's price plus its
 * options' extra prices, times the quantity, with VAT at the item's rate
 * rounded half up.
 */
export function line(
  productId: string,
  quantity: number,
  options: Array<[string, string]> = [],
  status: POSOrderItem["status"] = "ADDED",
): POSOrderItem {
  const product = PRODUCTS.find((candidate) => candidate.id === productId);
  if (!product) throw new Error(`${productId} is not on the fixture menu`);
  const modifiers = options.map(([groupName, optionName], index) => {
    const option = product.modifierGroups?.find((group) => group.name === groupName)?.options?.find((candidate) => candidate.name === optionName);
    if (!option) throw new Error(`${groupName} / ${optionName} is not an option of ${product.name}`);
    return { id: `${productId}-option-${index}`, groupName, optionName, priceDeltaMinor: option.priceDeltaMinor };
  });
  const unitPriceMinor = product.priceMinor + modifiers.reduce((sum, modifier) => sum + modifier.priceDeltaMinor, 0);
  const gross = unitPriceMinor * quantity;
  const taxMinor = Math.floor((gross * product.taxRateBp + 5000) / 10000);
  return {
    id: `line-${productId}`,
    productId,
    name: product.name,
    quantity,
    unitPriceMinor,
    taxMinor,
    totalMinor: gross + taxMinor,
    status,
    ...(modifiers.length ? { modifiers } : {}),
  };
}

/** An order's figures as Yetu works them out from its lines (recomputeOrderTotalsFromLines). */
export function order(items: POSOrderItem[], extra: Partial<POSOrder> = {}): POSOrder {
  const subtotalMinor = items.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0);
  const taxMinor = items.reduce((sum, item) => sum + item.taxMinor, 0);
  const totalMinor = subtotalMinor + taxMinor;
  const paidMinor = extra.paidMinor ?? 0;
  return {
    id: "order-1",
    shiftId: "shift-1",
    orderNumber: "POS-7c41e09b",
    status: "OPEN",
    serviceType: "DINE_IN",
    tableLabel: "12",
    initiatedById: "staff-amina",
    initiatedByName: "Amina Hassan",
    discountMinor: 0,
    discountKind: "NONE",
    discountInput: 0,
    version: 4,
    ...extra,
    items,
    subtotalMinor,
    taxMinor,
    totalMinor,
    paidMinor,
    remainingMinor: totalMinor - paidMinor,
  };
}

const LINES: Array<[string, number, Array<[string, string]>]> = [
  ["capp", 2, []],
  ["burger", 1, [["Cooked", "Medium"], ["Extras", "Cheese"]]],
  ["water", 1, []],
];

/** The order on the ticket, not yet sent. */
export const ORDER: POSOrder = order(LINES.map(([id, quantity, options]) => line(id, quantity, options)));

/** The same order after it went to the kitchen. */
export const SENT_ORDER: POSOrder = order(
  LINES.map(([id, quantity, options]) => line(id, quantity, options, "SENT")),
  { status: "SENT" },
);

/** The same order with TSh 20,000 paid. */
export const SPLIT_ORDER: POSOrder = order(SENT_ORDER.items, { status: "SENT", paidMinor: 2_000_000 });

/** The same order paid in full. */
export const PAID_ORDER: POSOrder = order(SENT_ORDER.items, { status: "CLOSED", paidMinor: SENT_ORDER.totalMinor });

/** Cash handed over for the paid order (TSh 50,000), and the change given back. */
export const CASH_RECEIVED = 5_000_000;
export const CHANGE_GIVEN = CASH_RECEIVED - PAID_ORDER.totalMinor;

export const STAYS: POSRoomChargeCandidate[] = [
  { stayId: "s12", roomId: "r12", roomNumber: "12", guestDisplayName: "Asha Mollel", postingEligible: true },
  { stayId: "s14", roomId: "r14", roomNumber: "14", guestDisplayName: "Daniel Mrema", postingEligible: true },
  { stayId: "s21", roomId: "r21", roomNumber: "21", guestDisplayName: "Neema Kiwelu", postingEligible: false },
];

export const RECEIPT: POSReceipt = {
  id: "receipt-1",
  orderId: PAID_ORDER.id,
  status: "PRINTED",
  reprintCount: 0,
  createdAt: new Date(2026, 9, 12, 14, 32).toISOString(),
  document: {
    orderId: PAID_ORDER.id,
    orderNumber: PAID_ORDER.orderNumber,
    businessDate: "2026-10-12",
    propertyName: "Jacaranda Lodge",
    outletId: "o",
    outletName: "Main Restaurant",
    terminalId: "t",
    initiatedById: "staff-amina",
    initiatedByName: "Amina Hassan",
    operatorId: "staff-grace",
    operatorName: "Grace Mushi",
    serviceType: PAID_ORDER.serviceType,
    tableLabel: PAID_ORDER.tableLabel,
    items: PAID_ORDER.items.map(({ name, quantity, unitPriceMinor, taxMinor, totalMinor, modifiers }) => ({
      name,
      quantity,
      unitPriceMinor,
      taxMinor,
      totalMinor,
      ...(modifiers ? { modifiers } : {}),
    })),
    subtotalMinor: PAID_ORDER.subtotalMinor,
    taxMinor: PAID_ORDER.taxMinor,
    totalMinor: PAID_ORDER.totalMinor,
    currency: CURRENCY,
    tenderMethod: "CASH",
    settledAt: new Date(2026, 9, 12, 14, 32).toISOString(),
  },
};
