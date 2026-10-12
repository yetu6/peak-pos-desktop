import { useEffect, useRef } from "react";
import { describePosError } from "./posErrors";
import { problemOf } from "./problemWords";

/**
 * Named setting: how long the till waits after "too many attempts" when Yetu
 * sent no Retry-After (Yetu's limiter always sends one; this is the floor).
 */
export const RATE_LIMIT_FALLBACK_WAIT_SECONDS = 60;

/** How long Yetu asked the till to wait, for a 429; null for anything else. */
export function rateLimitWaitSeconds(error: unknown): number | null {
  const problem = problemOf(error);
  if (!problem || problem === "network") return null;
  const described = describePosError(problem);
  if (described.kind !== "RATE_LIMITED") return null;
  return described.retryAfterSeconds ?? RATE_LIMIT_FALLBACK_WAIT_SECONDS;
}

/**
 * True while Yetu has asked the till to wait before the next attempt (429).
 * When the wait is over `onWaited` runs once (the caller forgets the refusal,
 * which ends the wait) and the next attempt is allowed.
 */
export function useRateLimitWait(error: unknown, onWaited: () => void): boolean {
  const wait = rateLimitWaitSeconds(error);
  const latest = useRef(onWaited);
  latest.current = onWaited;
  useEffect(() => {
    if (wait === null) return;
    const timer = setTimeout(() => latest.current(), wait * 1000);
    return () => clearTimeout(timer);
  }, [error, wait]);
  return wait !== null;
}
