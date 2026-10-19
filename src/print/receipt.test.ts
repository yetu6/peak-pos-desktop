import { describe, expect, it } from "vitest";
import { PAPER_58MM, PAPER_80MM, readable } from "./escpos";
import { receiptBytes, textPaperBytes } from "./receipt";
import type { ReceiptCopy } from "../lib/receiptPrint";

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
    expect(paper).toContain(`2 x Kilimanjaro lager${" ".repeat(48 - "2 x Kilimanjaro lager".length - "TSh 12,000".length)}TSh 12,000`);
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
    const start = paper.findIndex((line) => line.startsWith("1 x Grilled tilapia"));
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
