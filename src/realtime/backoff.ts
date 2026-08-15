/**
 * Exponential backoff with full jitter (AWS "full jitter" strategy).
 * Cap and base are injected so tests can use tiny values.
 */
export interface Backoff {
  delayMs(attempt: number): number;
}

export function createBackoff(options?: {
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
}): Backoff {
  const baseMs = options?.baseMs ?? 500;
  const maxMs = options?.maxMs ?? 15_000;
  const random = options?.random ?? Math.random;

  return {
    delayMs(attempt: number): number {
      const capped = Math.min(baseMs * 2 ** attempt, maxMs);
      return Math.floor(random() * capped);
    },
  };
}