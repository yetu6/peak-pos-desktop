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

export interface PosPrintJob {
  id: string;
  propertyId: string;
  outletId: string;
  jobType: string;
  sourceType: string;
  sourceId: string;
  reprint: boolean;
  status: string;
  document: Record<string, unknown>;
}

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

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new PrintJobRequestError(
      response.status,
      body || `Print job request failed (${response.status})`,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function printFailure(error: unknown): PrintResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function ticketCopyFromPrintDocument(document: Record<string, unknown>): KitchenTicketCopy {
  const lines = Array.isArray(document.lines)
    ? document.lines.flatMap((line) => {
        if (!line || typeof line !== "object") return [];
        const row = line as Record<string, unknown>;
        if (typeof row.name !== "string") return [];
        return [
          {
            name: row.name,
            quantity: String(row.quantity ?? "1"),
            note: typeof row.note === "string" ? row.note : undefined,
          },
        ];
      })
    : [];
  return {
    ticketNumber: typeof document.ticketNumber === "string" ? document.ticketNumber : undefined,
    orderNumber: typeof document.orderNumber === "string" ? document.orderNumber : undefined,
    tableNumber: typeof document.tableNumber === "string" ? document.tableNumber : undefined,
    sentAt: typeof document.sentAt === "string" ? document.sentAt : undefined,
    lines,
  };
}

export function formatPrintDocument(job: PosPrintJob): { title: string; text: string } {
  if (job.jobType === "receipt" || job.document.kind === "receipt") {
    return {
      title: "peak-receipt",
      text: formatReceipt(receiptCopyFromPrintDocument(job.document)),
    };
  }
  const copy = ticketCopyFromPrintDocument(job.document);
  return { title: `peak-${job.jobType.replaceAll("_", "-")}`, text: formatKitchenTicket(copy) };
}

async function defaultPrint(title: string, text: string): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error("No kitchen printer is configured");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("print_document", { document: { title, text } });
}

export async function listPrintJobs(
  propertyId: string,
  status = "pending,claimed",
): Promise<PosPrintJob[]> {
  const query = new URLSearchParams({ status });
  return request(`/api/v1/properties/${propertyId}/pos-print-jobs?${query.toString()}`);
}

export async function claimPrintJob(propertyId: string, jobId: string): Promise<PosPrintJob> {
  return request(`/api/v1/properties/${propertyId}/pos-print-jobs/${jobId}/claim`, {
    method: "POST",
  });
}

export async function ackPrinted(propertyId: string, jobId: string): Promise<PosPrintJob> {
  return request(`/api/v1/properties/${propertyId}/pos-print-jobs/${jobId}/printed`, {
    method: "POST",
  });
}

export async function ackFailed(
  propertyId: string,
  jobId: string,
  error: string,
): Promise<PosPrintJob> {
  return request(`/api/v1/properties/${propertyId}/pos-print-jobs/${jobId}/failed`, {
    method: "POST",
    body: JSON.stringify({ error }),
  });
}

export async function reprintPrintJob(propertyId: string, jobId: string): Promise<PosPrintJob> {
  return request(`/api/v1/properties/${propertyId}/pos-print-jobs/${jobId}/reprint`, {
    method: "POST",
  });
}

export async function processPrintJob(
  propertyId: string,
  job: PosPrintJob,
  printFn: (title: string, text: string) => Promise<void> = defaultPrint,
): Promise<PrintResult> {
  let claimed: PosPrintJob;
  try {
    claimed = job.status === "pending" ? await claimPrintJob(propertyId, job.id) : job;
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
    await ackPrinted(propertyId, claimed.id);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await ackFailed(propertyId, claimed.id, message || "No kitchen printer is configured");
    } catch {
      // Peak already owns the job; a second ack failure must not look like a send failure.
    }
    return { ok: false, error: message || "No kitchen printer is configured" };
  }
}

/**
 * After Peak creates print jobs (send, reprint), this till claims each pending
 * job. Another till that already claimed one will get a conflict, which is
 * success for the platform: only one physical copy.
 */
export async function processPendingPrintJobs(
  propertyId: string,
  sourceId?: string,
  printFn: (title: string, text: string) => Promise<void> = defaultPrint,
): Promise<PrintResult[]> {
  let jobs: PosPrintJob[];
  try {
    jobs = await listPrintJobs(propertyId, "pending");
  } catch (error) {
    return [printFailure(error)];
  }
  const mine = sourceId ? jobs.filter((job) => String(job.sourceId) === sourceId) : jobs;
  const results: PrintResult[] = [];
  for (const job of mine) {
    results.push(await processPrintJob(propertyId, job, printFn));
  }
  return results;
}

export async function reprintSource(
  propertyId: string,
  sourceId: string,
  printFn: (title: string, text: string) => Promise<void> = defaultPrint,
): Promise<PrintResult> {
  let jobs: PosPrintJob[];
  try {
    jobs = await listPrintJobs(propertyId, "printed,failed");
  } catch (error) {
    return printFailure(error);
  }
  const original = jobs
    .filter((job) => String(job.sourceId) === sourceId && !job.reprint)
    .sort((a, b) => a.id.localeCompare(b.id))
    .at(-1);
  if (!original) {
    return { ok: false, error: "No print job exists for this ticket yet" };
  }
  try {
    const reprint = await reprintPrintJob(propertyId, original.id);
    return processPrintJob(propertyId, reprint, printFn);
  } catch (error) {
    return printFailure(error);
  }
}
