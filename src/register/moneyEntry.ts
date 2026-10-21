import { moneyFieldText } from "../cash/NoteCounterSheet";

// Where an amount is known, the till fills it in (owner, 2026-10-21) and the
// first key the cashier types replaces it.

/** An amount as a money field shows it, or empty when nothing is owed. */
export function dueText(minor: number): string {
  return minor > 0 ? moneyFieldText(minor) : "";
}

/**
 * What a money field holds after a keystroke. While it still shows the amount
 * filled in, what was typed replaces it, wherever the cursor was: typed at
 * the end the new digits follow the old ones, and only they are kept.
 */
export function typedOver(before: string, after: string, filled: boolean): string {
  if (!filled) return after;
  return after.length > before.length && after.startsWith(before) ? after.slice(before.length) : after;
}

/** A keypad key on a money field: the first one replaces the amount filled in. */
export function keyedOver(text: string, key: string, filled: boolean): string {
  const from = filled ? "" : text;
  if (key === "delete") return from.slice(0, -1);
  if (key === "clear") return "";
  // No leading zeros: "0" or "00" on an empty amount adds nothing.
  return from === "" && /^0+$/.test(key) ? from : from + key;
}
