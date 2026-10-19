import type { PrintResult } from "../lib/kitchenTicketPrint";
import { getOperationalSession } from "../lib/operationalSession";

/**
 * What a print that didn't happen says on Sell, once for each person signed
 * in and each reason: a till with no printer set up would otherwise say it
 * after every sale, and before F-233 it said nothing at all.
 */
const said = new Set<string>();

export function printProblemOnce(results: readonly PrintResult[], what: "kitchen ticket" | "receipt"): string | null {
  const failed = results.find((result) => !result.ok);
  if (!failed) return null;
  const reason = (failed.error ?? "").trim().replace(/\.$/, "");
  const key = [getOperationalSession()?.token ?? "", what, reason].join("|");
  if (said.has(key)) return null;
  said.add(key);
  const why = reason ? `: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : "";
  return `The ${what} didn't print${why}. A manager sets up printers in Manager, Printers.`;
}

/** A copy of a receipt Yetu made but the printer didn't print (F-233). */
export function copyNotPrintedWords(reason: string): string {
  const why = reason.trim().replace(/\.$/, "");
  return `The copy didn't print${why ? `: ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ""}. Yetu has the receipt; try again once the printer is ready.`;
}
