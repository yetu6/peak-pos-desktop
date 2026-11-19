import { useSyncExternalStore } from "react";

/**
 * Yetu closed this till's shift by itself and the till is asking for the next
 * one (the outlet opens its shifts by itself). The order screen stays as it
 * is, cart and sheets included; whatever needs a shift waits, in words, until
 * the new shift arrives. Held here, not in a screen, so every screen that
 * needs a shift can read it (like the last closed shift).
 */
let reopening = false;
const listeners = new Set<() => void>();

export function setShiftReopening(now: boolean): void {
  if (reopening === now) return;
  reopening = now;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const read = () => reopening;

export function useShiftReopening(): boolean {
  return useSyncExternalStore(subscribe, read, read);
}
