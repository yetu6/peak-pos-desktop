import { useSyncExternalStore } from "react";

/**
 * What the updater last did, kept for the Status screen. A failed or
 * unavailable update check is not a till fault: it is noted here quietly,
 * never shown as a banner.
 */
export interface UpdateNote {
  kind: "check-failed" | "download-failed" | "ready" | "install-failed";
  /** The updater's own message, for a technician. */
  detail?: string;
  at: Date;
}

let last: UpdateNote | null = null;
const listeners = new Set<() => void>();

export function noteUpdate(note: UpdateNote): void {
  if (last && last.kind === note.kind && last.detail === note.detail) return;
  last = note;
  for (const listener of listeners) listener();
}

export function lastUpdateNote(): UpdateNote | null {
  return last;
}

export function resetUpdateNotes(): void {
  last = null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLastUpdateNote(): UpdateNote | null {
  return useSyncExternalStore(subscribe, lastUpdateNote, lastUpdateNote);
}
