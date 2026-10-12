import { useEffect, useRef } from "react";
import { useShiftSafeUpdater } from "../hooks/useShiftSafeUpdater";
import { noteUpdate } from "../lib/updateNotes";
import { Banner } from "./system";

/**
 * The update notice. Only two things reach it: an update ready to install,
 * and a ready update that failed to install. Checking and downloading are
 * quiet, and a failed or unavailable check (no release published yet, no
 * connection) is noted for the Status screen instead of shown here.
 *
 * Installing happens when the till is locked or not yet connected
 * (lib/updaterGate.ts); the words say so.
 */
export function UpdaterBanner() {
  const { status, blockedReason } = useShiftSafeUpdater();
  const wasReady = useRef(false);
  const installFailed = status.kind === "error" && wasReady.current;

  useEffect(() => {
    if (status.kind === "ready") {
      wasReady.current = true;
      noteUpdate({ kind: "ready", at: new Date() });
    } else if (status.kind === "error") {
      noteUpdate({ kind: wasReady.current ? "install-failed" : "check-failed", detail: status.message, at: new Date() });
    } else {
      wasReady.current = false;
    }
  }, [status]);

  if (status.kind === "ready") return <UpdateBannerView state={blockedReason ? "ready" : "installing"} />;
  if (installFailed) return <UpdateBannerView state="install-failed" />;
  return null;
}

/** What the update notice says, by state. */
export function UpdateBannerView({ state }: { state: "ready" | "installing" | "install-failed" }) {
  if (state === "install-failed") {
    return (
      <Banner tone="warning" data-testid="updater-failed">
        The update didn&apos;t install. The till keeps working as it is; it will try again later.
      </Banner>
    );
  }
  return (
    <Banner tone="info" data-testid="updater-ready">
      {state === "ready"
        ? "An update is ready. It installs the next time the till is locked."
        : "Installing the update. The till restarts by itself."}
    </Banner>
  );
}
