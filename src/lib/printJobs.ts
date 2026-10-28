import { PRINT_RECOVERY_WORDS } from "../print/printQueueWords";
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
import type { POSFulfilment, POSPrintJob, PrintJobStatus } from "./posContracts";
import { kitchenTicketBytes } from "../print/kitchenTicket";
import { formatVoidSlip, voidSlipBytes, voidSlipFromPrintDocument } from "../print/voidTicket";
import { paperFromPrintDocument, type KitchenPrintRoutes } from "../print/kitchenRouting";
import { stationCopiesFor, printerFor, stationPrintsNoPaper, type PrinterChoice, type PrinterTarget } from "../print/printerSettings";
import { hotelHere, receiptPaperFor } from "../print/receiptRouting";
import { cachedBillLogo } from "../print/billLogo";
import { testBusinessNow } from "./testBusiness";
import { markText, type PaperMark } from "../print/testMark";
import { preparedPaper } from "../print/preparedPreview";
import { inspectNativePrint, nativePrintOnce, usesNativePrintJournal } from "../print/nativePrintJournal";
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
            fulfilment: row.fulfilment === "DIRECT" || row.fulfilment === "PICKED" || row.fulfilment === "PREPARED" ? row.fulfilment as POSFulfilment : undefined,
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
    askForTable: typeof document.askForTable === "boolean" ? document.askForTable : undefined,
    guestCount: typeof document.guestCount === "number" ? document.guestCount : undefined,
    station: typeof document.station === "string" ? document.station : undefined,
    notes: typeof document.notes === "string" ? document.notes : undefined,
    waiterName: typeof document.waiterName === "string" ? document.waiterName : undefined,
    sentByName: typeof document.sentByName === "string" ? document.sentByName : undefined,
    sentAt: typeof document.sentAt === "string" ? document.sentAt : undefined,
    roundNumber: typeof document.roundNumber === "number" ? document.roundNumber : undefined,
    copy: document.copy === true,
    printedAgainByName: typeof document.printedAgainByName === "string" ? document.printedAgainByName : undefined,
    printedAgainAt: typeof document.printedAgainAt === "string" ? document.printedAgainAt : undefined,
    lines,
  };
}

