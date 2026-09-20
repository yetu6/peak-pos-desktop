import { useEffect, useState } from "react";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import {
  idleLockMs,
  idleLockSecondsFromEnv,
  watchIdleActivity,
} from "../lib/idleLock";

/**
 * Full-screen countdown while the till is idle. Any activity cancels it.
 * At zero the provider locks back to the staff roster via `switchStaff`.
 */
export function IdleLockOverlay({
  idleSeconds = idleLockSecondsFromEnv(),
}: {
  idleSeconds?: number;
}) {
  const { phase, switchStaff } = useDeviceSession();
  const [remaining, setRemaining] = useState<number | null>(null);

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

  if (phase !== "ready" || remaining === null || remaining > idleSeconds) {
    return null;
  }

  return (
    <div
      className="idle-lock-overlay"
      data-testid="idle-lock-overlay"
      role="alertdialog"
      aria-live="assertive"
      aria-label={`Locking in ${remaining} seconds`}
    >
      <div className="idle-lock-card">
        <p className="idle-lock-label">Locking in</p>
        <p className="idle-lock-count" data-testid="idle-lock-count">
          {remaining}
        </p>
        <p className="idle-lock-hint">Touch the screen to stay signed in</p>
      </div>
    </div>
  );
}
