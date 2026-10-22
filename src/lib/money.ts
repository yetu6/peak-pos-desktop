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
 * Named setting: the notes and coins a till counts note by note, per
 * currency, in major units, largest first. A currency not listed is counted
 * as one total.
 */
export const CASH_DENOMINATIONS: Readonly<Record<string, readonly number[]>> = {
  TZS: [10_000, 5_000, 2_000, 1_000, 500, 200, 100, 50],
};

/**
 * Named setting: the smallest note per currency, in major units. The cash
 * denominations below it are coins; quick cash uses only the notes.
 */
export const SMALLEST_NOTE: Readonly<Record<string, number>> = {
  TZS: 1_000,
};

/** The notes a guest hands over, largest first, from CASH_DENOMINATIONS. */
export function cashNotes(currency: string | null | undefined): number[] {
  const code = currency?.trim().toUpperCase();
  if (!code) return [];
  const smallest = SMALLEST_NOTE[code];
  if (smallest === undefined) return [];
  return [...(CASH_DENOMINATIONS[code] ?? [])].filter((value) => value >= smallest).sort((a, b) => b - a);
}

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
 * units, smallest first: for each of the largest notes, the next amount it
 * makes above the bill (TSh 42,500 with notes of 10,000, 5,000 and 2,000
 * gives 50,000, 45,000 and 44,000). Exact is offered separately; a currency
 * with no notes set gets none.
 */
/** Named setting: quickCashNotes, in major units. Outlet values override this list. */
export const QUICK_CASH_NOTES: Readonly<Record<string, readonly number[]>> = {
  TZS: [1000, 2000, 5000, 10000],
};

export function quickCashAmounts(dueMinor: number, currency: string | null | undefined, configured?: readonly number[]): number[] {
  if (!Number.isSafeInteger(dueMinor) || dueMinor <= 0) return [];
  const notes = configured ?? QUICK_CASH_NOTES[currency?.trim().toUpperCase() ?? ""] ?? [];
  if (notes.length === 0 || notes.some((n) => !Number.isSafeInteger(n) || n <= 0 || n > 1_000_000)) return [];
  const note = Math.max(...notes) * MINOR_PER_MAJOR;
  const candidates = new Set<number>([(Math.floor(dueMinor / note) + 1) * note]);
  // The next whole largest note, then round bundles of 1, 2, 5 notes,
  // 10, 20, 50 notes, and so on. Never suggest a figure equal to Exact.
  for (let scale = 1; scale * note <= Number.MAX_SAFE_INTEGER; scale *= 10) {
    for (const multiplier of [1, 2, 5]) {
      const amount = multiplier * scale * note;
      if (Number.isSafeInteger(amount) && amount > dueMinor) candidates.add(amount);
    }
    if (candidates.size >= QUICK_CASH_MAX) break;
  }
  return [...candidates].filter((n) => Number.isSafeInteger(n) && n > dueMinor).sort((a, b) => a - b).slice(0, QUICK_CASH_MAX);
}
