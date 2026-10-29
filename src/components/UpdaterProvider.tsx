import type { ReactNode } from "react";
import { UpdaterContext, useUpdaterEngine } from "../hooks/useShiftSafeUpdater";

/** Runs the till's one updater and shares it with the notice, the navigation badge and Status. */
export function UpdaterProvider({ children }: { children: ReactNode }) {
  const updater = useUpdaterEngine();
  return <UpdaterContext.Provider value={updater}>{children}</UpdaterContext.Provider>;
}
