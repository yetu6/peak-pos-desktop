/** Default till idle lock. Peak `expiresAt` still locks independently. */
export const DEFAULT_IDLE_LOCK_SECONDS = 10;

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
