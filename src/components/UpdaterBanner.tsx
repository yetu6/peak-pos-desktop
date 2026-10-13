import { useEffect, useMemo, useRef } from "react";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { useShiftSafeUpdater } from "../hooks/useShiftSafeUpdater";
import { noteUpdate, type UpdateNote } from "../lib/updateNotes";
import { canApplyUpdater } from "../lib/updaterGate";
import { Banner } from "./system";

/**
 * The update notice. Only two things reach it: an update ready to install,
 * and a ready update that failed to install. Checking and downloading are
 * quiet; a failed or unavailable check, and a found update that didn't
 * download, are noted for the Status screen instead.
 *
 * Installing happens when the till is locked or not yet connected
 * (lib/updaterGate.ts); the words say so.
 */
export function UpdaterBanner() {
  const { status, blockedReason } = useShiftSafeUpdater();
  const { phase } = useDeviceSession();
  const previousKind = useRef(status.kind);

  // What an error means depends on what came just before it, decided once when it arrives:
  // after a found or downloading update it is a failed download; after a ready update it is a
  // failed install only if the till could install then; otherwise it is a later check failing.
  const errorKind = useMemo<UpdateNote["kind"] | null>(() => {
    if (status.kind !== "error") return null;
    const before = previousKind.current;
    if (before === "available" || before === "downloading") return "download-failed";
    if (before === "ready" && canApplyUpdater(phase)) return "install-failed";
    return "check-failed";
    // Decided when the error arrives; a later phase change does not reclassify it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (status.kind === "ready") noteUpdate({ kind: "ready", at: new Date() });
    if (status.kind === "error" && errorKind) noteUpdate({ kind: errorKind, detail: status.message, at: new Date() });
    previousKind.current = status.kind;
  }, [status, errorKind]);

  if (status.kind === "ready") return <UpdateBannerView state={blockedReason ? "ready" : "installing"} />;
  if (errorKind === "install-failed") return <UpdateBannerView state="install-failed" />;
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
