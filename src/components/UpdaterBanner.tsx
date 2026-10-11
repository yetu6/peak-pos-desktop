import { useShiftSafeUpdater } from "../hooks/useShiftSafeUpdater";
import { Banner } from "./system";

/** Non-blocking notice when an update is downloaded and waiting for lock/unpair. */
export function UpdaterBanner() {
  const { status, blockedReason } = useShiftSafeUpdater();

  if (status.kind === "error") {
    return <Banner tone="warning">Update check failed: {status.message}</Banner>;
  }
  if (status.kind === "downloading" || status.kind === "available") {
    return <Banner tone="info">Downloading Peak Terminal {status.version}…</Banner>;
  }
  if (status.kind === "ready") {
    return (
      <Banner tone="info" data-testid="updater-ready">
        Update {status.version} ready.
        {blockedReason ? ` ${blockedReason}` : " Installing…"}
      </Banner>
    );
  }
  return null;
}
