import type { MonochromeRaster } from "./billLogo";
import type { POSPrintJob } from "../lib/posContracts";
import { receiptCopyFromPrintDocument } from "../lib/receiptPrint";
import { getOperationalSession } from "../lib/operationalSession";
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
 * A bill or refund slip as the thermal bill printer takes it. The cash
 * drawer opens for an original only, never for a copy printed again, and
 * never for a bill: nothing is paid when it prints (2026-10-20).
 */
export function receiptPaperFor(job: POSPrintJob, width: PaperWidth, cashDrawer: boolean, formattedText: string, logo?: MonochromeRaster, testBusiness = false): Uint8Array {
  const copy = Boolean(job.reprintedFromId) || job.document.copy === true;
  const drawer = cashDrawer && !copy && cashMoved(job);
  if (job.jobType === "RECEIPT" || job.jobType === "BILL") return receiptBytes(receiptCopyFromPrintDocument(job.document, { hotel: hotelHere() }), width, { drawer, copy, logo, testBusiness });
  return textPaperBytes(formattedText, width, { drawer, copy, testBusiness });
}

/** This till's property has rooms (LODGING, from the signed-in session): its bills carry the room-charge lines. */
export function hotelHere(): boolean {
  return getOperationalSession()?.capabilities?.includes("LODGING") === true;
}
