import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { canApplyUpdater, canRestartForUpdate, updaterBlockedReason } from "../lib/updaterGate";

/** How often a locked till looks at the clock for the update window. */
const UPDATE_WINDOW_TICK_MS = 60_000;

export type UpdaterStatus =
  | { kind: "idle" }
  /** A check someone asked for ("Check for updates now") is running. */
  | { kind: "checking" }
  /** That check found nothing newer. */
  | { kind: "latest" }
  /** That check can't run here (a browser, not the till app). */
  | { kind: "unavailable" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

/**
 * Checks the stable updater endpoint periodically. Downloads in the background
 * when an update exists; installs only when nobody is signed in, inside the
 * update window or on a till just started (lib/updaterGate.ts).
 */
export interface UpdaterState {
  status: UpdaterStatus;
  installNow: () => Promise<void>;
  /** Looks for an update now, on the one updater the till has. */
  checkNow: () => Promise<void>;
  /** A person's restart to update: refused over an open shift. */
  restartNow: (hasOpenShift: boolean) => Promise<void>;
  blockedReason: string | null;
  /** Whether a ready update may install now (nobody signed in; the window or a fresh start). */
  canInstall: boolean;
}

const QUIET: UpdaterState = {
  status: { kind: "idle" },
  installNow: async () => {},
  checkNow: async () => {},
  restartNow: async () => {},
  blockedReason: null,
  canInstall: false,
};

/** The one updater, shared by the notice, the navigation badge and Status (UpdaterProvider). */
export const UpdaterContext = createContext<UpdaterState>(QUIET);

export function useShiftSafeUpdater(): UpdaterState {
  return useContext(UpdaterContext);
}

export function useUpdaterEngine(): UpdaterState {
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

  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (manual: boolean) => {
    if (busy.current) return;
    // No-op outside a Tauri webview (vite / vitest).
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      if (manual) setStatus({ kind: "unavailable" });
      return;
    }
    busy.current = true;
    if (manual) setStatus((now) => (now.kind === "ready" ? now : { kind: "checking" }));
    try {
      const update = await check();
      if (!mounted.current) return;
      if (!update) {
        if (manual) setStatus((now) => (now.kind === "ready" ? now : { kind: "latest" }));
        return;
      }
      updateRef.current = update;
      setStatus({ kind: "available", version: update.version });
      setStatus({ kind: "downloading", version: update.version });
      await update.download();
      if (!mounted.current) return;
      setStatus({ kind: "ready", version: update.version });
    } catch (err) {
      if (!mounted.current) return;
      const message = err instanceof Error ? err.message : String(err);
      // Missing endpoint / unsigned channel is not a till fault during boot.
      if (!manual && /404|failed to fetch|network/i.test(message)) {
        setStatus({ kind: "idle" });
        return;
      }
      setStatus({ kind: "error", message });
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void run(false);
    const id = window.setInterval(() => void run(false), 6 * 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [run]);

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

  const restartNow = async (hasOpenShift: boolean) => {
    if (!canRestartForUpdate(phase, hasOpenShift)) return;
    const update = updateRef.current;
    if (!update || status.kind !== "ready") return;
    try {
      await update.install();
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const checkNow = useCallback(() => run(true), [run]);

  return {
    status,
    installNow,
    checkNow,
    restartNow,
    blockedReason: status.kind === "ready" ? updaterBlockedReason(phase, now, freshStart) : null,
    canInstall: canApplyUpdater(phase, now, freshStart),
  };
}
