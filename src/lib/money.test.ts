import { describe, expect, it } from "vitest";
import {
  CASH_DENOMINATIONS,
  CURRENCY_SYMBOLS,
  SMALLEST_NOTE,
  cashNotes,
  currencySymbol,
  formatMoney,
  majorDigits,
  quickCashAmounts,
} from "./money";

describe("formatMoney", () => {
  it("writes Tanzanian shillings the way people say them", () => {
    expect(formatMoney(4_250_000, "TZS")).toBe("TSh 42,500");
    expect(formatMoney(100, "TZS")).toBe("TSh 1");
    expect(formatMoney(0, "TZS")).toBe("TSh 0");
    expect(formatMoney(123_456_700, "TZS")).toBe("TSh 1,234,567");
  });

  it("shows cents only when there are some", () => {
    expect(formatMoney(4_250_050, "TZS")).toBe("TSh 42,500.50");
    expect(formatMoney(4_250_005, "TZS")).toBe("TSh 42,500.05");
  });

  it("uses the currency the backend returned, never a built-in one", () => {
    expect(formatMoney(4_250_000, "KES")).not.toContain("TSh");
    expect(formatMoney(4_250_000, "KES")).toContain("42,500");
    expect(formatMoney(4_250_000, "usd")).toContain("42,500");
    expect(formatMoney(4_250_000, "USD")).not.toContain("TSh");
  });

  it("shows a dash rather than a guess", () => {
    expect(formatMoney(4_250_000, undefined)).toBe("—");
    expect(formatMoney(4_250_000, "")).toBe("—");
    expect(formatMoney(null, "TZS")).toBe("—");
    expect(formatMoney(undefined, "TZS")).toBe("—");
    expect(formatMoney(Number.NaN, "TZS")).toBe("—");
    expect(formatMoney(Number.POSITIVE_INFINITY, "TZS")).toBe("—");
  });

  it("writes amounts given back with a minus sign in front", () => {
    expect(formatMoney(-200_000, "TZS")).toBe("−TSh 2,000");
  });

  it("never shows minor units or the currency code for shillings", () => {
    const text = formatMoney(4_250_000, "TZS");
    expect(text).not.toContain("4250000");
    expect(text).not.toContain("TZS");
  });

  it("keeps how a currency is written in a named setting", () => {
    expect(CURRENCY_SYMBOLS.TZS).toBe("TSh");
    expect(currencySymbol("tzs")).toBe("TSh");
    expect(currencySymbol("KES")).not.toBe("");
  });
});

describe("majorDigits", () => {
  it("gives the amount without the currency, for figures set beside their own label", () => {
    expect(majorDigits(4_250_000)).toBe("42,500");
    expect(majorDigits(4_250_050)).toBe("42,500.50");
    expect(majorDigits(null)).toBe("—");
  });
});

describe("quickCashAmounts", () => {
  it("offers the next amount each note makes above the bill, smallest first", () => {
    expect(quickCashAmounts(4_250_000, "TZS")).toEqual([4_500_000, 5_000_000, 6_000_000]);
    expect(quickCashAmounts(350_000, "TZS")).toEqual([400_000, 500_000, 1_000_000]);
    expect(quickCashAmounts(150_000, "TZS")).toEqual([200_000, 500_000, 1_000_000]);
  });

  it("uses every configured note, not only the largest", () => {
    expect(quickCashAmounts(350_000, "TZS", [5000, 10000])).toEqual([500_000, 1_000_000, 2_000_000]);
    expect(quickCashAmounts(350_000, "TZS", [1000, 10000])).toEqual([400_000, 1_000_000, 2_000_000]);
  });

  it("never offers more of one note than a guest counts out", () => {
    // 38 × 1,000 is not how anyone pays TSh 37,500.
    expect(quickCashAmounts(3_750_000, "TZS")).not.toContain(3_800_000);
  });

  it("skips amounts equal to the bill (that is Exact) and duplicates", () => {
    expect(quickCashAmounts(900_000, "TZS")).toEqual([1_000_000, 2_000_000, 5_000_000]);
    expect(quickCashAmounts(1_000_000, "TZS")).toEqual([2_000_000, 5_000_000, 10_000_000]);
  });

  it("offers nothing extra for a currency with no notes set", () => {
    expect(quickCashAmounts(4_250_000, "KES")).toEqual([]);
    expect(quickCashAmounts(4_250_000, undefined)).toEqual([]);
  });

  it("offers nothing when nothing is due", () => {
    expect(quickCashAmounts(0, "TZS")).toEqual([]);
    expect(quickCashAmounts(-5, "TZS")).toEqual([]);
  });

  it("takes its notes from the cash denominations setting: coins below the smallest note are left out", () => {
    expect(cashNotes("TZS")).toEqual([10_000, 5_000, 2_000, 1_000]);
    expect(SMALLEST_NOTE.TZS).toBe(1_000);
    expect(cashNotes("KES")).toEqual([]);
  });
});

describe("cash denominations", () => {
  it("lists the notes and coins a till counts, per currency, as a named setting", () => {
    expect(CASH_DENOMINATIONS.TZS).toEqual([10_000, 5_000, 2_000, 1_000, 500, 200, 100, 50]);
    expect(CASH_DENOMINATIONS.KES).toBeUndefined();
  });
});

it("offers the owner’s next sensible TZS amounts", () => {
 expect(quickCashAmounts(3_750_000,"TZS")).toEqual([4_000_000,5_000_000,10_000_000]);
});
