import type { PrintResult } from "../lib/kitchenTicketPrint";
import type { POSOrder } from "../lib/posContracts";
import { EscPos } from "./escpos";
import type { PrinterSettings } from "./printerSettings";
import { loadPrinterSettings, printRawToPrinter } from "./printerStore";

/** Cash came in for the order: its last tender, or a part paid in cash before it. */
export function cashTaken(order: Pick<POSOrder, "payments">, method?: string): boolean {
  return method === "CASH" || (order.payments ?? []).some((payment) => payment.paymentMethod === "CASH");
}

/**
 * After a cash payment the drawer opens (S8b). It opened as the receipt
 * printed; since 2026-10-20 nothing prints after payment (the restaurant's
 * EFD gives the tax receipt; Yetu's bill came before), so it is opened on
 * its own. The drawer hangs off the bill printer: with no drawer or no
 * thermal printer set up, nothing happens.
 */
export async function openDrawerAfterCash(order: Pick<POSOrder, "payments">, method?: string, settings?: PrinterSettings): Promise<PrintResult> {
  if (!cashTaken(order, method)) return { ok: true };
  const chosen = settings ?? (await loadPrinterSettings());
  if (!chosen.cashDrawer || !chosen.receipt) return { ok: true };
  try {
    await printRawToPrinter(chosen.receipt.target, new EscPos(chosen.receipt.width).drawer().build());
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
