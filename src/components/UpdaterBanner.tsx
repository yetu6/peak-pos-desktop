import { useShiftSafeUpdater } from "../hooks/useShiftSafeUpdater";

/** Non-blocking notice when an update is downloaded and waiting for lock/unpair. */
export function UpdaterBanner() {
  const { status, blockedReason } = useShiftSafeUpdater();

  if (status.kind === "error") {
    return (
      <div className="bg-destructive/15 text-destructive px-3 py-1.5 text-sm" role="status">
        Update check failed: {status.message}
      </div>
    );
  }
  if (status.kind === "downloading" || status.kind === "available") {
    return (
      <div className="bg-muted text-muted-foreground px-3 py-1.5 text-sm" role="status">
        Downloading Peak Terminal {status.version}…
      </div>
    );
  }
  if (status.kind === "ready") {
    return (
      <div className="bg-muted px-3 py-1.5 text-sm" role="status" data-testid="updater-ready">
        Update {status.version} ready.
        {blockedReason ? ` ${blockedReason}` : " Installing…"}
      </div>
    );
  }
  return null;
}
