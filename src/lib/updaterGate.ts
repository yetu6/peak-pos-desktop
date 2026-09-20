import type { DevicePhase } from "../auth/DeviceSessionProvider";

/** Updates may download anytime; they may only apply when the till is idle. */
export function canApplyUpdater(phase: DevicePhase): boolean {
  return phase === "locked" || phase === "unpaired";
}

export function updaterBlockedReason(phase: DevicePhase): string | null {
  if (canApplyUpdater(phase)) return null;
  if (phase === "ready") {
    return "Finish the shift or switch staff before installing an update.";
  }
  if (phase === "waiting") {
    return "Finish pairing before installing an update.";
  }
  return "Wait until the till is locked or unpaired before installing an update.";
}
