import type { DevicePhase } from "../auth/DeviceSessionProvider";

/**
 * Named setting: a downloaded update restarts the till only inside this window
 * of the till's own clock (owner, 23 Oct 2026: at midnight, so the new version
 * takes over when nobody is selling). "HH:MM-HH:MM", and it may cross midnight
 * ("23:00-02:00"). VITE_YETU_UPDATE_WINDOW overrides it for a build, e.g. for a
 * bar that trades past midnight.
 */
export const DEFAULT_UPDATE_WINDOW = "00:00-05:00";

export interface UpdateWindow {
  /** Minutes after midnight the window opens (inclusive) and closes (exclusive). */
  start: number;
  end: number;
}

function minutesOf(text: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function updateWindowFrom(
  raw: string | undefined = import.meta.env.VITE_YETU_UPDATE_WINDOW as string | undefined,
): UpdateWindow {
  const [from, to, ...rest] = (raw ?? "").split("-");
  const start = from === undefined ? null : minutesOf(from.trim());
  const end = to === undefined ? null : minutesOf(to.trim());
  if (start === null || end === null || rest.length > 0 || start === end) {
    return updateWindowFrom(DEFAULT_UPDATE_WINDOW);
  }
  return { start, end };
}

export function inUpdateWindow(now: Date, window: UpdateWindow): boolean {
  const minute = now.getHours() * 60 + now.getMinutes();
  return window.start < window.end
    ? minute >= window.start && minute < window.end
    : minute >= window.start || minute < window.end;
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** When a ready update installs, in the till's words. */
export function updateWhenWords(window: UpdateWindow = updateWindowFrom()): string {
  return `It installs between ${clock(window.start)} and ${clock(window.end)} while the till is locked, or when the till is next started.`;
}

/**
 * Updates download any time; they install only when nobody is signed in (the
 * till locked or not yet paired), and then only inside the update window, or
 * on a till just started, before its first sign-in (a till switched off at
 * night still updates the next morning).
 */
export function canApplyUpdater(
  phase: DevicePhase,
  now: Date = new Date(),
  freshStart = false,
  window: UpdateWindow = updateWindowFrom(),
): boolean {
  if (phase !== "locked" && phase !== "unpaired") return false;
  return freshStart || inUpdateWindow(now, window);
}

export function updaterBlockedReason(
  phase: DevicePhase,
  now: Date = new Date(),
  freshStart = false,
  window: UpdateWindow = updateWindowFrom(),
): string | null {
  if (canApplyUpdater(phase, now, freshStart, window)) return null;
  if (phase === "ready") {
    return "Finish the shift or switch staff before installing an update.";
  }
  if (phase === "waiting") {
    return "Finish pairing before installing an update.";
  }
  if (phase === "locked" || phase === "unpaired") return updateWhenWords(window);
  return "Wait until the till is locked or unpaired before installing an update.";
}
