/**
 * How long Yetu's answers take as this till waits for them, from asking to the
 * answer read, for the details for support. F-255 (2026-10-20): an add took
 * 0.8–1.2 s on Bahari's Linux till though Yetu answered in 45–131 ms; the rest
 * was the connection. Kept in memory only, the latest REQUEST_TIMES_KEPT.
 */
export const REQUEST_TIMES_KEPT = 20;

interface RequestTime {
  /** A change (an add, a payment) rather than a look-up. */
  change: boolean;
  ms: number;
}

let kept: RequestTime[] = [];

export function noteRequestTime(method: string, ms: number): void {
  kept = [{ change: method.toUpperCase() !== "GET", ms }, ...kept].slice(0, REQUEST_TIMES_KEPT);
}

export function resetRequestTimes(): void {
  kept = [];
}

function usual(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function seconds(ms: number): string {
  return ms < 1_000 ? `${(ms / 1_000).toFixed(2)} s` : `${(ms / 1_000).toFixed(1)} s`;
}

/** "Changes 0.42 s · Look-ups 0.21 s (usual of the last 7)". */
export function requestTimesWords(): string {
  if (kept.length === 0) return "Nothing asked yet";
  const changes = kept.filter((time) => time.change).map((time) => time.ms);
  const lookUps = kept.filter((time) => !time.change).map((time) => time.ms);
  const parts = [
    changes.length > 0 ? `Changes ${seconds(usual(changes))}` : null,
    lookUps.length > 0 ? `Look-ups ${seconds(usual(lookUps))}` : null,
  ].filter(Boolean);
  return `${parts.join(" · ")} (usual of the last ${kept.length})`;
}
