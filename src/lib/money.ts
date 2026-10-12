/**
 * The one money formatter for the till's screens: `TSh 42,500`.
 *
 * Amounts arrive in minor units (integer, as Peak sends them) together with
 * the currency the backend returned. Nothing here assumes a currency: no
 * currency means a dash, never a guess. Nothing here computes what is owed
 * either; that is the server's job.
 */

/** Named setting: how a currency is written on screen when it differs from its code. */
export const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  TZS: "TSh",
};

/** Named setting: the locale used to group digits (42,500). */
export const MONEY_LOCALE = "en-GB";

/**
 * Named setting: the note steps quick cash rounds up to, in major units, per
 * currency. TZS notes run 1,000 / 2,000 / 5,000 / 10,000; rounding to 1,000,
 * 5,000 and 10,000 gives the three amounts a guest most often hands over.
 */
export const QUICK_CASH_STEPS: Readonly<Record<string, readonly number[]>> = {
  TZS: [1_000, 5_000, 10_000],
};

/**
 * Named setting: the notes and coins a till counts note by note, per
 * currency, in major units, largest first. A currency not listed is counted
 * as one total.
 */
export const CASH_DENOMINATIONS: Readonly<Record<string, readonly number[]>> = {
  TZS: [10_000, 5_000, 2_000, 1_000, 500, 200, 100, 50],
};

/** Named setting: the most quick-cash amounts shown beside Exact. */
export const QUICK_CASH_MAX = 3;

/** Peak's minor units are hundredths of the major unit for every currency it sends. */
export const MINOR_PER_MAJOR = 100;

function normalizeCode(currency: string | null | undefined): string | null {
  const code = currency?.trim().toUpperCase();
  return code ? code : null;
}

export function currencySymbol(currency: string): string {
  const code = normalizeCode(currency) ?? "";
  const named = CURRENCY_SYMBOLS[code];
  if (named) return named;
  try {
    const part = new Intl.NumberFormat(MONEY_LOCALE, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find((piece) => piece.type === "currency");
    return part?.value ?? code;
  } catch {
    return code;
  }
}

/** The figure alone ("42,500"), for a figure set beside its own currency label. */
export function majorDigits(amountMinor: number | null | undefined): string {
  if (amountMinor == null || !Number.isFinite(amountMinor)) return "—";
  const whole = Math.abs(amountMinor) % MINOR_PER_MAJOR === 0;
  return new Intl.NumberFormat(MONEY_LOCALE, {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(Math.abs(amountMinor) / MINOR_PER_MAJOR);
}

/** `TSh 42,500`; `−TSh 2,000` for money given back; `—` when either part is unknown. */
export function formatMoney(amountMinor: number | null | undefined, currency: string | null | undefined): string {
  const code = normalizeCode(currency);
  if (!code || amountMinor == null || !Number.isFinite(amountMinor)) return "—";
  const text = `${currencySymbol(code)} ${majorDigits(amountMinor)}`;
  return amountMinor < 0 ? `−${text}` : text;
}

/**
 * The amounts above the bill a guest is most likely to hand over, in minor
 * units, smallest first. Exact is offered separately; a currency with no note
 * steps set gets none.
 */
export function quickCashAmounts(dueMinor: number, currency: string | null | undefined): number[] {
  const code = normalizeCode(currency);
  const steps = code ? QUICK_CASH_STEPS[code] : undefined;
  if (!steps || !Number.isFinite(dueMinor) || dueMinor <= 0) return [];
  const amounts = new Set<number>();
  for (const step of steps) {
    const stepMinor = step * MINOR_PER_MAJOR;
    amounts.add((Math.floor(dueMinor / stepMinor) + 1) * stepMinor);
  }
  return [...amounts].sort((a, b) => a - b).slice(0, QUICK_CASH_MAX);
}
