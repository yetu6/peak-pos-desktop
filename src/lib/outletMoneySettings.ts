import { QUICK_CASH_NOTES } from "./money";

export interface OutletMoneySettings { standardFloat: number; quickCashNotes: readonly number[] }
export const DEFAULT_OUTLET_MONEY: OutletMoneySettings = { standardFloat: 0, quickCashNotes: QUICK_CASH_NOTES.TZS };
const key = (property: string, outlet: string) => `yetu-outlet-money:${property}:${outlet}`;

/** Preferences only: this cache grants no authority and never records money. */
export function moneySettingsFrom(raw: unknown): OutletMoneySettings {
  const value = raw && typeof raw === "object" ? raw as Partial<OutletMoneySettings> : {};
  return {
    standardFloat: Number.isSafeInteger(value.standardFloat) && value.standardFloat! >= 0 ? value.standardFloat! : DEFAULT_OUTLET_MONEY.standardFloat,
    quickCashNotes: Array.isArray(value.quickCashNotes) && value.quickCashNotes.length > 0 && value.quickCashNotes.length <= 12 && value.quickCashNotes.every((n) => Number.isSafeInteger(n) && n > 0 && n <= 1_000_000) && new Set(value.quickCashNotes).size === value.quickCashNotes.length ? value.quickCashNotes : DEFAULT_OUTLET_MONEY.quickCashNotes,
  };
}
export function cachedOutletMoney(property: string | null, outlet: string | null): OutletMoneySettings {
  if (!property || !outlet) return DEFAULT_OUTLET_MONEY;
  try { return moneySettingsFrom(JSON.parse(localStorage.getItem(key(property, outlet)) ?? "null")); } catch { return DEFAULT_OUTLET_MONEY; }
}
export function cacheOutletMoney(property: string | null, outlet: string | null, raw: unknown): void {
  if (!property || !outlet) return;
  try { localStorage.setItem(key(property, outlet), JSON.stringify(moneySettingsFrom(raw))); } catch { /* Preferences can still be used online when storage is full. */ }
}
