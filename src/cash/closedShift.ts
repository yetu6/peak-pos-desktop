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
const listeners = new Set<() => void>();

export function rememberClosedShift(closed: ClosedShift): void {
  last = closed;
  for (const listener of listeners) listener();
}

export function forgetClosedShift(): void {
  last = null;
  for (const listener of listeners) listener();
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