function copyDocument(job: POSPrintJob): POSPrintJob {
  if (!job.reprintedFromId) return job;
  return { ...job, document: { ...job.document, copy: true, printedAgainAt: job.document.printedAgainAt ?? job.createdAt, originalDocumentId: job.reprintedFromId } };
}
export function formatPrintDocument(job: POSPrintJob): { title: string; text: string } {
  const formatted = formatJobDocument(copyDocument(job));
  if (job.reprintedFromId && !/^.*COPY.*$/m.test(formatted.text)) formatted.text = `*** COPY ***\n${formatted.text}`;
  return formatted;
}
function formatJobDocument(job: POSPrintJob): { title: string; text: string } {
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
function printJobIdempotencyKey(jobId: string, action: "claim" | "printed" | "failed", attempt: number): string {
  return `pos-print-job:${jobId}:${action}:${attempt}`;
}

export async function claimPrintJob(jobId: string, attempt = 1): Promise<POSPrintJob> {
  return request(`/api/v1/pos/print-jobs/${jobId}/claim`, {
    method: "POST",
    headers: { "Idempotency-Key": printJobIdempotencyKey(jobId, "claim", attempt) },
  });
}

export async function ackPrinted(jobId: string, attempt = 1): Promise<POSPrintJob> {
  return request(`/api/v1/pos/print-jobs/${jobId}/printed`, {
    method: "POST",
    headers: { "Idempotency-Key": printJobIdempotencyKey(jobId, "printed", attempt) },
    body: JSON.stringify({ attempt }),
  });
}

export async function ackFailed(jobId: string, error: string, attempt = 1): Promise<POSPrintJob> {
  return request(`/api/v1/pos/print-jobs/${jobId}/failed`, {
    method: "POST",
    headers: { "Idempotency-Key": printJobIdempotencyKey(jobId, "failed", attempt) },
    body: JSON.stringify({ error, attempt }),
  });
}

/** One paper as this till makes it: bytes for a thermal printer, text for the system's own, or none here. */
export type TillPaper =
  | { kind: "none"; why: "kitchen-off" | "station-off" }
  | { kind: "thermal"; target: PrinterTarget; width: number; bytes: Uint8Array }
  | { kind: "system"; title: string; text: string };

/** Where this till sends a job, decided from its settings alone: no paper is built. */
type PaperRoute =
  | { kind: "none"; why: "kitchen-off" | "station-off" }
  | { kind: "kitchen"; printer: PrinterChoice }
  | { kind: "receipt"; printer: PrinterChoice }
  | { kind: "system" };

function paperRoute(job: POSPrintJob, routes?: KitchenPrintRoutes): PaperRoute {
  // A void slip goes where the station's kitchen tickets go, by the same settings.
  const kitchen = (job.jobType === KITCHEN_TICKET || job.jobType === KITCHEN_VOID) && routes !== undefined;
  // Paper kitchen tickets off on this till (its kitchen has a screen): the job
  // is left for a till that prints them, never claimed and dropped.
  if (kitchen && !routes.settings.kitchenTickets) return { kind: "none", why: "kitchen-off" };
  // No paper for this station on this till (a bar whose bartender pours what they ring up): left, like the above.
  if (kitchen && stationPrintsNoPaper(routes.settings, job.document.station)) return { kind: "none", why: "station-off" };
  const station = typeof job.document.station === "string" ? job.document.station : undefined;
  const printer = kitchen ? printerFor(routes.settings, station) : null;
  if (kitchen && printer) return { kind: "kitchen", printer };
  const receiptPrinter = (job.jobType === RECEIPT || job.jobType === REFUND_RECEIPT || job.jobType === BILL) ? routes?.settings.receipt : null;
  if (routes && receiptPrinter) return { kind: "receipt", printer: receiptPrinter };
  return { kind: "system" };
}

/**
 * The paper this till makes of a job, and where it goes: the one place that
 * decides, for printing and for the preview of it (owner, 2026-10-21), so
 * the preview is the paper. Building it may throw on a document it can't
 * read; callers catch that.
 */
export function paperFor(job: POSPrintJob, routes?: KitchenPrintRoutes): TillPaper {
  return preparedPaper(job) ?? buildPaperFor(job, routes);
}

export function buildPaperFor(job: POSPrintJob, routes?: KitchenPrintRoutes, mark?: PaperMark): TillPaper {
  const route = paperRoute(job, routes);
  if (route.kind === "none") return route;
  // Known once, from the catalogue this till last heard (kept for offline): a test business's papers say so.
  // A sample paper (Status, Print sample papers) is marked SAMPLE instead.
  const testBusiness: PaperMark = mark ?? testBusinessNow();
  if (route.kind === "kitchen") {
    // A thermal printer of the kitchen's: the ticket in large type, with a cut (S8a).
    const { target, width } = route.printer;
    const bytes = job.jobType === KITCHEN_VOID
      ? voidSlipBytes({ ...voidSlipFromPrintDocument(job.document), testBusiness }, width)
      : kitchenTicketBytes({ ...paperFromPrintDocument(job.document, routes?.tagsOf), testBusiness }, width, routes?.settings);
    const count = job.jobType === KITCHEN_TICKET && routes ? stationCopiesFor(routes.settings, typeof job.document.station === "string" ? job.document.station : undefined) : 1;
    if (count > 1 && bytes.length > 0) {
      const extra = Array.from({ length: count - 1 }, (_, n) =>
        kitchenTicketBytes({ ...paperFromPrintDocument(job.document, routes?.tagsOf), testBusiness, extraCopy: { index: n + 2, of: count } }, width, routes?.settings));
      const combined = new Uint8Array(bytes.length + extra.reduce((sum, page) => sum + page.length, 0));
      combined.set(bytes);
      let offset = bytes.length;
      for (const page of extra) { combined.set(page, offset); offset += page.length; }
      return { kind: "thermal", target, width, bytes: combined };
    }
    return { kind: "thermal", target, width, bytes };
  }
  const formatted = formatPrintDocument(job);
  if (route.kind === "receipt") {
    // The thermal receipt printer: columns, a cut, and the cash drawer for cash on an original (S8b).
    const { target, width } = route.printer;
    return { kind: "thermal", target, width, bytes: receiptPaperFor(copyDocument(job), width, routes?.settings.cashDrawer ?? false, formatted.text, route.printer.billLogo ? cachedBillLogo(routes?.settings.billLogoUrl, width) : undefined, testBusiness) };
  }
  if (job.jobType === KITCHEN_TICKET && routes) {
    const count = stationCopiesFor(routes.settings, typeof job.document.station === "string" ? job.document.station : undefined);
    if (count > 1) {
      const extra = Array.from({ length: count - 1 }, (_, n) =>
        formatKitchenTicket({ ...ticketCopyFromPrintDocument(copyDocument(job).document), extraCopy: { index: n + 2, of: count } }));
      return { kind: "system", title: formatted.title, text: [formatted.text, ...extra].map((page) => markText(page, testBusiness)).join("\n\f\n") };
    }
  }
  return { kind: "system", title: formatted.title, text: markText(formatted.text, testBusiness) };
}

export async function processPrintJob(
  job: POSPrintJob,
  printFn: (title: string, text: string) => Promise<void> = defaultPrint,
  routes?: KitchenPrintRoutes,
): Promise<PrintResult> {
  const printSession = getOperationalSession();
  const sameSession = () => getOperationalSession() === printSession;
  if (job.status === "PRINTED" || job.status === "ON_FILE") return { ok: true };
  if (job.status === "CLAIMED" && job.claimedByTerminalId !== getOperationalSession()?.terminalId) return { ok: true };
  if ((preparedPaper(job) ?? paperRoute(job, routes)).kind === "none" && job.status !== "CLAIMED") return { ok: true };
  let claimed: POSPrintJob;
  try {
    claimed = job.status === "PENDING" || job.status === "FAILED" ? await claimPrintJob(job.id, job.attempts + 1) : job;
  } catch (error) {
    // Another till won SKIP LOCKED. That till prints; this one must not.
    if (error instanceof PrintJobRequestError && error.status === 409) {
      return { ok: true };
    }
    return printFailure(error);
  }
  if (!sameSession()) return { ok: false, error: PRINT_RECOVERY_WORDS.sessionChanged };
  let knownNotSent = !usesNativePrintJournal();
  try {
    if (usesNativePrintJournal()) {
      const evidence = await inspectNativePrint(claimed.id, printSession);
      if (!sameSession()) return { ok: false, error: PRINT_RECOVERY_WORDS.sessionChanged };
      if (evidence?.state === "unknown") return { ok: false, error: PRINT_RECOVERY_WORDS.unknown };
      if (evidence?.state !== "accepted") {
        // Layout preparation has no physical side effect. A layout failure
        // here is safely retryable; uncertainty starts at native dispatch.
        knownNotSent = true;
        const paper = paperFor(claimed, routes);
        if (paper.kind === "none") return { ok: true };
        knownNotSent = false;
        const result = await nativePrintOnce(claimed.id, claimed.attempts, paper, printSession);
        if (result.state === "unknown" || result.state === "reserved") return { ok: false, error: PRINT_RECOVERY_WORDS.unknown };
        if (result.state === "not_sent") {
          knownNotSent = true;
          throw new Error(result.message ?? PRINT_RECOVERY_WORDS.offlinePrinter);
        }
      }
    } else {
      const paper = paperFor(claimed, routes);
      if (paper.kind === "thermal" && routes) await routes.printRaw(paper.target, paper.bytes);
      else if (paper.kind === "system") await printFn(paper.title, paper.text);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!sameSession()) return { ok: false, error: PRINT_RECOVERY_WORDS.sessionChanged };
    if (!knownNotSent) return { ok: false, error: PRINT_RECOVERY_WORDS.unconfirmed };
    try {
      await ackFailed(claimed.id, message || "No printer is set up on this till", claimed.attempts);
    } catch {
      // Peak already owns the job; a second ack failure must not look like a send failure.
    }
    return { ok: false, error: message || "No printer is set up on this till" };
  }
  if (!sameSession()) return { ok: false, error: PRINT_RECOVERY_WORDS.sessionChanged };
  try {
    await ackPrinted(claimed.id, claimed.attempts);
    return { ok: true };
  } catch {
    // The transport already accepted this paper. Keep CLAIMED and retry only
    // its acknowledgement; marking it FAILED would invite a duplicate copy.
    return { ok: false, error: PRINT_RECOVERY_WORDS.accepted };
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
  const batchSession = getOperationalSession();
  let jobs: POSPrintJob[];
  try {
    jobs = await listPrintJobs("PENDING", sourceId);
  } catch (error) {
    return [printFailure(error)];
  }
  const mine = sourceId ? jobs.filter((job) => String(job.sourceId) === sourceId) : jobs;
  const results: PrintResult[] = [];
  for (const job of mine) {
    if (getOperationalSession() !== batchSession) { results.push({ ok: false, error: PRINT_RECOVERY_WORDS.sessionChanged }); break; }
    results.push({ ...(await processPrintJob(job, printFn, routes)), jobType: job.jobType });
  }
  return results;
}
