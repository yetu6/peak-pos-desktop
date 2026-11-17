import { otherWords, problemOf, stepRefusal, UNREACHABLE } from "../lib/problemWords";

/**
 * How long the till waits before asking Yetu once more to open the shift, when
 * Yetu says it is still bringing the business date up to today, or can't be
 * reached. Yetu's own words promise "a minute", so one minute: never a tight
 * loop. A named constant, not a setting: nothing at the outlet changes how
 * long a date catch-up takes.
 */
export const AUTOMATIC_OPEN_RETRY_MS = 60_000;

/**
 * How many waits of AUTOMATIC_OPEN_RETRY_MS in a row the till makes before it
 * stops and offers Try again. Yetu's day close brings a bar's date up one day
 * every 30 seconds (fbc-peak cmd/api/main.go, its ticker), so thirty one-minute
 * waits (half an hour) cover a date about two months behind. Casanova's was
 * six days behind when this was set: about three minutes. Also bounds the
 * asks while Yetu can't be reached, so a till left alone never asks forever.
 */
export const AUTOMATIC_OPEN_MAX_WAITS = 30;

export const OPENING_SHIFT_WORDS = "Opening the shift…";

/** Yetu didn't open it, for a reason it gave no words for (or the till stopped asking). */
export const SHIFT_NOT_OPENED_WORDS = "The shift wasn't opened. Try again.";

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
  /** Yetu is still moving the business date: say so, and ask again after a minute. */
  | { kind: "catching-up"; words: string }
  /** No answer from Yetu (the connection, or Yetu not answering): say so, and ask again after a minute. */
  | { kind: "unreachable"; words: string }
  | { kind: "other"; words: string };

/** What Yetu's refusal to open the shift by itself means for the till, in words. */
export function automaticOpenProblem(error: unknown): AutomaticOpenProblem | null {
  const problem = problemOf(error);
  if (!problem) return null;
  if (problem === "network") return { kind: "unreachable", words: UNREACHABLE };
  const said = problem.detail?.trim();
  if (problem.code === "POS_SHIFT_COUNTED_OPEN") return { kind: "counted", words: said || COUNTED_OPEN_WORDS };
  if (problem.code === "POS_SHIFT_ALREADY_OPEN") return { kind: "already-open", words: said || "This till already has an open shift." };
  if (problem.code === "POS_DAY_CATCHING_UP") return { kind: "catching-up", words: said || CATCHING_UP_WORDS };
  if (stepRefusal(problem) === "network") return { kind: "unreachable", words: otherWords(problem, SHIFT_NOT_OPENED_WORDS) };
  return { kind: "other", words: otherWords(problem, SHIFT_NOT_OPENED_WORDS) };
}
