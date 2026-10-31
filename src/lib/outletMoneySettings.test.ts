import { beforeEach, describe, expect, it } from "vitest";
import { cacheOutletMoney, cachedOutletMoney, moneySettingsFrom } from "./outletMoneySettings";

beforeEach(() => localStorage.clear());
it("keeps preferences isolated by property and outlet and survives reopening", () => {
  cacheOutletMoney("property-a", "outlet-a", { standardFloat: 5_000_000, quickCashNotes: [2000, 10000] });
  expect(cachedOutletMoney("property-a", "outlet-a")).toEqual({ standardFloat: 5_000_000, quickCashNotes: [2000, 10000], paymentChannels: [] });
  expect(cachedOutletMoney("property-b", "outlet-a").standardFloat).toBe(0);
  expect(cachedOutletMoney("property-a", "outlet-b").standardFloat).toBe(0);
});
it("defaults corrupted or invalid preferences without changing financial authority", () => {
  expect(moneySettingsFrom({ standardFloat: -1, quickCashNotes: [0] })).toEqual({ standardFloat: 0, quickCashNotes: [1000,2000,5000,10000], paymentChannels: [] });
  localStorage.setItem("yetu-outlet-money:p:o", "broken");
  expect(cachedOutletMoney("p", "o").standardFloat).toBe(0);
});

describe("the ways of paying a till keeps", () => {
  it("keeps what Yetu sent, in its order, and leaves out what isn't one", () => {
    const { paymentChannels } = moneySettingsFrom({
      paymentChannels: [
        { id: "mpesa", name: " M-Pesa ", paymentMethod: "MOBILE_MONEY", payTo: " 123 " },
        { id: "cash", name: "Pocket", paymentMethod: "CASH" },
        { id: "", name: "No id", paymentMethod: "OTHER" },
        { id: "blank", name: "  ", paymentMethod: "OTHER" },
        null,
        { id: "bank", name: "Bank", paymentMethod: "BANK_TRANSFER" },
      ],
    });
    expect(paymentChannels).toEqual([
      { id: "mpesa", name: "M-Pesa", paymentMethod: "MOBILE_MONEY", payTo: "123" },
      { id: "bank", name: "Bank", paymentMethod: "BANK_TRANSFER" },
    ]);
  });

  it("an older Yetu, which sends none, leaves the plain methods", () => {
    expect(moneySettingsFrom({ standardFloat: 100 }).paymentChannels).toEqual([]);
    expect(moneySettingsFrom(null).paymentChannels).toEqual([]);
  });
});
