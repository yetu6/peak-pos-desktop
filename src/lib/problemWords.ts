/**
 * Reading the backend's refusals for plain words: the problem inside a
 * rejected hook call, and the till's own words for refusals that aren't about
 * the action itself. Each screen names the refusals of its own action
 * (cashWords, registerWords) and falls back to `otherWords`.
 */
import { describePosError, type PosErrorKind } from "./posErrors";

export interface ProblemLike {
  code?: string;
  detail?: string;
}

export const UNREACHABLE = "Can't reach Yetu. Check the internet connection, then try again.";

/** The backend problem inside a rejected hook call (usePosData `unwrap` puts it in the message as JSON). */
export function problemOf(error: unknown): ProblemLike | "network" | null {
  if (!error) return null;
  if (error instanceof TypeError || /Failed to fetch|NetworkError|ECONNREFUSED/i.test(String(error))) return "network";
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : null;
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object") return parsed as ProblemLike;
    } catch {
      return {};
    }
  }
  return typeof error === "object" ? (error as ProblemLike) : {};
}

/**
 * Refusals about this action (a conflict whose detail isn't one we name, a
 * validation message, or nothing recognisable) get the action's own words;
 * the backend's sentence never reaches the screen. Everything else is about
 * the session, the till or the property (session expired, till revoked,
 * feature not enabled, Yetu unavailable) and keeps the words the rest of the
 * till uses for it.
 */
const ACTION_WORDS_FOR: ReadonlySet<PosErrorKind> = new Set(["BUSINESS_CONFLICT", "VALIDATION_ERROR", "UNKNOWN"]);

export function otherWords(problem: ProblemLike, actionWords: string): string {
  const described = describePosError(problem);
  return ACTION_WORDS_FOR.has(described.kind) ? actionWords : described.message;
}
