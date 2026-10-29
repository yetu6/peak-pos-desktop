import { MINOR_PER_MAJOR } from "../lib/money";
import { getOperationalSession } from "../lib/operationalSession";
import { buildPaperFor, type TillPaper } from "../lib/printJobs";
import type { POSPrintJob } from "../lib/posContracts";
import type { KitchenPrintRoutes } from "./kitchenRouting";
import { prepareBillBranding } from "./billBranding";
import { loadPrinterSettings, printRawToPrinter } from "./printerStore";
import { printerWords, type PrinterSettings, type PrinterTarget } from "./printerSettings";
import { testBusinessNow } from "../lib/testBusiness";
import { SAMPLE_MARK, TEST_MARK } from "./testMark";

/**
 * Print sample papers (owner, 2026-10-28): the installer sees every kind of
 * paper on the customer's real printers without a sale in the customer's
 * books. Each sample is the real paper — built by the same builders as a
 * real one, from a fixed, plainly fake order — marked SAMPLE top and
 * bottom and sent where that kind of paper normally goes. Purely local:
 * nothing here calls Yetu, so no order, payment, refund or print job exists.
 */

export type SampleKind = "bill" | "receipt" | "kitchen" | "bar" | "refund" | "void";

export const SAMPLE_KINDS: readonly { kind: SampleKind; label: string }[] = [
  { kind: "bill", label: "Bill" },
  { kind: "receipt", label: "Paid bill" },
  { kind: "kitchen", label: "Kitchen ticket" },
  { kind: "bar", label: "Bar ticket" },
  { kind: "refund", label: "Refund slip" },
  { kind: "void", label: "Cancelled item slip" },
];

/** Named settings: what the sample order looks like when this till has not yet heard the business's own. */
export const SAMPLE_DEFAULTS = { currency: "TZS", vatRateBp: 1800, pricesIncludeTax: false } as const;
/** Named setting: the sample order, in major units of the currency. */
export const SAMPLE_ITEMS = [
  { name: "Sample drink", quantity: 2, unitMajor: 3_000, station: "BAR" },
  { name: "Sample dish", quantity: 1, unitMajor: 12_000, station: "GENERAL" },
] as const;

const FACTS_KEY = "yetu-sample-facts";

interface Facts { currency?: string; vatRateBp?: number; pricesIncludeTax?: boolean }

/** What this till last heard about the business's money and VAT, kept for offline (never a price list). */
export function rememberSampleFacts(property: string | null | undefined, outlet: string | null | undefined, facts: Facts): void {
  if (!property || !outlet) return;
  try {
    const key = `${FACTS_KEY}:${property}:${outlet}`;
    const before = JSON.parse(localStorage.getItem(key) ?? "{}") as Facts;
    const next: Facts = { ...before };
    if (typeof facts.currency === "string" && facts.currency) next.currency = facts.currency;
    if (Number.isSafeInteger(facts.vatRateBp) && facts.vatRateBp! >= 0) next.vatRateBp = facts.vatRateBp;
    if (typeof facts.pricesIncludeTax === "boolean") next.pricesIncludeTax = facts.pricesIncludeTax;
    localStorage.setItem(key, JSON.stringify(next));
  } catch { /* storage unavailable: the named defaults apply */ }
}

function recalled(property: string | undefined, outlet: string | undefined): Facts {
  if (!property || !outlet) return {};
  try { return JSON.parse(localStorage.getItem(`${FACTS_KEY}:${property}:${outlet}`) ?? "{}") as Facts; } catch { return {}; }
}

