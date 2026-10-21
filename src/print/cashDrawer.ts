import type { PrintResult } from "../lib/kitchenTicketPrint";
import { EscPos } from "./escpos";
import type { PrinterSettings } from "./printerSettings";
import { loadPrinterSettings, printRawToPrinter } from "./printerStore";

/**
 * A cash drawer is set up on this till: switched on in Status → Printers and
 * plugged into the bill printer. A till without one -- a laptop at a small
 * restaurant -- never opens one and never offers to.
 */
export function drawerFitted(settings: PrinterSettings): boolean {
  return settings.cashDrawer && settings.receipt !== null;
}

/** Opens the drawer when one is set up (ESC p); with none, nothing happens. */
export async function openDrawer(settings?: PrinterSettings): Promise<PrintResult> {
  const chosen = settings ?? (await loadPrinterSettings());
  if (!drawerFitted(chosen) || !chosen.receipt) return { ok: true };
  try {
    await printRawToPrinter(chosen.receipt.target, new EscPos(chosen.receipt.width).drawer().build());
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Cash taken, put in or taken out opens the drawer, every time (owner,
 * 2026-10-21): a guest paying their share of a bill in cash gets their change
 * from the drawer, not from the counter. Nothing prints after payment, so
 * the drawer opens on its own; any other method leaves it shut.
 */
export async function openDrawerForCash(method: string | undefined, settings?: PrinterSettings): Promise<PrintResult> {
  if (method !== "CASH") return { ok: true };
  return openDrawer(settings);
}
