import { describe, expect, it } from "vitest";
import { PAPER_58MM, PAPER_80MM, readable } from "./escpos";
import { receiptBytes, textPaperBytes } from "./receipt";
import { formatReceipt, receiptCopyFromPrintDocument, type ReceiptCopy } from "../lib/receiptPrint";

const DRAWER = [0x1b, 0x70, 0, 25, 250];
const hasDrawer = (bytes: Uint8Array) => Array.from(bytes).join(",").includes(DRAWER.join(","));

// A paid order as receiptCopyFromPrintDocument gives it: the words already made.
const RECEIPT: ReceiptCopy = {
  propertyName: "Kilima View",
  outletName: "Pool bar",
  orderNumber: "POS-KV-261019-42",
  dailyNumber: 42,
  tableNumber: "12",
  settlementMethod: "Cash",
  takenBy: "Amina Hassan",
  settledBy: "Grace Mushi",
  settledAt: "Mon 19 Oct 2026, 13:05",
  subtotal: "TSh 30,000",
  discount: "TSh 3,000",
  discountReason: "Regular guest",
  taxAmount: "TSh 4,860",
  totalAmount: "TSh 31,860",
  lines: [
    { name: "Grilled tilapia with ugali and kachumbari", quantity: "1", total: "TSh 18,000" },
    { name: "Kilimanjaro lager", quantity: "2", total: "TSh 12,000" },
  ],
};

describe("the receipt on a thermal printer (S8b)", () => {
  it("puts each amount at the paper's right edge, the discount with its reason, and a large total", () => {
    const paper = readable(receiptBytes(RECEIPT, PAPER_80MM)).split("\n");
    for (const line of paper) expect(line.length).toBeLessThanOrEqual(48);
    expect(paper).toContain(`Kilimanjaro lager${" ".repeat(48 - "Kilimanjaro lager".length - "2 TSh 12,000".length)}2 TSh 12,000`);
    expect(paper.some((line) => line.startsWith("Discount (Regular guest)") && line.endsWith("-TSh 3,000"))).toBe(true);
    expect(paper.some((line) => line.startsWith("TOTAL") && line.endsWith("TSh 31,860"))).toBe(true);
    expect(paper).toContain("Order 42");
    expect(paper).toContain("Ref POS-KV-261019-42");
    expect(paper).toContain("Taken by Amina Hassan");
    expect(paper).toContain("Settled by Grace Mushi");
  });

  it("wraps a long item on 58 mm paper, its amount on the last line", () => {
    const paper = readable(receiptBytes(RECEIPT, PAPER_58MM)).split("\n");
    for (const line of paper) expect(line.length).toBeLessThanOrEqual(32);
    const start = paper.findIndex((line) => line.startsWith("Grilled tilapia"));
    expect(paper[start]).not.toContain("TSh");
    const end = paper.slice(start).find((line) => line.endsWith("TSh 18,000"));
    expect(end).toBeDefined();
  });

  it("opens the drawer only when asked, and a copy says COPY", () => {
    expect(hasDrawer(receiptBytes(RECEIPT, PAPER_80MM))).toBe(false);
    expect(hasDrawer(receiptBytes(RECEIPT, PAPER_80MM, { drawer: true }))).toBe(true);
    expect(readable(receiptBytes(RECEIPT, PAPER_80MM, { copy: true }))).toContain("*** COPY ***");
    expect(readable(receiptBytes(RECEIPT, PAPER_80MM))).not.toContain("COPY");
  });

  it("a refund slip keeps its words, wrapped to the paper, with a cut", () => {
    const bytes = textPaperBytes("REFUND\nOrder 42\n\n1 x Kilimanjaro lager returned unopened by the guest  TSh 6,000\n", PAPER_58MM, { drawer: true });
    const paper = readable(bytes).split("\n");
    for (const line of paper) expect(line.length).toBeLessThanOrEqual(32);
    expect(paper.slice(0, 3)).toEqual(["REFUND", "Order 42", ""]);
    expect(hasDrawer(bytes)).toBe(true);
    expect(Array.from(bytes.slice(-4))).toEqual([0x1d, 0x56, 0x42, 3]);
  });
});

// F-229: the printed receipt of an order whose prices include VAT.
describe("a printed receipt whose prices include VAT", () => {
  const document = {
    propertyName: "Bahari QA Hotel",
    dailyNumber: 1,
    currency: "TZS",
    pricesIncludeTax: true,
    items: [{ name: "Cappuccino", quantity: 3, totalMinor: 1_500_000 }],
    subtotalMinor: 1_271_186,
    discountMinor: 169_491,
    discountReason: "Regular guest",
    taxMinor: 198_305,
    totalMinor: 1_300_000,
  };

  it("reads Items at the menu prices, the TSh 2,000 that came off, VAT included and the total", () => {
    const copy = receiptCopyFromPrintDocument(document);
    const text = formatReceipt(copy);
    expect(text).toContain("Items  TSh 15,000");
    expect(text).toContain("Discount (Regular guest)  -TSh 2,000");
    expect(text).toContain("VAT included  TSh 1,983.05");
    expect(text).toContain("TOTAL  TSh 13,000");
    expect(text).not.toContain("Subtotal");
    const paper = readable(receiptBytes(copy, PAPER_58MM)).split("\n");
    expect(paper.some((line) => line.startsWith("VAT included") && line.endsWith("TSh 1,983.05"))).toBe(true);
    expect(paper.some((line) => line.startsWith("Items") && line.endsWith("TSh 15,000"))).toBe(true);
  });

  it("an order with VAT on top prints as before", () => {
    const text = formatReceipt(receiptCopyFromPrintDocument({ ...document, pricesIncludeTax: false }));
    expect(text).toContain("Subtotal  TSh 12,711.86");
    expect(text).toContain("VAT  TSh 1,983.05");
  });
});

it.each([PAPER_58MM, PAPER_80MM])("preserves optional order context on bills at width %s", (width) => {
  const receipt = receiptCopyFromPrintDocument({ ...RECEIPT, serviceType: "DINE_IN", tableLabel: "12", askForTable: false, guestCount: 3 });
  const paper = readable(receiptBytes(receipt, width));
  expect(paper).not.toContain("Table 12");
  expect(paper).toContain("Guests: 3");
  expect(formatReceipt(receipt)).toContain("Guests: 3");
  expect(formatReceipt(receipt)).not.toContain("Table 12");
});
