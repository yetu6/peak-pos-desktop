/** Default till idle lock. Peak `expiresAt` still locks independently. */
export const DEFAULT_IDLE_LOCK_MINUTES = 5;

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "mousemove", "wheel"] as const;

export function idleLockMinutesFromEnv(
  raw: string | undefined = import.meta.env.VITE_PEAK_IDLE_LOCK_MINUTES as string | undefined,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_IDLE_LOCK_MINUTES;
  return parsed;
}

export function idleLockMs(minutes: number = DEFAULT_IDLE_LOCK_MINUTES): number {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return DEFAULT_IDLE_LOCK_MINUTES * 60_000;
  }
  return minutes * 60_000;
}

export function watchIdleActivity(
  onIdle: () => void,
  options: { idleMs: number; now?: () => number } = { idleMs: idleLockMs() },
): () => void {
  const now = options.now ?? Date.now;
  let last = now();
  const mark = () => {
    last = now();
  };
  for (const event of ACTIVITY_EVENTS) {
    window.addEventListener(event, mark, { passive: true });
  }
  const timer = window.setInterval(() => {
    if (now() - last >= options.idleMs) {
      onIdle();
    }
  }, Math.min(1_000, options.idleMs));
  return () => {
    window.clearInterval(timer);
    for (const event of ACTIVITY_EVENTS) {
      window.removeEventListener(event, mark);
    }
  };
}
