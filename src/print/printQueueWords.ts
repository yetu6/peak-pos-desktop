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
export const PRINT_RESOLUTION_WORDS = {
 confirm: "I checked: the paper printed",
 hint: "Only confirm after reading the paper at the printer. If it did not print, request a marked copy from the order.",
};
export const PRINT_RECOVERY_WORDS = {
 sessionChanged: "Printing stopped because the signed-in till changed. Check the paper on the original till.",
 unknown: "Check the printer before making a copy. The previous paper may have printed; automatic retry is stopped.",
 unconfirmed: "Check the printer before making a copy. Printing could not be confirmed; automatic retry is stopped.",
 accepted: "The printer accepted this paper. Confirmation is waiting; check the paper before making a copy.",
 offlinePrinter: "The printer did not answer. Check it is on and try again.",
 signIn: "Sign in before checking the printer.",
 differentTill: "Check this paper on the till that started printing it.",
 checkFirst: "Check printing again before confirming this paper.",
};
export function uncertainDeliveryWords(reason:string):string|null {
 return reason.startsWith("Check the printer before making a copy.") || reason.startsWith("The printer accepted this paper.") ? reason : null;
}
