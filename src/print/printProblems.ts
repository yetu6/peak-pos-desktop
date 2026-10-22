import { uncertainDeliveryWords } from "./printQueueWords";
import type { PrintResult } from "../lib/kitchenTicketPrint";
import { getOperationalSession } from "../lib/operationalSession";

/**
 * What a print that didn't happen says on Sell, once for each person signed
 * in and each reason: a till with no printer set up would otherwise say it
 * after every sale, and before F-233 it said nothing at all.
 */
const said = new Set<string>();

/**
 * Where a manager sets up this till's printers: the Printers card on Status
 * (Diagnostics, for a manager). The till has no Manager page (F-246).
 */
export const PRINTERS_PLACE = "Status (F12), under Printers";

export function printProblemOnce(results: readonly PrintResult[], what: "kitchen ticket" | "bill" | "cancel slip"): string | null {
  // A void reports its own slips: an older paper waiting on the same order
  // that failed is not "the cancel slip" (review 2026-10-21).
  const failed = results.find((result) => !result.ok && (what !== "cancel slip" || result.jobType === undefined || result.jobType === "KITCHEN_VOID"));
  if (!failed) return null;
  const uncertain = uncertainDeliveryWords(failed.error ?? "");
  if (uncertain) return uncertain;
  const reason = (failed.error ?? "").trim().replace(/\.$/, "");
  const key = [getOperationalSession()?.token ?? "", what, reason].join("|");
  if (said.has(key)) return null;
  said.add(key);
  const why = reason ? `: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : "";
  return `The ${what} didn't print${why}. A manager sets up printers in ${PRINTERS_PLACE}.`;
}

/** A copy of a bill Yetu made but the printer didn't print (F-233). */
export function copyNotPrintedWords(reason: string): string {
  const uncertain = uncertainDeliveryWords(reason);
  if (uncertain) return uncertain;
  const why = reason.trim().replace(/\.$/, "");
  return `The copy didn't print${why ? `: ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ""}. Yetu has the bill; try again once the printer is ready.`;
}

/** The cash drawer didn't open after a cash payment (2026-10-20: no paper opens it any more). */
export function drawerNotOpenedWords(reason: string): string {
  const why = reason.trim().replace(/\.$/, "");
  return `The cash drawer didn't open${why ? `: ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ""}. Open it with its key; a manager checks the printer in ${PRINTERS_PLACE}.`;
}

/** A bill Yetu made but the printer didn't print (fbc-peak #288). */
export function billNotPrintedWords(reason: string): string {
  const uncertain = uncertainDeliveryWords(reason);
  if (uncertain) return uncertain;
  const why = reason.trim().replace(/\.$/, "");
  return `The bill didn't print${why ? `: ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ""}. Print it again once the printer is ready; a manager sets up printers in ${PRINTERS_PLACE}.`;
}
