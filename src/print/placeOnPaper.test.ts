import { describe, expect, it } from "vitest";
import type { POSPrintJob } from "../lib/posContracts";
import { formatPrintDocument } from "../lib/printJobs";
import { readable } from "./escpos";
import { receiptPaperFor } from "./receiptRouting";

const job = (jobType: string, document: Record<string, unknown>) =>
  ({ id: "j", sourceType: "POS_ORDER", sourceId: "o", jobType, document, status: "PENDING", attempts: 0, createdAt: "" }) as POSPrintJob;
const bill = (serviceType: string, tableLabel: string) =>
  job("BILL", { kind: "BILL", orderNumber: "0007", dailyNumber: 7, serviceType, tableLabel, items: [], subtotalMinor: 0, taxMinor: 0, totalMinor: 0, currency: "TZS" });
const ticket = (tableLabel: string) =>
  job("KITCHEN_TICKET", { orderNumber: "0007", dailyNumber: 7, station: "BAR", serviceType: "DINE_IN", tableLabel, items: [{ name: "Soda", quantity: 1, modifiers: [] }] });

// The owner, 2026-10-21: "Table or name" -- a name the waiter typed prints as typed, on every paper.
describe("where the order goes, on paper", () => {
  it("a bill: a table as a table, a name as typed, a room as a room", () => {
    expect(formatPrintDocument(bill("DINE_IN", "T4")).text).toContain("Table T4");
    const named = formatPrintDocument(bill("DINE_IN", "Mama Neema")).text;
    expect(named).toContain("Mama Neema");
    expect(named).not.toContain("Table Mama Neema");
    expect(formatPrintDocument(bill("ROOM_SERVICE", "204")).text).not.toContain("Table 204");
  });

  it("the thermal bill says it the same way", () => {
    const text = readable(receiptPaperFor(bill("DINE_IN", "Window"), 48, false, formatPrintDocument(bill("DINE_IN", "Window")).text));
    expect(text).toContain("Window");
    expect(text).not.toContain("Table Window");
  });

  it("a kitchen ticket on this till's own printer: a name as typed", () => {
    const text = formatPrintDocument(ticket("Bar stool 3")).text;
    expect(text).toContain("Bar stool 3");
    expect(text).not.toContain("Table Bar stool 3");
  });
});
