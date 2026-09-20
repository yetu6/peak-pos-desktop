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
import type { POSPrintJob, PrintJobStatus } from "./posContracts";

/**
 * Peak's only two certified `pos_print_jobs.job_type` values (schema 86,
 * `internal/pos/operations.go` and `internal/pos/receipts.go`): a kitchen
 * ticket enqueued at `sendOrder`, and a receipt enqueued at settlement (and
 * again, chained, at `/receipt/reprint`). There is no `void_ticket` or
 * `shift_report` job type anywhere in the backend — those were invented UI
 * that could never receive a real job and have been removed. A kitchen
 * ticket itself has no reprint endpoint in the certified V1 contract; only
 * a settled order's receipt can be reprinted (`useReprintReceipt`).
 */
const KITCHEN_TICKET = "KITCHEN_TICKET";
const RECEIPT = "RECEIPT";

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
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
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
    tableNumber:
      typeof document.tableLabel === "string"
        ? document.tableLabel
        : typeof document.tableNumber === "string"
          ? document.tableNumber
          : undefined,
    serviceType: typeof document.serviceType === "string" ? document.serviceType : undefined,
    notes: typeof document.notes === "string" ? document.notes : undefined,
    waiterName: typeof document.waiterName === "string" ? document.waiterName : undefined,
    sentAt: typeof document.sentAt === "string" ? document.sentAt : undefined,
    lines,
  };
}

export function formatPrintDocument(job: POSPrintJob): { title: string; text: string } {
  if (job.jobType === RECEIPT) {
    return { title: "yetu-invoice", text: formatReceipt(receiptCopyFromPrintDocument(job.document)) };
  }
  if (job.jobType === KITCHEN_TICKET) {
    return { title: "yetu-kitchen-ticket", text: formatKitchenTicket(ticketCopyFromPrintDocument(job.document)) };
  }
  // An unrecognized job type must still be printable rather than dropped —
  // fall back to the generic ticket formatter instead of failing the job.
  return { title: `yetu-${job.jobType.toLowerCase().replaceAll("_", "-")}`, text: formatKitchenTicket(ticketCopyFromPrintDocument(job.document)) };
}

async function defaultPrint(title: string, text: string): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error("No printer is configured");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("print_document", { document: { title, text } });
}

/** Peak's job status column stores PENDING/CLAIMED/PRINTED/FAILED exactly —
 *  the query filter must match that case or every row is silently excluded. */
export async function listPrintJobs(status: PrintJobStatus | "" = "PENDING"): Promise<POSPrintJob[]> {
  const query = status ? new URLSearchParams({ status }).toString() : "";
  return request(`/api/v1/pos/print-jobs${query ? `?${query}` : ""}`);
}

export async function claimPrintJob(jobId: string): Promise<POSPrintJob> {
  return request(`/api/v1/pos/print-jobs/${jobId}/claim`, { method: "POST" });
}

export async function ackPrinted(jobId: string): Promise<POSPrintJob> {
  return request(`/api/v1/pos/print-jobs/${jobId}/printed`, { method: "POST" });
}

export async function ackFailed(jobId: string, error: string): Promise<POSPrintJob> {
  return request(`/api/v1/pos/print-jobs/${jobId}/failed`, { method: "POST", body: JSON.stringify({ error }) });
}

export async function processPrintJob(
  job: POSPrintJob,
  printFn: (title: string, text: string) => Promise<void> = defaultPrint,
): Promise<PrintResult> {
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
    await printFn(formatted.title, formatted.text);
    await ackPrinted(claimed.id);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await ackFailed(claimed.id, message || "No printer is configured");
    } catch {
      // Peak already owns the job; a second ack failure must not look like a send failure.
    }
    return { ok: false, error: message || "No printer is configured" };
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
): Promise<PrintResult[]> {
  let jobs: POSPrintJob[];
  try {
    jobs = await listPrintJobs("PENDING");
  } catch (error) {
    return [printFailure(error)];
  }
  const mine = sourceId ? jobs.filter((job) => String(job.sourceId) === sourceId) : jobs;
  const results: PrintResult[] = [];
  for (const job of mine) {
    results.push(await processPrintJob(job, printFn));
  }
  return results;
}
