import { getApiBaseUrl } from "./peakConfig";
import { getOperationalSession } from "./operationalSession";
import { restRequestHeaders } from "./restAuth";
import { devIdentityFromEnv, type DevIdentity } from "./env";
import {
  formatKitchenTicket,
  type KitchenTicketCopy,
  type PrintResult,
} from "./kitchenTicketPrint";
import { formatReceipt, receiptCopyFromPrintDocument } from "./receiptPrint";
import { formatRefundReceipt, refundReceiptCopyFromPrintDocument } from "./refundReceiptPrint";
import type { POSPrintJob, PrintJobStatus } from "./posContracts";
import { kitchenTicketBytes } from "../print/kitchenTicket";
import { formatVoidSlip, voidSlipBytes, voidSlipFromPrintDocument } from "../print/voidTicket";
import { paperFromPrintDocument, type KitchenPrintRoutes } from "../print/kitchenRouting";
import { printerFor, stationPrintsNoPaper } from "../print/printerSettings";
import { hotelHere, receiptPaperFor } from "../print/receiptRouting";
import { yetuFetch } from "./yetuFetch";

/**
 * The `pos_print_jobs.job_type` values Yetu writes: a kitchen ticket at
 * `sendOrder` (`internal/pos/operations.go`), a receipt at settlement and
 * again, chained, at `/receipt/reprint` (`internal/pos/receipts.go`), and a
 * refund receipt when money is given back (`internal/pos/refunds.go`, S7),
 * and a void slip when an item the kitchen was making is voided
 * (`internal/pos/item_void.go`, migration 00125). There is no
 * `shift_report` job type anywhere in the backend.
 */
const KITCHEN_TICKET = "KITCHEN_TICKET";
/** fbc-peak 00125: a station is told to stop making what was voided; it prints where its kitchen tickets print. */
const KITCHEN_VOID = "KITCHEN_VOID";
const RECEIPT = "RECEIPT";
const REFUND_RECEIPT = "REFUND_RECEIPT";
/** 2026-10-20: the bill before payment (printBill); a paid order's RECEIPT is kept ON_FILE and prints only as a copy. */
const BILL = "BILL";

function tryDevIdentity(): DevIdentity | null {
  try {
    return devIdentityFromEnv();
  } catch {
    return null;
  }
}

function headers(): Record<string, string> {
  return {
    ...restRequestHeaders(getOperationalSession(), tryDevIdentity()),
    "Idempotency-Key": crypto.randomUUID(),
  };
}

class PrintJobRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PrintJobRequestError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await yetuFetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new PrintJobRequestError(response.status, body || `Print job request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function printFailure(error: unknown): PrintResult {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export function ticketCopyFromPrintDocument(document: Record<string, unknown>): KitchenTicketCopy {
  const rawLines = Array.isArray(document.items) ? document.items : document.lines;
  const lines = Array.isArray(rawLines)
    ? rawLines.flatMap((line) => {
        if (!line || typeof line !== "object") return [];
        const row = line as Record<string, unknown>;
        if (typeof row.name !== "string") return [];
        const mods = Array.isArray(row.modifiers)
          ? row.modifiers
              .map((mod) => {
                if (!mod || typeof mod !== "object") return null;
                const entry = mod as Record<string, unknown>;
                return typeof entry.name === "string" ? entry.name : null;
              })
              .filter((name): name is string => Boolean(name))
          : [];
        return [
          {
            name: row.name,
            quantity: String(row.quantity ?? "1"),
            note:
              typeof row.note === "string"
                ? row.note
                : mods.length
                  ? mods.join(", ")
                  : undefined,
          },
        ];
      })
    : [];
  return {
    ticketNumber: typeof document.ticketNumber === "string" ? document.ticketNumber : undefined,
    orderNumber: typeof document.orderNumber === "string" ? document.orderNumber : undefined,
    dailyNumber: typeof document.dailyNumber === "number" ? document.dailyNumber : undefined,
    tableNumber:
      typeof document.tableLabel === "string"
        ? document.tableLabel
        : typeof document.tableNumber === "string"
          ? document.tableNumber
          : undefined,
    serviceType: typeof document.serviceType === "string" ? document.serviceType : undefined,
    station: typeof document.station === "string" ? document.station : undefined,
    notes: typeof document.notes === "string" ? document.notes : undefined,
    waiterName: typeof document.waiterName === "string" ? document.waiterName : undefined,
    sentAt: typeof document.sentAt === "string" ? document.sentAt : undefined,
    lines,
  };
}

export function formatPrintDocument(job: POSPrintJob): { title: string; text: string } {
  if (job.jobType === RECEIPT || job.jobType === BILL) {
    return { title: "yetu-bill", text: formatReceipt(receiptCopyFromPrintDocument(job.document, { hotel: hotelHere() })) };
  }
  if (job.jobType === REFUND_RECEIPT) {
    return { title: "yetu-refund-receipt", text: formatRefundReceipt(refundReceiptCopyFromPrintDocument(job.document)) };
  }
  if (job.jobType === KITCHEN_TICKET) {
    return { title: "yetu-kitchen-ticket", text: formatKitchenTicket(ticketCopyFromPrintDocument(job.document)) };
  }
  if (job.jobType === KITCHEN_VOID) {
    return { title: "yetu-void-slip", text: formatVoidSlip(voidSlipFromPrintDocument(job.document)) };
  }
  // An unrecognized job type must still be printable rather than dropped —
  // fall back to the generic ticket formatter instead of failing the job.
  return { title: `yetu-${job.jobType.toLowerCase().replaceAll("_", "-")}`, text: formatKitchenTicket(ticketCopyFromPrintDocument(job.document)) };
}

async function defaultPrint(title: string, text: string): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error("No printer is set up on this till");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("print_document", { document: { title, text } });
}

/** Peak's job status column stores PENDING/CLAIMED/PRINTED/FAILED exactly —
 *  the query filter must match that case or every row is silently excluded. */
export async function listPrintJobs(status: PrintJobStatus | "" = "PENDING", sourceId?: string): Promise<POSPrintJob[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  // S8a: the order's or refund's own jobs, however many others wait at the outlet.
  if (sourceId) params.set("sourceId", sourceId);
  const query = params.toString();
  return request(`/api/v1/pos/print-jobs${query ? `?${query}` : ""}`);
}

/**
 * YQA-10: `headers()` above mints a fresh random Idempotency-Key on every
 * call, so a job still PENDING on the next poll -- because the previous
 * claim/ack's response was lost, not because it never reached the server --
 * got claimed (or acked) again under a key that looked like an unrelated
 * request. These three actions are already uniquely identified by (jobId,
 * action), with no meaningfully varying body, so a deterministic key derived
 * from them is stable across polling cycles and app restarts alike, which a
 * held-in-memory random key never could be.
 */
function printJobIdempotencyKey(jobId: string, action: "claim" | "printed" | "failed"): string {
  return `pos-print-job:${jobId}:${action}`;
}

export async function claimPrintJob(jobId: string): Promise<POSPrintJob> {
  return request(`/api/v1/pos/print-jobs/${jobId}/claim`, {
    method: "POST",
    headers: { "Idempotency-Key": printJobIdempotencyKey(jobId, "claim") },
  });
}

export async function ackPrinted(jobId: string): Promise<POSPrintJob> {
  return request(`/api/v1/pos/print-jobs/${jobId}/printed`, {
    method: "POST",
    headers: { "Idempotency-Key": printJobIdempotencyKey(jobId, "printed") },
  });
}

export async function ackFailed(jobId: string, error: string): Promise<POSPrintJob> {
  return request(`/api/v1/pos/print-jobs/${jobId}/failed`, {
    method: "POST",
    headers: { "Idempotency-Key": printJobIdempotencyKey(jobId, "failed") },
    body: JSON.stringify({ error }),
  });
}

export async function processPrintJob(
  job: POSPrintJob,
  printFn: (title: string, text: string) => Promise<void> = defaultPrint,
  routes?: KitchenPrintRoutes,
): Promise<PrintResult> {
  // A void slip goes where the station's kitchen tickets go, by the same settings.
  const kitchen = (job.jobType === KITCHEN_TICKET || job.jobType === KITCHEN_VOID) && routes !== undefined;
  // Paper kitchen tickets off on this till (its kitchen has a screen): the job
  // is left for a till that prints them, never claimed and dropped.
  if (kitchen && !routes.settings.kitchenTickets) return { ok: true };
  // No paper for this station on this till (a bar whose bartender pours what they ring up): left, like the above.
  if (kitchen && stationPrintsNoPaper(routes.settings, job.document.station)) return { ok: true };
  let claimed: POSPrintJob;
  try {
    claimed = job.status === "PENDING" ? await claimPrintJob(job.id) : job;
  } catch (error) {
    // Another till won SKIP LOCKED. That till prints; this one must not.
    if (error instanceof PrintJobRequestError && error.status === 409) {
      return { ok: true };
    }
    return printFailure(error);
  }
  const formatted = formatPrintDocument(claimed);
  try {
    const station = typeof claimed.document.station === "string" ? claimed.document.station : undefined;
    const printer = kitchen ? printerFor(routes.settings, station) : null;
    const receiptPrinter = (claimed.jobType === RECEIPT || claimed.jobType === REFUND_RECEIPT || claimed.jobType === BILL) ? routes?.settings.receipt : null;
    if (kitchen && printer) {
      // A thermal printer of the kitchen's: the ticket in large type, with a cut (S8a).
      await routes.printRaw(
        printer.target,
        claimed.jobType === KITCHEN_VOID
          ? voidSlipBytes(voidSlipFromPrintDocument(claimed.document), printer.width)
          : kitchenTicketBytes(paperFromPrintDocument(claimed.document, routes.tagsOf), printer.width),
      );
    } else if (routes && receiptPrinter) {
      // The thermal receipt printer: columns, a cut, and the cash drawer for cash on an original (S8b).
      await routes.printRaw(receiptPrinter.target, receiptPaperFor(claimed, receiptPrinter.width, routes.settings.cashDrawer, formatted.text));
    } else {
      await printFn(formatted.title, formatted.text);
    }
    await ackPrinted(claimed.id);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await ackFailed(claimed.id, message || "No printer is set up on this till");
    } catch {
      // Peak already owns the job; a second ack failure must not look like a send failure.
    }
    return { ok: false, error: message || "No printer is set up on this till" };
  }
}

/**
 * After Peak creates print jobs (send, settle, reprint), this till claims
 * each pending job addressed to its outlet. Another till that already
 * claimed one gets a 409, which is success for the platform: only one
 * physical copy is ever produced.
 */
export async function processPendingPrintJobs(
  _propertyId: string,
  sourceId?: string,
  printFn: (title: string, text: string) => Promise<void> = defaultPrint,
  routes?: KitchenPrintRoutes,
): Promise<PrintResult[]> {
  let jobs: POSPrintJob[];
  try {
    jobs = await listPrintJobs("PENDING", sourceId);
  } catch (error) {
    return [printFailure(error)];
  }
  const mine = sourceId ? jobs.filter((job) => String(job.sourceId) === sourceId) : jobs;
  const results: PrintResult[] = [];
  for (const job of mine) {
    results.push({ ...(await processPrintJob(job, printFn, routes)), jobType: job.jobType });
  }
  return results;
}
