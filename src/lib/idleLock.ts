/**
 * Named setting: the till locks after this many seconds with no touch, key or
 * movement (VITE_PEAK_IDLE_LOCK_SECONDS overrides it for a build). The
 * session's own expiry from Yetu still locks it independently.
 */
export const DEFAULT_IDLE_LOCK_SECONDS = 60;

/** Named setting: the countdown shows only for this many seconds before the lock. */
export const IDLE_LOCK_WARNING_SECONDS = 10;

// While a money request is with Yetu (a payment, closing a shift, cash in or
// out, a discount, a void) the till never locks: it waits for the answer.
const holds = new Set<symbol>();

/** Keeps the till from locking until the returned release is called. */
export function holdIdleLock(): () => void {
  const hold = Symbol("idle-lock-hold");
  holds.add(hold);
  return () => {
    holds.delete(hold);
  };
}

export function idleLockHeld(): boolean {
  return holds.size > 0;
}

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "mousemove", "wheel"] as const;

export function idleLockSecondsFromEnv(
  raw: string | undefined = import.meta.env.VITE_PEAK_IDLE_LOCK_SECONDS as string | undefined,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_IDLE_LOCK_SECONDS;
  return parsed;
}

export function idleLockMs(seconds: number = DEFAULT_IDLE_LOCK_SECONDS): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_IDLE_LOCK_SECONDS * 1_000;
  }
  return seconds * 1_000;
}

/**
 * Watches for user activity. While idle, reports remaining whole seconds via
 * `onCountdown` (null when activity is fresh). Fires `onIdle` once when the
 * idle window elapses; activity cancels and resets the countdown.
 */
export function watchIdleActivity(
  onIdle: () => void,
  options: {
    idleMs: number;
    onCountdown?: (remainingSeconds: number | null) => void;
    now?: () => number;
  } = { idleMs: idleLockMs() },
): () => void {
  const now = options.now ?? Date.now;
  let last = now();
  let fired = false;
  const mark = () => {
    last = now();
    fired = false;
    options.onCountdown?.(null);
  };
  for (const event of ACTIVITY_EVENTS) {
    window.addEventListener(event, mark, { passive: true });
  }
  const timer = window.setInterval(() => {
    if (holds.size > 0) {
      // Waiting on Yetu counts as use: each tick while held moves the start, so
      // a full idle window runs from when it settles.
      last = now();
      fired = false;
      options.onCountdown?.(null);
      return;
    }
    const remainingMs = options.idleMs - (now() - last);
    if (remainingMs <= 0) {
      options.onCountdown?.(0);
      if (!fired) {
        fired = true;
        onIdle();
      }
      return;
    }
    options.onCountdown?.(Math.ceil(remainingMs / 1_000));
  }, 250);
  return () => {
    window.clearInterval(timer);
    for (const event of ACTIVITY_EVENTS) {
      window.removeEventListener(event, mark);
    }
  };
}
