import { describe, expect, it } from "vitest";
import { EXPECTED_CASH_VISIBLE_TO, expectedCashVisible } from "./cashSettings";

describe("EXPECTED_CASH_VISIBLE_TO", () => {
  it("keeps the count blind for everyone but managers by default", () => {
    expect(EXPECTED_CASH_VISIBLE_TO).toBe("managers");
    expect(expectedCashVisible(false)).toBe(false);
    expect(expectedCashVisible(true)).toBe(true);
  });

  it("can show the figure to everyone when a business chooses to", () => {
    expect(expectedCashVisible(false, "everyone")).toBe(true);
    expect(expectedCashVisible(false, "managers")).toBe(false);
  });
});
