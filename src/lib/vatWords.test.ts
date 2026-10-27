import { describe, expect, it } from "vitest";
import { lineAmountMinor, vatFigures } from "./vatWords";

// Bahari QA Hotel writes its prices with VAT inside them (18%).
describe("vatFigures (F-229)", () => {
  it("a TSh 22,000 biryani with VAT inside reads TSh 22,000, VAT included", () => {
    const figures = vatFigures({
      pricesIncludeTax: true,
      subtotalMinor: 1_864_407,
      taxMinor: 335_593,
      totalMinor: 2_200_000,
      items: [{ totalMinor: 2_200_000, status: "SENT" }],
    });
    expect(figures).toEqual({ itemsLabel: "Items", itemsMinor: 2_200_000, discountMinor: 0, vatLabel: "VAT included", taxMinor: 335_593, totalMinor: 2_200_000 });
  });

  it("TSh 2,000 off TSh 15,000 with VAT inside is TSh 2,000 off, not Yetu's net 1,694.91; a line taken off counts for nothing", () => {
    const figures = vatFigures({
      pricesIncludeTax: true,
      subtotalMinor: 1_271_186,
      discountMinor: 169_491,
      taxMinor: 198_305,
      totalMinor: 1_300_000,
      items: [
        { totalMinor: 1_500_000, status: "ADDED" },
        { totalMinor: 400_000, status: "VOIDED" },
      ],
    });
    expect(figures.itemsMinor).toBe(1_500_000);
    expect(figures.discountMinor).toBe(200_000);
    expect(figures.totalMinor).toBe(1_300_000);
  });

  it("VAT on top, or a Yetu before F-229, reads as before", () => {
    const order = { subtotalMinor: 1_000_000, discountMinor: 100_000, taxMinor: 162_000, totalMinor: 1_062_000, items: [{ totalMinor: 1_180_000 }] };
    expect(vatFigures(order)).toEqual({ itemsLabel: "Subtotal", itemsMinor: 1_000_000, discountMinor: 100_000, vatLabel: "VAT", taxMinor: 162_000, totalMinor: 1_062_000 });
    expect(vatFigures({ ...order, pricesIncludeTax: false }).vatLabel).toBe("VAT");
  });
});

describe("lineAmountMinor: a line reads so the lines add up to the figure under them", () => {
  const chips = { totalMinor: 590_000, taxMinor: 90_000 };
  it("with VAT on top the line leaves its VAT out, as the Subtotal does", () => {
    expect(lineAmountMinor(false, chips)).toBe(500_000);
    expect(lineAmountMinor(undefined, chips)).toBe(500_000);
  });
  it("with VAT inside the prices the line is its menu price", () => {
    expect(lineAmountMinor(true, chips)).toBe(590_000);
  });
});
