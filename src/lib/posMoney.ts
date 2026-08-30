/**
 * Money is authoritative in minor units (integer) exactly as Peak sends it.
 * These helpers only ever format for display or convert a keyboard entry
 * (major units, e.g. "1500.00") into the minor-unit integer Peak expects.
 * Nothing here is used to compute an authoritative total — the server does
 * that; the till never sums prices client-side to decide what is owed.
 */

/** Minor units -> a locale-formatted display string. Never used as a request body value. */
export function formatMinor(amountMinor: number | undefined | null, currency = "TZS"): string {
  if (amountMinor == null || !Number.isFinite(amountMinor)) return "—";
  const major = amountMinor / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

/** A keyboard/keypad entry (major units, e.g. "1500" or "1500.50") -> minor-unit integer. */
export function toMinor(input: string | number): number | null {
  const text = typeof input === "number" ? String(input) : input.trim();
  if (text === "") return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}
