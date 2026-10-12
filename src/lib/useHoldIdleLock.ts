import { useEffect } from "react";
import { holdIdleLock } from "./idleLock";

/** Keeps the till from locking while `active` (a money request is with Yetu). */
export function useHoldIdleLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return holdIdleLock();
  }, [active]);
}
