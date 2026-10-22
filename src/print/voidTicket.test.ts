import { describe, expect, it } from "vitest";
import { PAPER_58MM, PAPER_80MM, readable } from "./escpos";
import { formatVoidSlip, voidSlipBytes, voidSlipFromPrintDocument, voidSlipTitle, type VoidSlipPaper } from "./voidTicket";

// What fbc-peak's createVoidPrintJobs writes for one item voided at the bar (migration 00125).
const DOCUMENT: Record<string, unknown> = {
  orderId: "order-1",
  orderNumber: "POS-MAIN-261021-1",
  dailyNumber: 1,
  station: "BAR",
  voidedAt: "2026-10-21T08:30:00Z",
  tableLabel: "7",
  serviceType: "DINE_IN",
  waiterName: "Baraka Mushi",
  askedByName: "Baraka Mushi",
  approvedByName: "Neema Kweka",
  reason: "Spilled",
  wholeOrder: false,
  items: [{ id: "i-1", productId: "p-1", name: "Tusker", quantity: 1, roundNumber: 2, modifiers: [{ name: "Cold" }] }],
};

describe("void slip on paper (fbc-peak 00125)", () => {
  it("reads Yetu's print document", () => {
    const slip = voidSlipFromPrintDocument(DOCUMENT);
    expect(slip).toEqual<VoidSlipPaper>({
      dailyNumber: 1,
      orderNumber: "POS-MAIN-261021-1",
      station: "BAR",
      serviceType: "DINE_IN",
      label: "7",
      waiterName: "Baraka Mushi",
      askedByName: "Baraka Mushi",
      approvedByName: "Neema Kweka",
      reason: "Spilled",
      voidedAt: "2026-10-21T08:30:00Z",
      wholeOrder: false,
      lines: [{ quantity: 1, name: "Tusker", options: ["Cold"] }],
    });
  });

  it("says what it is and where at the top, the order large, and not to make it", () => {
    const text = readable(voidSlipBytes(voidSlipFromPrintDocument(DOCUMENT), PAPER_58MM));
    expect(text.split("\n").slice(0, 3)).toEqual(["CANCELLED - BAR", "ORDER 1", "DO NOT MAKE"]);
    expect(text).toContain("Table 7 - Dine in");
    expect(text).toContain("Taken by Baraka Mushi");
    expect(text).toContain("1 x Tusker\n   - Cold\n");
    expect(text).toContain("Why: Spilled");
    // Wrapped to the paper's width (32 characters on 58 mm).
    expect(text.replace(/\n/g, " ")).toContain("Asked by Baraka Mushi, approved by Neema Kweka");
    // The kitchen makes, the till charges.
    expect(text).not.toContain("TSh");
  });

  it("says when the whole order is voided", () => {
    const text = readable(voidSlipBytes(voidSlipFromPrintDocument({ ...DOCUMENT, wholeOrder: true }), PAPER_80MM));
    expect(text).toContain("WHOLE ORDER - DO NOT MAKE");
  });

  it("names the kitchen when Yetu sends no station", () => {
    expect(voidSlipTitle(undefined)).toBe("CANCELLED - KITCHEN");
    expect(voidSlipTitle("HOT")).toBe("CANCELLED - HOT KITCHEN");
  });

  it("reads the same through the system's own printer", () => {
    const text = formatVoidSlip(voidSlipFromPrintDocument(DOCUMENT));
    expect(text).toContain("Cancelled ");
    expect(text).not.toMatch(/\bvoid(?:ed|ing|s)?\b/i);
    expect(text).toContain("CANCELLED - BAR\nORDER 1\nDO NOT MAKE");
    expect(text).toContain("  1  Tusker\n      Cold");
    expect(text).toContain("Why: Spilled\nAsked by Baraka Mushi, approved by Neema Kweka");
  });
});

it("uses the saved short-name interpretation on a cancellation slip", () => {
 const slip = voidSlipFromPrintDocument({...DOCUMENT,tableLabel:"12",askForTable:false,guestCount:3});
 const text = readable(voidSlipBytes(slip,PAPER_80MM));
 expect(text).not.toContain("Table 12");
 expect(text).toContain("12 - Dine in");
 expect(text).toContain("Guests: 3");
 expect(formatVoidSlip(slip)).toContain("Guests: 3");
 expect(formatVoidSlip(slip)).not.toContain("Table 12");
});
