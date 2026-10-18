import { describe, expect, it } from "vitest";
import { orderName, orderNumberWords, orderReference } from "./orderNumber";

/** An order as Yetu sends it since S5b: its short number for the day, and its reference. */
const TODAY = { dailyNumber: 42, orderNumber: "POS-MR-261012-42" };

describe("what staff call an order", () => {
  it("is its number for the day: 'Order 42'", () => {
    expect(orderNumberWords(TODAY)).toBe("42");
    expect(orderName(TODAY)).toBe("Order 42");
  });

  it("keeps the reference to show small, beside the number", () => {
    expect(orderReference(TODAY)).toBe("POS-MR-261012-42");
  });

  it("is the reference itself where Yetu gave no number yet, and then there is no second reference", () => {
    // A sale taken offline before it synced; a receipt made before S5b.
    const offline = { orderNumber: "OFF-T1-0007" };
    expect(orderName(offline)).toBe("Order OFF-T1-0007");
    expect(orderNumberWords(offline)).toBe("OFF-T1-0007");
    expect(orderReference(offline)).toBeNull();
    expect(orderName({ dailyNumber: null, orderNumber: "POS-a3f90c14" })).toBe("Order POS-a3f90c14");
  });

  it("never shows a number that isn't one", () => {
    expect(orderName({ dailyNumber: 0, orderNumber: "POS-x" })).toBe("Order POS-x");
    expect(orderName({ dailyNumber: Number.NaN, orderNumber: "POS-x" })).toBe("Order POS-x");
  });
});
