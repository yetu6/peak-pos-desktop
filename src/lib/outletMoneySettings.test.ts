import { beforeEach, expect, it } from "vitest";
import { cacheOutletMoney, cachedOutletMoney, moneySettingsFrom } from "./outletMoneySettings";

beforeEach(() => localStorage.clear());
it("keeps preferences isolated by property and outlet and survives reopening", () => {
  cacheOutletMoney("property-a", "outlet-a", { standardFloat: 5_000_000, quickCashNotes: [2000, 10000] });
  expect(cachedOutletMoney("property-a", "outlet-a")).toEqual({ standardFloat: 5_000_000, quickCashNotes: [2000, 10000] });
  expect(cachedOutletMoney("property-b", "outlet-a").standardFloat).toBe(0);
  expect(cachedOutletMoney("property-a", "outlet-b").standardFloat).toBe(0);
});
it("defaults corrupted or invalid preferences without changing financial authority", () => {
  expect(moneySettingsFrom({ standardFloat: -1, quickCashNotes: [0] })).toEqual({ standardFloat: 0, quickCashNotes: [1000,2000,5000,10000] });
  localStorage.setItem("yetu-outlet-money:p:o", "broken");
  expect(cachedOutletMoney("p", "o").standardFloat).toBe(0);
});