/** The fake order's figures, whole minor units: VAT on top or inside the prices, as this business shows it. */
export function sampleFigures(facts: Facts = {}) {
  const currency = facts.currency ?? SAMPLE_DEFAULTS.currency;
  const rate = facts.vatRateBp ?? SAMPLE_DEFAULTS.vatRateBp;
  const inside = facts.pricesIncludeTax ?? SAMPLE_DEFAULTS.pricesIncludeTax;
  const lines = SAMPLE_ITEMS.map((item) => {
    const amount = item.quantity * item.unitMajor * MINOR_PER_MAJOR;
    // VAT in whole units of the currency, as a real bill shows it.
    const major = item.quantity * item.unitMajor;
    const tax = (inside ? Math.round((major * rate) / (10_000 + rate)) : Math.round((major * rate) / 10_000)) * MINOR_PER_MAJOR;
    return { name: item.name, quantity: item.quantity, station: item.station, totalMinor: inside ? amount : amount + tax, taxMinor: tax, netMinor: inside ? amount - tax : amount };
  });
  const taxMinor = lines.reduce((sum, line) => sum + line.taxMinor, 0);
  const totalMinor = lines.reduce((sum, line) => sum + line.totalMinor, 0);
  // Known only when this till has heard both the business's VAT rate and whether its prices hold the VAT.
  const known = typeof facts.vatRateBp === "number" && typeof facts.pricesIncludeTax === "boolean";
  return { currency, inside, known, lines, taxMinor, totalMinor, subtotalMinor: totalMinor - taxMinor };
}

function sampleJobs(facts: Facts, names: { property: string; outlet: string }, now: Date): Record<SampleKind, POSPrintJob> {
  const figures = sampleFigures(facts);
  const at = now.toISOString();
  const base = {
    propertyName: names.property,
    outletName: names.outlet,
    orderNumber: "SAMPLE",
    dailyNumber: 1,
    currency: figures.currency,
    serviceType: "DINE_IN",
    tableLabel: "Sample table",
    askForTable: true,
    pricesIncludeTax: figures.inside,
  };
  const money = {
    subtotalMinor: figures.subtotalMinor,
    taxMinor: figures.taxMinor,
    totalMinor: figures.totalMinor,
    discountMinor: 0,
  };
  const items = figures.lines.map((line) => ({ name: line.name, quantity: line.quantity, totalMinor: line.totalMinor, taxMinor: line.taxMinor, fulfilment: "PREPARED" }));
  const job = (jobType: string, document: Record<string, unknown>): POSPrintJob => ({
    id: `sample-${jobType}`,
    sourceType: "SAMPLE",
    sourceId: "sample",
    jobType,
    document,
    status: "PENDING",
    attempts: 0,
    createdAt: at,
  });
  const station = (name: string, only: string) => ({ ...base, station: name, items: items.filter((_, n) => figures.lines[n].station === only), sentAt: at, sentByName: "Sample", waiterName: "Sample" });
  return {
    bill: job("BILL", { ...base, ...money, kind: "BILL", items, paidMinor: 0, remainingMinor: figures.totalMinor, printedByName: "Sample", printedAt: at }),
    receipt: job("RECEIPT", { ...base, ...money, items, tenderMethod: "CASH", operatorName: "Sample", settledAt: at }),
    kitchen: job("KITCHEN_TICKET", station("GENERAL", "GENERAL")),
    bar: job("KITCHEN_TICKET", station("BAR", "BAR")),
    refund: job("REFUND_RECEIPT", {
      ...base,
      lines: items.map((line) => ({ name: line.name, quantity: line.quantity, totalMinor: line.totalMinor })),
      taxMinor: figures.taxMinor,
      totalMinor: figures.totalMinor,
      tenders: [{ paymentMethod: "CARD", amountMinor: figures.totalMinor }],
      reason: "Sample",
      refundedAt: at,
      initiatedByName: "Sample",
      authorizedByName: "Sample",
    }),
    void: job("KITCHEN_VOID", { ...station("GENERAL", "GENERAL"), reason: "Sample", askedByName: "Sample", approvedByName: "Sample", voidedAt: at }),
  };
}

export interface SampleResult {
  kind: SampleKind;
  label: string;
  ok: boolean;
  /** What happened to this paper, in words. */
  words: string;
}

export interface SampleSend {
  printRaw: (target: PrinterTarget, bytes: Uint8Array) => Promise<void>;
  printText: (title: string, text: string) => Promise<void>;
}

export const SAMPLES_ONLY_IN_TILL = "Sample papers can be printed only from the till app.";

