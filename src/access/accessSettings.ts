/**
 * Named settings for the screens before a person is signed in. Where a value
 * mirrors a backend rule, the rule is named so both move together.
 */

/** A staff PIN is exactly 6 digits (fbc-peak internal/pos/credentials.go validPIN). The pad submits at 6. */
export const PIN_LENGTH = 6;

/**
 * After 5 wrong tries the backend pauses a PIN for 1 minute, doubling on each
 * further pause up to 30 (fbc-peak internal/pos/service.go lockoutDuration).
 * A wrong PIN and a paused PIN look the same to the till, so from the 5th
 * refusal in a row it says the PIN is paused for at least a minute.
 */
export const PIN_PAUSE_AFTER_FAILURES = 5;

/** The roster offers a search when more people than this work at the till. */
export const ROSTER_SEARCH_AFTER = 12;

/** Opening the till normally takes a few seconds; after this it says what to do. */
export const SPLASH_SLOW_AFTER_MS = 20_000;

/**
 * Where a manager approves a till in the hotel web app today (POS, then
 * Registers & Devices, then Connect POS, which asks for the pairing code).
 * Change these together with that app's words (slice S10 renames them).
 */
export const PAIRING_STEPS: readonly string[] = [
  "In Yetu, open POS, then Registers & Devices.",
  "Press Connect POS.",
  "Type this code where it asks for the pairing code.",
];

/**
 * The pairing QR code's colours. A phone camera reads black on white best, so
 * the code keeps them in both themes (its card is white too).
 */
export const QR_COLOURS = { dark: "#000000", light: "#ffffff" } as const;
