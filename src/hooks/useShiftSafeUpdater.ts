import { useEffect, useRef, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { canApplyUpdater, updaterBlockedReason } from "../lib/updaterGate";

type UpdaterStatus =
  | { kind: "idle" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

/**
 * Checks the stable updater endpoint periodically. Downloads in the background
 * when an update exists; installs only when the shell is locked or unpaired.
 */
export function useShiftSafeUpdater(): {
  status: UpdaterStatus;
  installNow: () => Promise<void>;
  blockedReason: string | null;
} {
  const { phase } = useDeviceSession();
  const [status, setStatus] = useState<UpdaterStatus>({ kind: "idle" });
  const updateRef = useRef<Awaited<ReturnType<typeof check>>>(null);

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
    if (!canApplyUpdater(phase)) return;
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
  }, [phase, status.kind]);

  const installNow = async () => {
    if (!canApplyUpdater(phase)) return;
    const update = updateRef.current;
    if (!update || status.kind !== "ready") return;
    await update.install();
  };

  return {
    status,
    installNow,
    blockedReason: status.kind === "ready" ? updaterBlockedReason(phase) : null,
  };
}
