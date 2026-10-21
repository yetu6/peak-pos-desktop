import { describe, expect, it } from "vitest";
import type { POSPrintJob } from "../lib/posContracts";
import { formatPrintDocument } from "../lib/printJobs";
import { readable } from "./escpos";
import { kitchenTicketBytes } from "./kitchenTicket";
import { paperFromPrintDocument } from "./kitchenRouting";
import { paperViews } from "./paperPreview";
import { DEFAULT_PRINTER_SETTINGS, NO_PAPER, type PrinterSettings } from "./printerSettings";

const BAR = {
  orderId: "o1", orderNumber: "0007", dailyNumber: 7, station: "BAR", roundNumber: 1, tableLabel: "T4", serviceType: "DINE_IN",
  waiterName: "Zawadi Said", sentAt: "2026-10-21T19:12:00Z", items: [{ id: "l1", productId: "p1", name: "Soda", quantity: 2, modifiers: [] }],
};
const network = { target: { kind: "network" as const, host: "127.0.0.1", port: 9100 }, width: 48 as const };

// The owner, 2026-10-21: every paper is shown before it prints -- the paper itself, not a likeness of it.
describe("the preview is the paper", () => {
  it("a station with a thermal printer: the text of the very bytes it gets, at its width", () => {
    const settings: PrinterSettings = { ...DEFAULT_PRINTER_SETTINGS, stations: { BAR: { ...network, width: 32 } } };
    const [view] = paperViews([{ jobType: "KITCHEN_TICKET", document: BAR }], settings);
    expect(view).toMatchObject({ name: "Bar", width: 32, notHere: null });
    expect(view.text).toBe(readable(kitchenTicketBytes(paperFromPrintDocument(BAR), 32)));
    expect(view.text).toContain("Soda");
  });

  it("this till's own printer: the text it prints", () => {
    const [view] = paperViews([{ jobType: "KITCHEN_TICKET", document: BAR }], DEFAULT_PRINTER_SETTINGS);
    const job = { jobType: "KITCHEN_TICKET", document: BAR } as unknown as POSPrintJob;
    expect(view.text).toBe(formatPrintDocument(job).text);
  });

  it("says when a paper doesn't print on this till, and why", () => {
    const off = paperViews([{ jobType: "KITCHEN_TICKET", document: BAR }], { ...DEFAULT_PRINTER_SETTINGS, kitchenTickets: false })[0];
    expect(off.text).toBeNull();
    expect(off.notHere).toBe("This till prints no kitchen papers: the kitchen reads the order on its screen.");
    const bar = paperViews([{ jobType: "KITCHEN_TICKET", document: BAR }], { ...DEFAULT_PRINTER_SETTINGS, stations: { BAR: NO_PAPER } })[0];
    expect(bar.notHere).toBe("Bar has no printer on this till: it reads the order on its screen.");
  });
});
