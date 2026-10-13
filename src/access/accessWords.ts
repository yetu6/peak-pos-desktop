/**
 * Plain words for everything the sign-in code can say. The device session and
 * the device sign-in code (src/auth, src/lib/deviceAuth.ts) keep their own
 * messages; the screens show these words instead. accessWords.test.ts reads
 * those files and fails if a message there has no words here.
 */
import type { OfflineEligibilityStatus } from "../lib/offlineAuthorization";
import { PIN_PAUSE_AFTER_FAILURES } from "./accessSettings";

export type AccessNoticeKind =
  | "pin-rejected"
  | "sign-in-held"
  | "offline-pin-rejected"
  | "offline-pin-locked"
  | "session-ended"
  | "idle-locked"
  | "unreachable"
  | "server-busy"
  | "declined"
  | "expired"
  | "revoked"
  | "not-approved"
  | "offline-not-ready"
  | "something-wrong";

export interface AccessNotice {
  kind: AccessNoticeKind;
  tone: "info" | "warning" | "danger";
  words: string;
}

const RECONNECT = "Reconnect to Yetu to carry on.";

/** Each message the device session or the device sign-in code can set, and what the screen says instead. */
const MESSAGES: Record<string, AccessNotice> = {
  // Signing in
  "That staff number or PIN was not accepted.": {
    kind: "pin-rejected",
    tone: "danger",
    words: "That PIN didn't match. Try again.",
  },
  // Yetu limits sign-in attempts from one address (429 on /pos/sessions); the PIN screen holds
  // the keypad until Yetu's wait is over and names the wait (pinNotice).
  "Too many sign-in attempts. Wait before trying again.": {
    kind: "sign-in-held",
    tone: "danger",
    words: "Too many attempts. Wait a minute and try again.",
  },
  // Without internet the till checks the PIN itself (src-tauri local_store/offline_pin.rs): each
  // wrong try makes the next one wait longer, and at the limit the PIN stays locked on this till
  // until its offline permission runs out, so only reconnecting helps.
  "That staff number or offline PIN was not accepted.": {
    kind: "offline-pin-rejected",
    tone: "danger",
    words: "That PIN didn't match. Without internet, each wrong try makes the next one wait longer.",
  },
  "Offline PIN locked. Reconnect to Peak or wait before retrying.": {
    kind: "offline-pin-locked",
    tone: "danger",
    words: "Too many tries on this till without internet. Reconnect to Yetu to sign in.",
  },
  "Session expired — enter your PIN again": {
    kind: "session-ended",
    tone: "info",
    words: "Your session ended. Enter your PIN to carry on.",
  },
  "Locked after idle": {
    kind: "idle-locked",
    tone: "info",
    words: "The till locked because nobody used it for a while. Enter your PIN to carry on.",
  },
  // Reaching Yetu
  "Can't reach Peak. Check the server address.": {
    kind: "unreachable",
    tone: "danger",
    words: "Can't reach Yetu. Check the internet connection, then try again.",
  },
  "Peak is not responding. Try again in a moment.": {
    kind: "server-busy",
    tone: "danger",
    words: "Yetu isn't answering right now. Try again in a moment.",
  },
  "Something went wrong. Try again.": {
    kind: "something-wrong",
    tone: "danger",
    words: "Something went wrong. Try again.",
  },
  // Connecting the till
  "This pairing was denied. Generate a new code.": {
    kind: "declined",
    tone: "danger",
    words: "A manager declined this till. Ask them why, then get a new code.",
  },
  "This code expired. Generate a new one.": {
    kind: "expired",
    tone: "warning",
    words: "That code ran out. Get a new code to try again.",
  },
  "This register is no longer trusted. Pair it again.": {
    kind: "revoked",
    tone: "danger",
    words: "This till was disconnected from your restaurant. Get a code to connect it again.",
  },
  "Not approved yet. Ask a manager to enter this pairing code.": {
    kind: "not-approved",
    tone: "info",
    words: "Not connected yet. A manager needs to type this code in Yetu.",
  },
  // Working offline (the device session's offline readiness messages)
  "Offline selling is not ready: reconnect to certify this terminal's catalog.": {
    kind: "offline-not-ready",
    tone: "danger",
    words: `Can't reach Yetu, and this till isn't ready to take cash offline yet. ${RECONNECT}`,
  },
  "Offline authorization is not valid. Reconnect to Peak.": {
    kind: "offline-not-ready",
    tone: "danger",
    words: `Can't reach Yetu, and this till's permission to work offline has run out. ${RECONNECT}`,
  },
  "Offline access is locked because this terminal's clock changed.": {
    kind: "offline-not-ready",
    tone: "danger",
    words: `Working offline is locked because the till's clock changed. ${RECONNECT}`,
  },
  "Offline access requires the authorized open shift.": {
    kind: "offline-not-ready",
    tone: "danger",
    words: `Working offline needs the shift that is open on this till. ${RECONNECT}`,
  },
  "This terminal's offline limit has been reached.": {
    kind: "offline-not-ready",
    tone: "danger",
    words: `This till has reached its limit for working offline. ${RECONNECT}`,
  },
  "Offline authority verified. Local selling will resume when its transaction workspace is available.": {
    kind: "offline-not-ready",
    tone: "warning",
    words: "This till can work offline, but couldn't start just now. Try again.",
  },
  "Offline selling is not authorized on this terminal. Reconnect to Peak.": {
    kind: "offline-not-ready",
    tone: "danger",
    words: `Can't reach Yetu, and this till can't take cash offline. ${RECONNECT}`,
  },
};

