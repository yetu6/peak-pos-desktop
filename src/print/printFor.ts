import { processPendingPrintJobs, processPrintJob } from "../lib/printJobs";
import type { POSPrintJob } from "../lib/posContracts";
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

/**
 * Prints the one job Yetu just made (a bill, 2026-10-20) on this till's bill
 * printer, without anything else that waits for the same order.
 */
export async function printJobNow(job: POSPrintJob, settings?: PrinterSettings): Promise<PrintResult> {
  return processPrintJob(job, undefined, {
    settings: settings ?? (await loadPrinterSettings()),
    printRaw: printRawToPrinter,
  });
}
