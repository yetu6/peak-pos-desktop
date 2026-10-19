import type { Reachability } from "./diagnostics";

/**
 * The details for support (Status, Sync) in the till's own words. The owner
 * asked for friendly, easily understood words everywhere (2026-10-19); these
 * were Lease ACTIVE, Realtime connecting, HTTP 404 and the like.
 */

/** The till's saved sales (the native store's status line). */
export function savedSalesWords(status: string): string {
  if (status === "Live") return "Up to date";
  if (status === "Reconnecting") return "Reconnecting";
  if (status === "Sync issue") return "A manager needs to look";
  const waiting = /^Offline · (\d+) waiting$/.exec(status);
  if (waiting) return `Offline, ${waiting[1]} waiting to send`;
  if (status === "Offline · Sales available") return "Offline, can still sell";
  return status;
}

const OFFLINE_READY: Record<string, string> = {
  ACTIVE: "Ready",
  STAGED: "Getting ready",
  MISSING: "Not yet: sign in with a connection",
  EXPIRED: "Ran out: sign in with a connection",
  REVOKED: "Stopped by a manager",
  SUPERSEDED: "Replaced by a newer one",
};

/** Cash without internet, or the menu kept for it (the lease and the catalogue). */
export function offlineReadyWords(state: string): string {
  return OFFLINE_READY[state] ?? "Not known";
}

/** Live updates: on, connecting, or off. */
export function liveUpdatesWords(state: { phase: string; attempt: number }): string {
  switch (state.phase) {
    case "connected":
      return "On";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return state.attempt > 0 ? `Reconnecting (try ${state.attempt})` : "Reconnecting";
    case "disconnected":
      return "Off";
    default:
      return "Off for now";
  }
}

const SYSTEMS: Record<string, string> = { linux: "Linux", windows: "Windows", macos: "Mac" };
const BITS: Record<string, string> = { x86_64: "64-bit", aarch64: "64-bit", x86: "32-bit" };

/** The computer the till runs on. */
export function computerWords(os: string, arch: string): string {
  const system = SYSTEMS[os.trim().toLowerCase()];
  if (!system) return os.trim() || "Not known";
  const bits = BITS[arch.trim().toLowerCase()];
  return bits ? `${system}, ${bits}` : system;
}

const TILL_KINDS: Record<string, string> = {
  POS: "Orders and payments",
  CASHIER: "Payments",
  KITCHEN_DISPLAY: "Kitchen screen",
  BAR_DISPLAY: "Bar screen",
  "OFFLINE-CASH": "Cash only, offline",
};

/** What this till is for, as the manager chose at pairing. */
export function tillKindWords(mode: string | null | undefined): string {
  return TILL_KINDS[(mode ?? "POS").trim().toUpperCase()] ?? "Orders and payments";
}

/** Whether Yetu answers, without the status code. */
export function yetuAnswersWords(check: { status: Reachability } | null): string {
  if (!check) return "Checking";
  return check.status === "reachable" ? "Answers" : "Can't be reached";
}
