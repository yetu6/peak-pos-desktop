/**
 * Display defaults: named settings for how a till looks before anyone on it
 * has chosen. A person's own choice (the theme switch in the top bar, stored
 * per device) always wins over these.
 */

export type Theme = "light" | "dark";

/**
 * The theme a till starts in when nobody on this device has chosen one, by the
 * mode a manager picked at pairing. Selling tills start Light (bright dining
 * rooms and receptions read dark text on light best); kitchen and bar displays
 * start Dark (read from across a hot, bright kitchen or a dim bar).
 */
export const DEFAULT_THEME_BY_MODE: Readonly<Record<string, Theme>> = {
  POS: "light",
  CASHIER: "light",
  KITCHEN_DISPLAY: "dark",
  BAR_DISPLAY: "dark",
};

/** Before the till is paired (or while its mode is still loading) it starts Light. */
export const DEFAULT_THEME_BEFORE_PAIRING: Theme = "light";

/** Pairing records write the mode as `KITCHEN_DISPLAY` or `kitchen-display`; read both. */
export function normalizeMode(mode?: string | null): string {
  return (mode ?? "").trim().toUpperCase().replace(/-/g, "_");
}

export function defaultThemeForMode(mode?: string | null): Theme {
  return DEFAULT_THEME_BY_MODE[normalizeMode(mode)] ?? DEFAULT_THEME_BEFORE_PAIRING;
}
