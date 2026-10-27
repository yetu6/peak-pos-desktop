import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseAst } from "vite";
import { describe, expect, it } from "vitest";
import { readable, PAPER_58MM, PAPER_80MM } from "./print/escpos";
import { kitchenTicketBytes } from "./print/kitchenTicket";
import { paperFromPrintDocument } from "./print/kitchenRouting";
import { receiptBytes, textPaperBytes } from "./print/receipt";
import { formatVoidSlip, voidSlipBytes, voidSlipFromPrintDocument } from "./print/voidTicket";
import { formatKitchenTicket } from "./lib/kitchenTicketPrint";
import { formatReceipt, receiptCopyFromPrintDocument } from "./lib/receiptPrint";
import { formatRefundReceipt, refundReceiptCopyFromPrintDocument } from "./lib/refundReceiptPrint";

/** Owner: staff read "Cancel item" / "Cancel order", never "void"; the API and data keep `void` as a name. */
const VOID_WORD = /\bvoid(?:ed|ing|s)?\b/i;
/** The API's own codes, compared and sent but never shown. A new one is added here on purpose. */
const API_CODES = new Set(["VOID", "VOIDED"]);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(path) && !/\.test\.|visual/.test(path) ? [path] : [];
  });
}

const CODE_TOKEN = /^[-_.]*[a-z][A-Za-z0-9]*(?:[-_.]+[a-z0-9][A-Za-z0-9]*)*[-_.]*$/;

/**
 * A name a program reads: `void`, `void-item-dialog`, `voidApprovedByName`, `pos.order.void`,
 * `/orders/{id}/void`, or a class list such as `y-kticket__item y-kticket__item--voided`. In a
 * list every void word must be joined to others by - _ or ., so "void this item" is still words.
 */
function codeName(text: string): boolean {
  if (API_CODES.has(text) || (text.includes("/") && !/\s/.test(text))) return true;
  const tokens = text.trim().split(/\s+/);
  if (!tokens.every((token) => CODE_TOKEN.test(token))) return false;
  return tokens.length === 1 || tokens.filter((token) => VOID_WORD.test(token)).every((token) => /[-_.]/.test(token));
}

/** Every string a person could read: literals, template text and JSX text. Types and import paths are not read by anyone. */
function readableStrings(path: string): string[] {
  const ast = parseAst(readFileSync(path, "utf8"), { lang: path.endsWith(".tsx") ? "tsx" : "ts" });
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown> & { type?: string };
    if (typeof n.type === "string" && n.type.startsWith("TS") && n.type !== "TSAsExpression" && n.type !== "TSSatisfiesExpression" && n.type !== "TSNonNullExpression") return;
    if (n.type === "ImportDeclaration" || n.type === "ExportAllDeclaration") return;
    if (n.type === "Literal" && typeof n.value === "string") out.push(n.value);
    if (n.type === "JSXText" && typeof n.value === "string") out.push(n.value.trim());
    if (n.type === "TemplateElement") out.push(String((n.value as { cooked?: string }).cooked ?? ""));
    for (const [key, child] of Object.entries(n)) if (key !== "type") walk(child);
  };
  walk(ast);
  return out;
}

it("labels every escape Back, never Cancel or Close", () => {
  const failures: string[] = [];
  for (const path of files("src")) {
    const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const match of source.matchAll(/>\s*(Cancel|Close)\s*</g)) failures.push(`${path}: ${match[1]}`);
  }
  expect(failures).toEqual([]);
});

it("never says void in anything staff can read on screen", () => {
  const failures = files("src").flatMap((path) =>
    readableStrings(path)
      .filter((text) => VOID_WORD.test(text) && !codeName(text))
      .map((text) => `${path}: ${text}`),
  );
  expect(failures).toEqual([]);
});

/**
 * Owner, 2026-10-20: Yetu prints a BILL, never a receipt (the restaurant's own EFD gives the tax receipt). Staff read
 * "bill" on every screen; the only receipt they are told of is the EFD's.
 */
