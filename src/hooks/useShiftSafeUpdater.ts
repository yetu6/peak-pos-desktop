import { useEffect, useRef, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { canApplyUpdater, updaterBlockedReason } from "../lib/updaterGate";

/** How often a locked till looks at the clock for the update window. */
const UPDATE_WINDOW_TICK_MS = 60_000;

type UpdaterStatus =
  | { kind: "idle" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

/**
 * Checks the stable updater endpoint periodically. Downloads in the background
 * when an update exists; installs only when nobody is signed in, inside the
 * update window or on a till just started (lib/updaterGate.ts).
 */
export function useShiftSafeUpdater(): {
  status: UpdaterStatus;
  installNow: () => Promise<void>;
  blockedReason: string | null;
  /** Whether a ready update may install now (nobody signed in; the window or a fresh start). */
  canInstall: boolean;
} {
  const { phase } = useDeviceSession();
  const [status, setStatus] = useState<UpdaterStatus>({ kind: "idle" });
  const updateRef = useRef<Awaited<ReturnType<typeof check>>>(null);
  // A till just started may install before its first sign-in; after that, only in the window.
  const [freshStart, setFreshStart] = useState(true);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (phase === "ready") setFreshStart(false);
  }, [phase]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), UPDATE_WINDOW_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        // No-op outside a Tauri webview (vite / vitest).
        if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
          return;
        }
        const update = await check();
        if (cancelled || !update) return;
        updateRef.current = update;
        setStatus({ kind: "available", version: update.version });
        setStatus({ kind: "downloading", version: update.version });
        await update.download();
        if (cancelled) return;
        setStatus({ kind: "ready", version: update.version });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        // Missing endpoint / unsigned channel is not a till fault during boot.
        if (/404|failed to fetch|network/i.test(message)) {
          setStatus({ kind: "idle" });
          return;
        }
        setStatus({ kind: "error", message });
      }
    };
    void run();
    const id = window.setInterval(() => void run(), 6 * 60 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (status.kind !== "ready") return;
    if (!canApplyUpdater(phase, now, freshStart)) return;
    const update = updateRef.current;
    if (!update) return;
    void update
      .install()
      .then(() => {
        // Process will restart after install on most platforms.
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setStatus({ kind: "error", message });
      });
  }, [phase, status.kind, now, freshStart]);

  const installNow = async () => {
    if (!canApplyUpdater(phase, new Date(), freshStart)) return;
    const update = updateRef.current;
    if (!update || status.kind !== "ready") return;
    await update.install();
  };

  return {
    status,
    installNow,
    blockedReason: status.kind === "ready" ? updaterBlockedReason(phase, now, freshStart) : null,
    canInstall: canApplyUpdater(phase, now, freshStart),
  };
}
