import { useEffect, useRef, useState } from "react";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { countdownWords } from "../access/accessWords";
import {
  IDLE_LOCK_WARNING_SECONDS,
  idleLockMs,
  idleLockSecondsFromEnv,
  watchIdleActivity,
} from "../lib/idleLock";

/**
 * The countdown before the till locks itself. It shows only in the last
 * IDLE_LOCK_WARNING_SECONDS of the idle time; any touch, key or movement
 * keeps the person signed in. A tap on the countdown only resets the timer:
 * the countdown stays until that tap ends, so the tap never presses what is
 * beneath it. At zero the till locks back to Who's working.
 */
export function IdleLockOverlay({
  idleSeconds = idleLockSecondsFromEnv(),
}: {
  idleSeconds?: number;
}) {
  const { phase, switchStaff } = useDeviceSession();
  const [remaining, setRemaining] = useState<number | null>(null);
  // A tap that began on the countdown: keep it until the tap ends.
  const [tapping, setTapping] = useState(false);
  const shown = useRef(IDLE_LOCK_WARNING_SECONDS);

  useEffect(() => {
    if (phase !== "ready") {
      setRemaining(null);
      return;
    }
    return watchIdleActivity(() => switchStaff("Locked after idle"), {
      idleMs: idleLockMs(idleSeconds),
      onCountdown: setRemaining,
    });
  }, [phase, idleSeconds, switchStaff]);

  const warning = remaining !== null && remaining <= Math.min(IDLE_LOCK_WARNING_SECONDS, idleSeconds);
  if (warning) shown.current = remaining;
  if (phase !== "ready" || (!warning && !tapping)) return null;

  return (
    <IdleLockView
      remaining={shown.current}
      onPointerDown={() => setTapping(true)}
      onTapEnd={() => setTapping(false)}
    />
  );
}

export function IdleLockView({
  remaining,
  onPointerDown,
  onTapEnd,
}: {
  remaining: number;
  onPointerDown?: () => void;
  onTapEnd?: () => void;
}) {
  const time = countdownWords(remaining);
  return (
    <div
      className="idle-lock-overlay"
      data-testid="idle-lock-overlay"
      role="alertdialog"
      aria-live="assertive"
      aria-label={`Locking in ${remaining} seconds`}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        // The tap was for the countdown only.
        event.stopPropagation();
        event.preventDefault();
        onTapEnd?.();
      }}
    >
      <div className="idle-lock-card">
        <p className="idle-lock-label">
          Locking in <span className="sr-only">{time}</span>
        </p>
        <p className="idle-lock-count" data-testid="idle-lock-count" aria-hidden="true">
          {time}
        </p>
        <p className="idle-lock-hint">Touch anywhere to stay signed in.</p>
      </div>
    </div>
  );
}
