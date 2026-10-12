/**
 * Named setting: the till locks after this many seconds with no touch, key or
 * movement (VITE_PEAK_IDLE_LOCK_SECONDS overrides it for a build). The
 * session's own expiry from Yetu still locks it independently.
 */
export const DEFAULT_IDLE_LOCK_SECONDS = 60;

/** Named setting: the countdown shows only for this many seconds before the lock. */
export const IDLE_LOCK_WARNING_SECONDS = 10;

/**
 * Named setting: the most the lock may wait for a money request still with
 * Yetu, past its usual time. After that the till locks regardless (the
 * request's own result still lands; the person signs back in to see it).
 */
export const IDLE_LOCK_MAX_DEFERRAL_SECONDS = 30;

// While a money request is with Yetu (a payment, closing a shift, cash in or
// out, a discount, a void) the lock waits for the answer, up to
// IDLE_LOCK_MAX_DEFERRAL_SECONDS past its time. Holds come from the sheets'
// live mutation status and are let go when a sheet closes (useHoldIdleLock).
const holds = new Set<symbol>();

/** Defers the lock (within the bound) until the returned release is called. */
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
  // An unusable lock time locks at the usual default, never later.
  const idleMs = Number.isFinite(options.idleMs) && options.idleMs > 0 ? options.idleMs : DEFAULT_IDLE_LOCK_SECONDS * 1_000;
  const deferralMs = IDLE_LOCK_MAX_DEFERRAL_SECONDS * 1_000;
  let last = now();
  let fired = false;
  const lock = () => {
    if (fired) return;
    fired = true;
    onIdle();
  };
  const mark = () => {
    last = now();
    fired = false;
    options.onCountdown?.(null);
  };
  for (const event of ACTIVITY_EVENTS) {
    window.addEventListener(event, mark, { passive: true });
  }
  const timer = window.setInterval(() => {
    try {
      // Idle time runs from the last touch; a pending money request moves the
      // lock later by at most the deferral, never earlier than its time.
      const limit = holds.size > 0 ? idleMs + deferralMs : idleMs;
      const remainingMs = limit - (now() - last);
      if (remainingMs <= 0) {
        options.onCountdown?.(0);
        lock();
        return;
      }
      options.onCountdown?.(Math.ceil(remainingMs / 1_000));
    } catch {
      // Anything unexpected locks rather than leaving the till open.
      lock();
    }
  }, 250);
  return () => {
    window.clearInterval(timer);
    for (const event of ACTIVITY_EVENTS) {
      window.removeEventListener(event, mark);
    }
  };
}
