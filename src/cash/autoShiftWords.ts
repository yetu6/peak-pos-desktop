import { otherWords, problemOf, UNREACHABLE } from "../lib/problemWords";

/**
 * How long the till waits before asking Yetu once more to open the shift, when
 * Yetu says it is still bringing the business date up to today. Yetu's own
 * words promise "a minute", so one minute, and only once: never a tight loop.
 * A named constant, not a setting: nothing at the outlet changes how long a
 * date catch-up takes.
 */
export const AUTOMATIC_OPEN_RETRY_MS = 60_000;

export const OPENING_SHIFT_WORDS = "Opening the shift…";

/** On the order screen, while Yetu opens the next shift after closing the last: what needs a shift waits. */
export const REOPENING_SHIFT_WORDS = "One moment: Yetu is opening the next shift.";

/** Yetu's own sentences for its three answers, used when the answer carries none. */
const COUNTED_OPEN_WORDS = "This outlet counts its starting cash: a cashier opens the shift.";
const CATCHING_UP_WORDS = "Yetu is bringing the business date up to today. Try again in a minute.";

export type AutomaticOpenProblem =
  /** The outlet counts its starting cash after all: today's Open shift screen, with Yetu's words. */
  | { kind: "counted"; words: string }
  /** Another till or Yetu opened it first: read the shift again, nothing more. */
  | { kind: "already-open"; words: string }
  /** Yetu is still moving the business date: say so, try once more after a minute. */
  | { kind: "catching-up"; words: string }
  | { kind: "other"; words: string };

/** What Yetu's refusal to open the shift by itself means for the till, in words. */
export function automaticOpenProblem(error: unknown): AutomaticOpenProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "other", words: UNREACHABLE };
  const said = problem.detail?.trim();
  if (problem.code === "POS_SHIFT_COUNTED_OPEN") return { kind: "counted", words: said || COUNTED_OPEN_WORDS };
  if (problem.code === "POS_SHIFT_ALREADY_OPEN") return { kind: "already-open", words: said || "This till already has an open shift." };
  if (problem.code === "POS_DAY_CATCHING_UP") return { kind: "catching-up", words: said || CATCHING_UP_WORDS };
  return { kind: "other", words: otherWords(problem, "The shift wasn't opened. Try again.") };
}
