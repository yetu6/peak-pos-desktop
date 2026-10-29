import { useState } from "react";
import { moneyFieldText } from "../cash/NoteCounterSheet";
import { REGISTER_FILL_AMOUNT_DUE } from "./registerSettings";

// Where an amount is known, the till fills it in (owner, 2026-10-21) and the
// first key the cashier types replaces it.

/** The change line when the cash given is exactly what is owed. */
export const EXACT_WORDS = "Exact: no change to give.";

/** An amount as a money field shows it, or empty when nothing is owed. */
export function dueText(minor: number): string {
  return minor > 0 ? moneyFieldText(minor) : "";
}

/** What the browser says an edit to a field was (InputEvent.inputType and data). */
export type MoneyEdit = { inputType: string; data: string | null };

/**
 * What a money field holds after an edit. While it still shows the amount
 * filled in, only what the cashier typed is kept, wherever the caret was,
 * and a deletion clears it, as the keypad's does. Never a mix of the old
 * amount and the new digits: 42,500 with a 5 typed into it is 5, not 542,500.
 * The browser says what was typed; without that (and for a deletion, which
 * keeps nothing new) the text before and after the edit does.
 */
export function typedOver(before: string, after: string, filled: boolean, edit?: MoneyEdit): string {
  if (!filled) return after;
  if (edit?.inputType.startsWith("insert") && edit.data != null) return edit.data.replace(/[^\d.]/g, "");
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) end++;
  return after.slice(start, after.length - end);
}

/** A keypad key on a money field: the first one replaces the amount filled in. */
export function keyedOver(text: string, key: string, filled: boolean): string {
  const from = filled ? "" : text;
  if (key === "delete") return from.slice(0, -1);
  if (key === "clear") return "";
  // A decimal point once, as "0." on an empty amount; never more than two decimals (money, percent).
  if (key === ".") return from.includes(".") ? from : (from === "" ? "0" : from) + ".";
  if (from.includes(".") && from.split(".")[1].length >= 2) return from;
  // No leading zeros: "0" or "00" on an empty amount adds nothing.
  return from === "" && /^0+$/.test(key) ? from : from + key;
}

/** How a money field starts: what a fixture typed, else the amount due filled in (register.fillAmountDue). */
export function startAmount(minor: number, typed = ""): { text: string; filled: boolean } {
  if (typed) return { text: typed, filled: false };
  const text = REGISTER_FILL_AMOUNT_DUE ? dueText(minor) : "";
  return { text, filled: text !== "" };
}

/**
 * A money field that may start filled in: the amount, whether it is still
 * the one the till filled in, and every way it changes. One place for the
 * rule, so no way of entering money forgets that the first key replaces.
 */
export function useFilledAmount(start: { text: string; filled: boolean }) {
  const [text, setText] = useState(start.text);
  const [filled, setFilled] = useState(start.filled);
  return {
    text,
    filled,
    /** Typed or pasted into the field. */
    typed(next: string, edit?: MoneyEdit) {
      setText(typedOver(text, next, filled, edit));
      setFilled(false);
    },
    /** A keypad key. */
    keyed(key: string) {
      setText(keyedOver(text, key, filled));
      setFilled(false);
    },
    /** A quick amount the cashier picked: theirs, not filled in. */
    picked(next: string) {
      setText(next);
      setFilled(false);
    },
    /** What is owed now, filled in by the till (register.fillAmountDue). */
    fill(minor: number) {
      const next = startAmount(minor);
      setText(next.text);
      setFilled(next.filled);
    },
    clear() {
      setText("");
      setFilled(false);
    },
  };
}

/**
 * A held Enter -- the key that opened the sheet, still down and repeating --
 * never takes the money; a fresh press of Enter does.
 */
export function ignoreHeldEnter(event: { key: string; repeat: boolean; preventDefault: () => void }) {
  if (event.key === "Enter" && event.repeat) event.preventDefault();
}
