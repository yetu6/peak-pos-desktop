/**
 * F-229: a property that writes its prices with VAT inside them shows the
 * guest those prices. Its order reads Items (the menu prices added up), what
 * came off them, the VAT included, and the total. An order with VAT on top
 * reads Subtotal, Discount, VAT and the total, as before. Yetu keeps an
 * order's subtotal and discount net of VAT either way, so the guest's figures
 * come from its lines and its total.
 */
export interface VatFigures {
  itemsLabel: "Items" | "Subtotal";
  itemsMinor: number;
  /** What came off, as the guest reads it: off the menu prices when VAT is inside them. */
  discountMinor: number;
  vatLabel: "VAT included" | "VAT";
  taxMinor: number;
  totalMinor: number;
}

export interface PricedOrder {
  /** Absent from a Yetu before F-229: VAT on top. */
  pricesIncludeTax?: boolean;
  subtotalMinor: number;
  discountMinor?: number;
  taxMinor: number;
  totalMinor: number;
  items: ReadonlyArray<{ totalMinor: number; status?: string }>;
}

export function vatFigures(order: PricedOrder): VatFigures {
  if (!order.pricesIncludeTax) {
    return {
      itemsLabel: "Subtotal",
      itemsMinor: order.subtotalMinor,
      discountMinor: order.discountMinor ?? 0,
      vatLabel: "VAT",
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
    };
  }
  const items = order.items.filter((line) => line.status !== "VOIDED").reduce((sum, line) => sum + line.totalMinor, 0);
  return {
    itemsLabel: "Items",
    itemsMinor: items,
    discountMinor: Math.max(0, items - order.totalMinor),
    vatLabel: "VAT included",
    taxMinor: order.taxMinor,
    totalMinor: order.totalMinor,
  };
}
