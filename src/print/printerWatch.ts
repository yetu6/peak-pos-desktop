import { useSyncExternalStore } from "react";
import { loadPrinterHealth, printerHealthWords, type PrinterHealth } from "./printerHealth";
import type { PrinterTarget } from "./printerSettings";

/**
 * After a paper goes to a Windows printer, the till asks Windows how the
 * printer is (owner, 2026-10-29: out of paper, papers were sent and nothing
 * came out, and nobody was told). Windows takes a paper into its queue
 * whatever the printer's state, so a print that "worked" proves nothing: the
 * till looks again a few seconds later, and once more after a paper has had
 * time to come out (src-tauri printer_health.rs STUCK_AFTER_SECONDS). A
 * problem stays on every screen until a check finds the printer right.
 */

/** Named setting: seconds after a print when the till asks how the printer is. */
export const PRINT_CHECK_AFTER_SECONDS: readonly number[] = [5, 25];

export interface PrinterProblem {
  printer: string;
  words: string;
}

let current: PrinterProblem | null = null;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>[]>();

function set(next: PrinterProblem | null) {
  current = next;
  for (const listener of listeners) listener();
}

type Check = (name: string) => Promise<PrinterHealth>;

/** Asks Windows now. "Windows can't tell" says nothing rather than raise a false alarm. */
export async function checkPrinter(name: string, check: Check = loadPrinterHealth): Promise<void> {
  const health = await check(name);
  const { ok, words } = printerHealthWords(health);
  if (ok) {
    if (current?.printer === name) set(null);
    return;
  }
  if (health.state === "unknown" && health.stuckJobs === 0) return;
  set({ printer: name, words });
}

/** A paper just went to this printer: look again after PRINT_CHECK_AFTER_SECONDS. */
export function watchAfterPrint(target: PrinterTarget, check: Check = loadPrinterHealth): void {
  if (target.kind !== "system") return;
  const name = target.name;
  for (const timer of timers.get(name) ?? []) clearTimeout(timer);
  timers.set(
    name,
    PRINT_CHECK_AFTER_SECONDS.map((seconds) => setTimeout(() => void checkPrinter(name, check), seconds * 1000)),
  );
}

export function printerProblemNow(): PrinterProblem | null {
  return current;
}

/** The printer problem on every screen, until a check finds the printer right. */
export function usePrinterProblem(): PrinterProblem | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}

/** Tests start from no problem. */
export function forgetPrinterProblem(): void {
  for (const list of timers.values()) for (const timer of list) clearTimeout(timer);
  timers.clear();
  set(null);
}
