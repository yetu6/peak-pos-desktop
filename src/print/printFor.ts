import { processPendingPrintJobs } from "../lib/printJobs";
import type { PrintResult } from "../lib/kitchenTicketPrint";
import type { PrinterSettings } from "./printerSettings";
import { loadPrinterSettings, printRawToPrinter } from "./printerStore";

/**
 * Prints what Yetu made for one order or refund (S8a), the one way every
 * action prints: kitchen tickets to the kitchen's printer, or left for a
 * till that prints them; receipts on this till's own printer.
 */
export async function printFor(
  propertyId: string,
  sourceId: string,
  tagsOf?: (productId: string) => string | undefined,
  settings?: PrinterSettings,
): Promise<PrintResult[]> {
  return processPendingPrintJobs(propertyId, sourceId, undefined, {
    settings: settings ?? (await loadPrinterSettings()),
    printRaw: printRawToPrinter,
    tagsOf,
  });
}
