import type { POSPrintJob } from "../lib/posContracts";
import { receiptCopyFromPrintDocument } from "../lib/receiptPrint";
import type { PaperWidth } from "./escpos";
import { receiptBytes, textPaperBytes } from "./receipt";

/**
 * Cash changed hands on this job's paper (S8b): a sale whose cash Yetu
 * counted (cashMinor, a split's cash part too), or a refund paid out in cash.
 */
export function cashMoved(job: POSPrintJob): boolean {
  if (job.jobType === "RECEIPT") return typeof job.document.cashMinor === "number" && job.document.cashMinor > 0;
  if (job.jobType === "REFUND_RECEIPT" && Array.isArray(job.document.tenders)) {
    return job.document.tenders.some((tender) => Boolean(tender) && (tender as { paymentMethod?: unknown }).paymentMethod === "CASH");
  }
  return false;
}

/**
 * A receipt or refund slip as the thermal receipt printer takes it. The cash
 * drawer opens for an original only, never for a copy printed again.
 */
export function receiptPaperFor(job: POSPrintJob, width: PaperWidth, cashDrawer: boolean, formattedText: string): Uint8Array {
  const copy = Boolean(job.reprintedFromId);
  const drawer = cashDrawer && !copy && cashMoved(job);
  if (job.jobType === "RECEIPT") return receiptBytes(receiptCopyFromPrintDocument(job.document), width, { drawer, copy });
  return textPaperBytes(formattedText, width, { drawer, copy });
}
