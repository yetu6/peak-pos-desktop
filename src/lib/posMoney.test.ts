import { describe, expect, it } from "vitest";
import { formatMinor, moneyFormatter, remainingMinorOf, toMinor } from "./posMoney";

describe("remainingMinorOf", () => {
  it("trusts the server's remaining balance when it is present", () => {
    expect(remainingMinorOf({ totalMinor: 24_000, paidMinor: 10_000, remainingMinor: 14_000 })).toBe(14_000);
  });
  it("derives the balance from total and paid when remaining is absent", () => {
    expect(remainingMinorOf({ totalMinor: 24_000, paidMinor: 10_000 })).toBe(14_000);
    expect(remainingMinorOf({ totalMinor: 24_000 })).toBe(24_000);
    expect(remainingMinorOf({ totalMinor: 24_000, paidMinor: null })).toBe(24_000);
  });
  it("never shows a negative debt", () => {
    expect(remainingMinorOf({ totalMinor: 24_000, paidMinor: 30_000 })).toBe(0);
    expect(remainingMinorOf({ totalMinor: 24_000, paidMinor: 0, remainingMinor: -1 })).toBe(0);
  });
  it("a settled order owes nothing", () => {
    expect(remainingMinorOf({ totalMinor: 24_000, paidMinor: 24_000, remainingMinor: 0 })).toBe(0);
  });
});

describe("toMinor", () => {
  it("turns a keypad entry in major units into integer minor units", () => {
    expect(toMinor("1500")).toBe(150_000);
    expect(toMinor("1500.50")).toBe(150_050);
    expect(toMinor(" 12.345 ")).toBe(1_235);
    expect(toMinor(0)).toBe(0);
  });
  it("refuses what is not an amount", () => {
    expect(toMinor("")).toBeNull();
    expect(toMinor("abc")).toBeNull();
    expect(toMinor("-1")).toBeNull();
    expect(toMinor("1e400")).toBeNull();
  });
});

describe("formatMinor", () => {
  it("shows a dash rather than a guess for a missing amount", () => {
    expect(formatMinor(null, "TZS")).toBe("—");
    expect(formatMinor(undefined, "TZS")).toBe("—");
    expect(formatMinor(Number.NaN, "TZS")).toBe("—");
  });
  it("formats minor units as major in the given currency", () => {
    const text = formatMinor(150_050, "TZS");
    expect(text).toMatch(/1[,\s.]?500/);
    expect(text).not.toBe("—");
  });
  it("moneyFormatter never assumes a currency", () => {
    expect(moneyFormatter(undefined)(1_000)).toBe("—");
    expect(moneyFormatter("KES")(1_000)).not.toBe("—");
  });
});
