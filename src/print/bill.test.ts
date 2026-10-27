import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearOperationalSession, setOperationalSession } from "../lib/operationalSession";
import { formatReceipt, receiptCopyFromPrintDocument } from "../lib/receiptPrint";
import type { POSPrintJob } from "../lib/posContracts";
import { PAPER_80MM, readable } from "./escpos";
import { receiptPaperFor } from "./receiptRouting";
import { DEFAULT_PRINTER_SETTINGS, type PrinterSettings } from "./printerSettings";

const raw: { target: unknown; bytes: Uint8Array }[] = [];
vi.mock("./printerStore", () => ({
  loadPrinterSettings: async () => DEFAULT_PRINTER_SETTINGS,
  printRawToPrinter: async (target: unknown, bytes: Uint8Array) => void raw.push({ target, bytes }),
}));

const { drawerFitted, openDrawer, openDrawerForCash } = await import("./cashDrawer");

// The owner, 2026-10-20: Yetu is not connected to TRA's VFD; the EFD gives
// the tax receipt when the guest pays. Yetu's paper is the BILL, before
// payment, with nothing about TRA on it; at a hotel the guest signs it to
// charge it to their room. Order 14's figures, as Yetu keeps them.
const PAID = {
  orderNumber: "POS-MAIN-261019-14",
  dailyNumber: 14,
  propertyName: "Bahari QA Hotel",
  outletName: "Bahari Restaurant & Bar",
  initiatedByName: "Zawadi Said",
  operatorName: "Zawadi Said",
  serviceType: "DINE_IN",
  items: [
    { name: "Soda", quantity: 1, totalMinor: 250000, taxMinor: 38136 },
    { name: "Soda", quantity: 1, totalMinor: 250000, taxMinor: 38136 },
  ],
  subtotalMinor: 423728,
  discountMinor: 21186,
  discountReason: "Birthday",
  taxMinor: 72458,
  totalMinor: 475000,
  pricesIncludeTax: true,
  currency: "TZS",
  tenderMethod: "CASH",
  cashMinor: 475000,
  settledAt: "2026-10-20T17:25:00Z",
};
const BILL = {
  ...PAID,
  kind: "BILL",
  paidMinor: 100000,
  remainingMinor: 375000,
  printedByName: "Zawadi Said",
  printedAt: "2026-10-20T17:20:00Z",
  tenderMethod: undefined,
  cashMinor: undefined,
  settledAt: undefined,
};

function job(jobType: string, document: Record<string, unknown>): POSPrintJob {
  return { id: "job-1", sourceType: "POS_ORDER", sourceId: "order-14", jobType, document, status: "PENDING", attempts: 0, createdAt: "2026-10-20T17:20:00Z" };
}