export const KNOWN_PROVIDER_MESSAGES: readonly string[] = Object.keys(MESSAGES);

const SOMETHING_WRONG: AccessNotice = { kind: "something-wrong", tone: "danger", words: "Something went wrong. Try again." };

/** What a sign-in message means, in words. A message not listed is never shown as it came. */
export function accessNotice(message: string | null | undefined): AccessNotice | null {
  if (!message) return null;
  return MESSAGES[message] ?? SOMETHING_WRONG;
}

/**
 * The PIN screen's notice: a refused PIN reads differently for a person typed
 * in by number. Once online refusals for that person reach the backend's
 * pause rule it says the PIN may be paused: the till counts only its own
 * tries, and the server's count also includes other tills and earlier tries,
 * so a pause is never stated as certain. Offline refusals have their own
 * rules and never count toward it.
 */
export function pinNotice(
  message: string | null | undefined,
  { failures, manual }: { failures: number; manual: boolean },
): AccessNotice | null {
  const notice = accessNotice(message);
  if (notice?.kind === "offline-pin-rejected" && manual) {
    return {
      ...notice,
      words: "That staff number and PIN didn't match. Without internet, each wrong try makes the next one wait longer.",
    };
  }
  if (notice?.kind !== "pin-rejected") return notice;
  if (failures >= PIN_PAUSE_AFTER_FAILURES) {
    return {
      ...notice,
      words: "Too many tries. Your PIN may be paused for a minute — wait, then try again, or ask a manager.",
    };
  }
  return manual ? { ...notice, words: "That staff number and PIN didn't match. Try again." } : notice;
}

/**
 * The server address check's problems, in words. The rules themselves live in
 * peakConfig.validatePeakApiUrl; this only words its answers.
 */
export function addressProblemWords(problem: string): string {
  if (problem === "Enter the Peak server address.") return "Type the server address.";
  if (problem === "That does not look like a server address.") {
    return "That doesn't look like an address. Check it and try again.";
  }
  if (/https/i.test(problem)) return "The address must start with https://";
  return "Check the address and try again.";
}

/** A countdown as minutes and seconds: 0:20, 9:41. */
export function countdownWords(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A pairing code grouped so it can be read out: ABCDE-FGHIJ. */
export function groupPairingCode(code: string): string {
  const plain = code.replace(/[^0-9a-z]/gi, "").toUpperCase();
  if (code.includes("-")) return code.toUpperCase();
  const half = Math.ceil(plain.length / 2);
  return plain.length > 6 ? `${plain.slice(0, half)}-${plain.slice(half)}` : plain;
}

/** What this till's readiness to work offline means for the person signing in. */
export function offlineReadinessWords(state: OfflineEligibilityStatus["state"]): string {
  // ELIGIBLE is the till's own readiness; each person also needs to have signed in here online.
  if (state === "ELIGIBLE") return "If the internet drops, this till can keep taking cash for staff who have signed in here before.";
  if (state === "CATALOG_REQUIRED") {
    return "Taking cash without internet isn't ready yet. It usually will be after a sign-in with a connection.";
  }
  return "This till can't take cash without internet.";
}
