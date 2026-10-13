/**
 * Plain words for the offline register: the local store's refusals (the
 * Rust store's LocalStoreErrorKind, as Tauri rejects them,
 * SCREAMING_SNAKE_CASE) and the offline sale's own messages. Words, not
 * codes: no kind name ever reaches the screen.
 */

/** What the person was doing when the till's own store refused. */
export type OfflineStep = "add" | "change" | "sale";

const NOT_SAVED: Record<OfflineStep, string> = {
  add: "The item wasn't added.",
  change: "The ticket wasn't changed.",
  sale: "The sale wasn't saved.",
};

const RECONNECT = "Reconnect to Yetu to carry on.";
const SUPPORT = "Call support before taking more sales.";

/** Each refusal of the local store: what it means, then what to do. */
const STORE_WORDS: Record<string, { sentence: string; next: string }> = {
  STALE_DRAFT: { sentence: "This sale changed on this till.", next: "Check the ticket, then try again." },
  LIMIT_EXCEEDED: { sentence: "This till has reached its limit for working offline.", next: RECONNECT },
  AUTHORIZATION_REQUIRED: { sentence: "This till's permission to work offline has run out.", next: RECONNECT },
  INVALID_AUTHORIZATION: { sentence: "This till's permission to work offline has run out.", next: RECONNECT },
  AUTHORIZATION_ROLLBACK: { sentence: "Working offline is locked because the till's clock changed.", next: RECONNECT },
  CATALOG_REQUIRED: { sentence: "This till has no menu saved for working offline.", next: RECONNECT },
  INVALID_CATALOG: { sentence: "The menu saved on this till can't be used.", next: RECONNECT },
  OPERATION_NOT_ALLOWED: { sentence: "That can't be done while working offline.", next: RECONNECT },
  INVALID_ORDER: { sentence: "Something on the ticket isn't right.", next: "Check the ticket, then try again." },
  DISK_FULL: { sentence: "This till's storage is full.", next: SUPPORT },
  MISSING_KEY: { sentence: "This till can't store sales safely just now.", next: SUPPORT },
  SECURE_STORE_UNAVAILABLE: { sentence: "This till can't store sales safely just now.", next: SUPPORT },
  INVALID_KEY_ENVELOPE: { sentence: "This till can't store sales safely just now.", next: SUPPORT },
  KEY_MISMATCH: { sentence: "This till can't store sales safely just now.", next: SUPPORT },
  CORRUPTION: { sentence: "This till's saved sales need checking.", next: SUPPORT },
  MIGRATION_FAILURE: { sentence: "This till's saved sales need checking.", next: SUPPORT },
  INTEGRITY_FAILURE: { sentence: "This till's saved sales need checking.", next: SUPPORT },
  SIGNING_FAILURE: { sentence: "This till couldn't sign the sale.", next: SUPPORT },
};

/** The local store's kind inside whatever Tauri (or the hook) rejected with. */
function kindOf(error: unknown): string | null {
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : null;
  if (!text) return null;
  const match = /^[A-Z][A-Z_]+$/.exec(text.trim());
  return match ? match[0] : null;
}

/** A refusal of the local store, in words: what it means, that nothing was done, and what to do. */
export function offlineProblemWords(error: unknown, step: OfflineStep): string {
  const kind = kindOf(error);
  const words = kind ? STORE_WORDS[kind] : undefined;
  if (!words) return `Something went wrong on this till. ${NOT_SAVED[step]} Try again.`;
  return `${words.sentence} ${NOT_SAVED[step]} ${words.next}`;
}

/** The fixed banner while the till works offline. */
export const OFFLINE_BANNER = "Working offline. Cash only. Sales are saved on this till and sent when the connection returns.";

/** The menu the till saved for working offline isn't there (or can't be read). */
export const OFFLINE_MENU_MISSING = {
  title: "No menu saved for working offline",
  description: "Connect to Yetu once so this till can save the menu, then try again.",
} as const;