const MONEY_PAPERS: readonly SampleKind[] = ["bill", "receipt", "refund"];
export const VAT_NOT_LOADED = "Not printed — VAT setting not loaded yet. Open any order once so this till learns it, then print again";

const ROUTED_BY_STATION: readonly SampleKind[] = ["kitchen", "bar", "void"];

const WHICH_PRINTER: Record<SampleKind, string> = { bill: "bill", receipt: "bill", refund: "bill", kitchen: "kitchen", void: "kitchen", bar: "bar" };

/** What a paper with no saved printer says. */
export function notSetWords(kind: SampleKind): string {
  return `Not printed — set the ${WHICH_PRINTER[kind]} printer in Printers and press Save`;
}

function whereWords(paper: TillPaper, kind: SampleKind): string {
  if (paper.kind === "thermal") return `sent to ${printerWords({ target: paper.target, width: paper.width as 32 | 48 })}`;
  const own = "sent to this computer's own printer";
  if (ROUTED_BY_STATION.includes(kind)) return `${own} (no ${kind === "bar" ? "bar" : "kitchen"} printer set up — set one in Printers)`;
  return `${own} (no bill printer set up — set one in Printers)`;
}

/**
 * Prints the chosen samples, one result each. A paper that can't be made
 * or sent says so on its own line and the others still print.
 */
export async function printSamplePapers(
  kinds: readonly SampleKind[],
  settings: PrinterSettings,
  send: SampleSend,
  now: Date = new Date(),
): Promise<SampleResult[]> {
  const session = getOperationalSession();
  const facts = recalled(session?.propertyId, session?.outletId);
  const names = { property: session?.propertyName?.trim() || "Your business", outlet: session?.outletName?.trim() || "Your outlet" };
  const jobs = sampleJobs(facts, names, now);
  const vatKnown = sampleFigures(facts).known;
  // A sample never opens the cash drawer: no cash moved.
  // A test business's sample carries both marks (SAMPLE, then TEST).
  const mark = testBusinessNow() ? `${SAMPLE_MARK}\n${TEST_MARK}` : SAMPLE_MARK;
  const routes: KitchenPrintRoutes = { settings: { ...settings, cashDrawer: false }, printRaw: send.printRaw };
  const results: SampleResult[] = [];
  for (const { kind, label } of SAMPLE_KINDS.filter((entry) => kinds.includes(entry.kind))) {
    try {
      // Money papers need the business's real VAT setting: never guess VAT on top.
      if (MONEY_PAPERS.includes(kind) && !vatKnown) {
        results.push({ kind, label, ok: false, words: VAT_NOT_LOADED });
        continue;
      }
      const paper = buildPaperFor(jobs[kind], routes, mark);
      if (paper.kind === "none") {
        results.push({ kind, label, ok: false, words: paper.why === "kitchen-off" ? "not printed — paper kitchen tickets are off on this till (turn them on in Printers)" : `not printed — this till prints no paper for ${kind === "bar" ? "the bar" : "this station"} (set a printer in Printers)` });
      } else if (paper.kind === "thermal") {
        await send.printRaw(paper.target, paper.bytes);
        results.push({ kind, label, ok: true, words: whereWords(paper, kind) });
      } else {
        // No saved printer for this paper: Windows page printing makes an unreadable strip on a thermal printer.
        results.push({ kind, label, ok: false, words: notSetWords(kind) });
      }
    } catch (error) {
      results.push({ kind, label, ok: false, words: `didn't print (${error instanceof Error ? error.message : String(error)})` });
    }
  }
  return results;
}

/** Sends the samples from the till app on this computer; a browser has no printer to send them to. */
export async function printSamplesFromTill(kinds: readonly SampleKind[]): Promise<{ available: false; words: string } | { available: true; results: SampleResult[] }> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return { available: false, words: SAMPLES_ONLY_IN_TILL };
  const settings = await prepareBillBranding(await loadPrinterSettings());
  const results = await printSamplePapers(kinds, settings, {
    printRaw: printRawToPrinter,
    printText: async (title, text) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("print_document", { document: { title, text } });
    },
  });
  return { available: true, results };
}