it("never calls Yetu's paper a receipt in anything staff can read on screen", () => {
  const failures = files("src").flatMap((path) =>
    readableStrings(path)
      .filter((text) => /\breceipts?\b/i.test(text) && !codeName(text) && !/\b(?:RECEIPT|REFUND_RECEIPT)\b/.test(text) && !/\bEFD\b/.test(text))
      .map((text) => `${path}: ${text}`),
  );
  expect(failures).toEqual([]);
});

// What fbc-peak writes for each paper (createVoidPrintJobs 00125, kitchen rounds, bills, refunds).
const SLIP = {
  orderNumber: "POS-MAIN-261021-1", dailyNumber: 1, station: "BAR", voidedAt: "2026-10-21T08:30:00Z", tableLabel: "7",
  serviceType: "DINE_IN", waiterName: "Baraka Mushi", askedByName: "Baraka Mushi", approvedByName: "Neema Kweka",
  reason: "Spilled", wholeOrder: false, items: [{ name: "Tusker", quantity: 1, roundNumber: 2, modifiers: [{ name: "Cold" }] }],
};
const ROUND = {
  station: "KITCHEN", dailyNumber: 6, orderNumber: "POS-MAIN-6", roundNumber: 2, serviceType: "DINE_IN", tableLabel: "8",
  waiterName: "Amina", sentAt: "2026-10-22T10:45:00Z", copy: true, printedAgainByName: "Amina", printedAgainAt: "2026-10-22T10:52:00Z",
  items: [{ name: "Chicken biryani", quantity: 2, fulfilment: "PREPARED", modifiers: [{ name: "Extra spicy" }] }, { name: "Soda", quantity: 1, fulfilment: "PICKED" }],
};
const BILL = {
  kind: "BILL", propertyName: "Bahari QA Hotel", outletName: "Bahari Restaurant & Bar", dailyNumber: 6, currency: "TZS",
  items: [{ name: "Chicken biryani", quantity: 2, totalMinor: 2400000 }], totalMinor: 2400000, taxMinor: 366102,
};
const REFUND = {
  propertyName: "Bahari QA Hotel", orderNumber: "POS-MAIN-6", dailyNumber: 6, refundedAt: "2026-10-22T11:10:00Z", currency: "TZS",
  lines: [{ name: "Soda", quantity: 1, totalMinor: 200000 }], totalMinor: 200000, tenders: [{ paymentMethod: "CASH", amountMinor: 200000 }],
  reason: "Wrong drink", initiatedByName: "Amina", authorizedByName: "Neema Kweka",
};

describe.each([PAPER_58MM, PAPER_80MM])("every paper at %s columns", (width) => {
  const papers: Record<string, string> = {
    "cancelled item": readable(voidSlipBytes(voidSlipFromPrintDocument(SLIP), width)),
    "cancelled order": readable(voidSlipBytes(voidSlipFromPrintDocument({ ...SLIP, wholeOrder: true }), width)),
    "kitchen round copy": readable(kitchenTicketBytes(paperFromPrintDocument(ROUND), width)),
    "bar round": readable(kitchenTicketBytes(paperFromPrintDocument({ ...ROUND, station: "BAR", copy: false }), width)),
    bill: readable(receiptBytes(receiptCopyFromPrintDocument(BILL), width)),
    refund: readable(textPaperBytes(formatRefundReceipt(refundReceiptCopyFromPrintDocument(REFUND)), width)),
  };
  it.each(Object.keys(papers))("%s never says void", (kind) => {
    expect(papers[kind]).not.toMatch(VOID_WORD);
    expect(papers[kind].length).toBeGreaterThan(40);
  });
});

it("system-printer papers never say void", () => {
  const papers = [
    formatVoidSlip(voidSlipFromPrintDocument(SLIP)),
    formatVoidSlip(voidSlipFromPrintDocument({ ...SLIP, wholeOrder: true })),
    formatKitchenTicket({ station: "KITCHEN", dailyNumber: 6, roundNumber: 2, copy: true, printedAgainByName: "Amina", printedAgainAt: ROUND.printedAgainAt, lines: [{ name: "Chicken biryani", quantity: "2" }] }),
    formatReceipt(receiptCopyFromPrintDocument(BILL)),
    formatRefundReceipt(refundReceiptCopyFromPrintDocument(REFUND)),
  ];
  for (const text of papers) expect(text).not.toMatch(VOID_WORD);
});
