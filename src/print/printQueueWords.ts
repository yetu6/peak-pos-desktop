import type { POSPrintJob } from "../lib/posContracts";
import { stationWords } from "../kitchen/kitchenWords";

export const PRINT_QUEUE_WORDS = {
 title: "Papers waiting",
 checking: "Checking papers…",
 empty: "No papers waiting.",
 failed: "Not printed",
 claimed: "Printing needs checking",
 pending: "Waiting to print",
 retry: "Print again",
 check: "Check printing",
 refresh: "Check papers",
 working: "Checking…",
 loadFailed: "The waiting papers couldn't be loaded. Check the connection and try again.",
 accepted: "The printer accepted the paper. Check it came out.",
};
export function queuedPaperName(job: POSPrintJob): string {
 const order = typeof job.document.dailyNumber === "number" ? `Order ${job.document.dailyNumber}` : "Order paper";
 const kind = job.jobType === "BILL" || job.jobType === "RECEIPT" ? "Bill" : job.jobType === "REFUND_RECEIPT" ? "Refund slip" : typeof job.document.station === "string" ? stationWords(job.document.station) : "Kitchen";
 return `${order} · ${kind}`;
}
