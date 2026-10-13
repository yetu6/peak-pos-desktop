import { describe, expect, it } from "vitest";
import type { POSCatalogProduct, POSOrderItem } from "../lib/posContracts";
import { optionIdsFor } from "./repeatLine";

function product(groups: NonNullable<POSCatalogProduct["modifierGroups"]>): POSCatalogProduct {
  return { id: "p", code: "P", name: "Burger", priceMinor: 100, currency: "TZS", taxRateBp: 0, isAvailable: true, modifierGroups: groups };
}

function line(modifiers: Array<[string, string]>): POSOrderItem {
  return {
    id: "l",
    productId: "p",
    name: "Burger",
    quantity: 1,
    unitPriceMinor: 100,
    taxMinor: 0,
    totalMinor: 100,
    status: "ADDED",
    modifiers: modifiers.map(([groupName, optionName], index) => ({ id: `m${index}`, groupName, optionName, priceDeltaMinor: 0 })),
  };
}

const option = (id: string, groupId: string, name: string, isAvailable = true) => ({ id, groupId, name, priceDeltaMinor: 0, isAvailable });

describe("optionIdsFor", () => {
  it("finds each option of the line in the catalog by group and option name", () => {
    const burger = product([
      { id: "g1", productId: "p", name: "Cooked", minSelect: 1, maxSelect: 1, isActive: true, options: [option("o1", "g1", "Medium")] },
      { id: "g2", productId: "p", name: "Extras", minSelect: 0, maxSelect: 2, isActive: true, options: [option("o2", "g2", "Cheese")] },
    ]);
    expect(optionIdsFor(line([["Cooked", "Medium"], ["Extras", "Cheese"]]), burger)).toEqual(["o1", "o2"]);
    expect(optionIdsFor(line([]), burger)).toEqual([]);
  });

  it("asks again when two active groups share the name", () => {
    const burger = product([
      { id: "g1", productId: "p", name: "Extras", minSelect: 0, maxSelect: 1, isActive: true, options: [option("o1", "g1", "Cheese")] },
      { id: "g2", productId: "p", name: "Extras", minSelect: 0, maxSelect: 1, isActive: true, options: [option("o2", "g2", "Cheese")] },
    ]);
    expect(optionIdsFor(line([["Extras", "Cheese"]]), burger)).toBeNull();
  });

  it("asks again when two options in the group share the name", () => {
    const burger = product([
      {
        id: "g1",
        productId: "p",
        name: "Extras",
        minSelect: 0,
        maxSelect: 2,
        isActive: true,
        options: [option("o1", "g1", "Cheese"), option("o2", "g1", "Cheese")],
      },
    ]);
    expect(optionIdsFor(line([["Extras", "Cheese"]]), burger)).toBeNull();
  });

  it("asks again when an option is no longer on the menu", () => {
    const burger = product([
      { id: "g1", productId: "p", name: "Extras", minSelect: 0, maxSelect: 1, isActive: true, options: [option("o1", "g1", "Cheese", false)] },
    ]);
    expect(optionIdsFor(line([["Extras", "Cheese"]]), burger)).toBeNull();
  });
});
