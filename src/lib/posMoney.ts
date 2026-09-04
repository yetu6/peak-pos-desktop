/**
 * Money is authoritative in minor units (integer) exactly as Peak sends it.
 * These helpers only ever format for display or convert a keyboard entry
 * (major units, e.g. "1500.00") into the minor-unit integer Peak expects.
 * Nothing here is used to compute an authoritative total — the server does
 * that; the till never sums prices client-side to decide what is owed.
 */

/** Minor units -> a locale-formatted display string. Never used as a request
 *  body value. `currency` is required and deliberately has no default: Peak
 *  properties are not all TZS, and a silent fallback here previously masked
 *  several call sites that never derived a real currency at all. A caller
 *  with no currency yet should show "—" via `moneyFormatter`, not guess. */
export function formatMinor(amountMinor: number | undefined | null, currency: string): string {
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

/**
 * Binds a display-safe formatter to a currency that may not be known yet
 * (e.g. the outlet's catalog hasn't loaded). Never assumes a default
 * currency — shows "—" in that window instead of guessing wrong.
 */
export function moneyFormatter(currency: string | undefined): (amountMinor: number | undefined | null) => string {
  return (amountMinor) => (currency ? formatMinor(amountMinor, currency) : "—");
}

/** A keyboard/keypad entry (major units, e.g. "1500" or "1500.50") -> minor-unit integer. */
export function toMinor(input: string | number): number | null {
  const text = typeof input === "number" ? String(input) : input.trim();
  if (text === "") return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}
