import { useSyncExternalStore } from "react";
import type { POSShift } from "../lib/posContracts";

/**
 * The shift this till just closed, as Yetu returned it. Closing a shift takes
 * the till straight to Open shift (the register is gone with the shift), so
 * the Done summary is shown there, from this. Cleared when a shift opens.
 */
export interface ClosedShift {
  shift: POSShift;
  currency: string | undefined;
  at: Date;
}

let last: ClosedShift | null = null;
/**
 * A person is closing the shift on this till: set before Yetu is asked, so
 * nothing in between (Yetu's own closed event, the shift read again) can look
 * like Yetu closing it and open a new one under the summary. Ends with the
 * result remembered, a refusal, or the summary put away.
 */
let closing = false;
const listeners = new Set<() => void>();

function tell(): void {
  for (const listener of listeners) listener();
}

export function beginClosingHere(): void {
  closing = true;
  tell();
}

export function endClosingHere(): void {
  if (!closing) return;
  closing = false;
  tell();
}

/** True while this till is closing the shift, and while its result is on screen. */
export function closedHereNow(): boolean {
  return closing || last !== null;
}

export function useClosedHere(): boolean {
  return useSyncExternalStore(subscribe, closedHereNow, closedHereNow);
}

export function rememberClosedShift(closed: ClosedShift): void {
  last = closed;
  closing = false;
  tell();
}

/**
 * Puts the last result away. A close under way is not touched: it ends when it
 * settles (remembered, refused or not closed), never because a shift read
 * again happened to change meanwhile.
 */
export function forgetClosedShift(): void {
  last = null;
  tell();
}

export function lastClosedShift(): ClosedShift | null {
  return last;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLastClosedShift(): ClosedShift | null {
  return useSyncExternalStore(subscribe, lastClosedShift, lastClosedShift);
}
