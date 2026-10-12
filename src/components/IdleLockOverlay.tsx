import { useEffect, useState } from "react";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { countdownWords } from "../access/accessWords";
import {
  idleLockMs,
  idleLockSecondsFromEnv,
  watchIdleActivity,
} from "../lib/idleLock";

/**
 * The countdown while the till sits unused. Any touch, key or movement keeps
 * the person signed in; at zero the till locks back to Who's working.
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

  return <IdleLockView remaining={remaining} />;
}

export function IdleLockView({ remaining }: { remaining: number }) {
  const time = countdownWords(remaining);
  return (
    <div
      className="idle-lock-overlay"
      data-testid="idle-lock-overlay"
      role="alertdialog"
      aria-live="assertive"
      aria-label={`Locking in ${remaining} seconds`}
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