describe("the bill before payment", () => {
  it("says BILL, what is paid already and what is still to pay, who printed it when; nothing about TRA", () => {
    const text = formatReceipt(receiptCopyFromPrintDocument(BILL));
    expect(text).toContain("BILL\nOrder 14");
    expect(text).toContain("Printed ");
    expect(text).toContain("Discount (Birthday)  -TSh 250");
    expect(text).toContain("TOTAL  TSh 4,750");
    expect(text).toContain("Paid already  TSh 1,000");
    expect(text).toContain("TO PAY  TSh 3,750");
    expect(text).not.toMatch(/Paid Tue|Cash/);
    expect(text).not.toMatch(/TRA|tax receipt|INVOICE/);
    expect(text.trimEnd().split("\n").slice(-2).map((line) => line.trim())).toEqual(["Powered by Yetu", "yetu.fbcsoftwares.com"]);
  });

  it("at a hotel, ends with the room and the guest's signature, the room filled in for room service", () => {
    const hotel = formatReceipt(receiptCopyFromPrintDocument(BILL, { hotel: true }));
    expect(hotel).toContain("Charge to room\nRoom ________\nGuest signature");
    const roomService = formatReceipt(receiptCopyFromPrintDocument({ ...BILL, serviceType: "ROOM_SERVICE", tableLabel: "201" }, { hotel: true }));
    expect(roomService).toContain("Room 201");
    // Not at a place without rooms, and not on a paid order's bill.
    expect(formatReceipt(receiptCopyFromPrintDocument(BILL))).not.toContain("Charge to room");
    expect(formatReceipt(receiptCopyFromPrintDocument(PAID, { hotel: true }))).not.toContain("Charge to room");
  });

  it("a paid order's bill, printed again, says it was paid", () => {
    const text = formatReceipt(receiptCopyFromPrintDocument(PAID));
    expect(text).toContain("BILL - PAID");
    expect(text).toContain("Paid Tue 20 Oct 2026");
    expect(text).not.toContain("TO PAY");
    expect(text).not.toMatch(/TRA|tax receipt/);
  });

  afterEach(() => clearOperationalSession());
  function signInAt(capabilities: string[]) {
    setOperationalSession({
      token: "zawadi-session", expiresAt: "2099-01-01T00:00:00Z", tenantId: "tenant-1", propertyId: "property-1",
      outletId: "outlet-1", terminalId: "terminal-1", staffId: "staff-1", assurance: "RESTRICTED", capabilities,
    });
  }
  const drawerKick = (paper: Uint8Array) => Array.from(paper).some((byte, index) => byte === 0x1b && paper[index + 1] === 0x70);

  it("on the bill printer at a hotel: TO PAY, the signature lines, and no cash drawer, cash or not", () => {
    signInAt(["CORE", "LODGING", "POS"]);
    const paper = receiptPaperFor(job("BILL", { ...BILL, cashMinor: 100000 }), PAPER_80MM, true, "");
    const text = readable(paper);
    expect(text).toContain("BILL");
    expect(text).toContain("TO PAY");
    expect(text).toContain("Charge to room");
    expect(text).toContain("Guest signature");
    expect(text).not.toMatch(/TRA|tax receipt/);
    // ESC p: the drawer. A bill is printed before anything is paid.
    expect(drawerKick(paper)).toBe(false);
  });

  it("on the bill printer at a restaurant without rooms: no signature lines", () => {
    signInAt(["CORE", "POS"]);
    const text = readable(receiptPaperFor(job("BILL", BILL), PAPER_80MM, true, ""));
    expect(text).toContain("TO PAY");
    expect(text).not.toContain("Guest signature");
  });
});

describe("the cash drawer", () => {
  const settings: PrinterSettings = {
    ...DEFAULT_PRINTER_SETTINGS,
    receipt: { target: { kind: "network", host: "192.168.1.50", port: 9100 }, width: PAPER_80MM },
    cashDrawer: true,
  };
  beforeEach(() => {
    raw.length = 0;
  });

  it("opens for cash, every time it is taken (2026-10-21): ESC @, then ESC p on pin 2", async () => {
    expect(await openDrawerForCash("CASH", settings)).toEqual({ ok: true });
    expect(await openDrawerForCash("CASH", settings)).toEqual({ ok: true });
    expect(raw).toHaveLength(2);
    expect(Array.from(raw[0].bytes)).toEqual([0x1b, 0x40, 0x1b, 0x70, 0, 25, 250]);
    expect(raw[0].target).toEqual(settings.receipt?.target);
  });

  it("stays shut for a card, mobile money or a room charge", async () => {
    for (const method of ["EXTERNAL_CARD", "MOBILE_MONEY", "ROOM_CHARGE", undefined]) {
      expect(await openDrawerForCash(method, settings)).toEqual({ ok: true });
    }
    expect(raw).toHaveLength(0);
  });

  it("a till without a drawer -- switched off, or no bill printer, as on a laptop -- never opens one", async () => {
    expect(drawerFitted(settings)).toBe(true);
    expect(drawerFitted({ ...settings, cashDrawer: false })).toBe(false);
    expect(drawerFitted({ ...settings, receipt: null })).toBe(false);
    await openDrawer({ ...settings, cashDrawer: false });
    await openDrawer({ ...settings, receipt: null });
    expect(raw).toHaveLength(0);
    // Opening it without a sale goes the same way.
    await openDrawer(settings);
    expect(raw).toHaveLength(1);
  });
});
