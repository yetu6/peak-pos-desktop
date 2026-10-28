import { afterEach, describe, expect, it } from "vitest";
import { PAPER_58MM, PAPER_80MM, readable } from "./escpos";
import { kitchenTicketBytes } from "./kitchenTicket";
import { receiptBytes, textPaperBytes } from "./receipt";
import { voidSlipBytes } from "./voidTicket";
import { TEST_MARK } from "./testMark";
import { paperFor } from "../lib/printJobs";
import type { POSPrintJob } from "../lib/posContracts";
import { DEFAULT_PRINTER_SETTINGS, type PrinterSettings } from "./printerSettings";
import { clearOperationalSession, setOperationalSession, type OperationalSession } from "../lib/operationalSession";
import { cacheTestBusiness, cachedTestBusiness } from "../lib/testBusiness";

const MARK = "TEST - not a real sale"; // the thermal printer spells the dash
const lines = (bytes: Uint8Array) => readable(bytes).split("\n").filter((l) => l !== "");

function expectMarkedTopAndBottom(bytes: Uint8Array): void {
  const all = lines(bytes);
  expect(all[0]).toBe(MARK);
  // Last line is Yetu's signature; the marker closes the paper just above it.
  expect(all.slice(-4)).toContain(MARK);
  expect(all.filter((l) => l === MARK)).toHaveLength(2);
}

const ticket = { dailyNumber: 7, station: "BAR", lines: [{ quantity: 1, name: "Water", options: [] }] };
const slip = { dailyNumber: 7, station: "BAR", lines: [{ quantity: 1, name: "Water", options: [] }] };
const receipt = { propertyName: "Bahari", totalAmount: "TSh 1,000", lines: [{ name: "Water", quantity: "1", total: "TSh 1,000" }] };

describe.each([PAPER_58MM, PAPER_80MM])("test business papers at %i characters", (width) => {
  it("kitchen ticket", () => {
    expectMarkedTopAndBottom(kitchenTicketBytes({ ...ticket, testBusiness: true }, width));
    expect(kitchenTicketBytes({ ...ticket, testBusiness: false }, width)).toEqual(kitchenTicketBytes(ticket, width));
    expect(readable(kitchenTicketBytes(ticket, width))).not.toContain("TEST");
  });
  it("void slip", () => {
    expectMarkedTopAndBottom(voidSlipBytes({ ...slip, testBusiness: true }, width));
    expect(voidSlipBytes({ ...slip, testBusiness: false }, width)).toEqual(voidSlipBytes(slip, width));
    expect(readable(voidSlipBytes(slip, width))).not.toContain("TEST");
  });
  it("receipt, bill and its copy", () => {
    expectMarkedTopAndBottom(receiptBytes(receipt, width, { testBusiness: true }));
    expectMarkedTopAndBottom(receiptBytes({ ...receipt, beforePayment: true }, width, { testBusiness: true, copy: true }));
    expect(receiptBytes(receipt, width, { testBusiness: false })).toEqual(receiptBytes(receipt, width));
    expect(readable(receiptBytes(receipt, width))).not.toContain("TEST");
  });
  it("refund slip (text paper)", () => {
    expectMarkedTopAndBottom(textPaperBytes("REFUND\nOrder 42\n", width, { testBusiness: true }));
    expect(textPaperBytes("REFUND\nOrder 42\n", width, { testBusiness: false })).toEqual(textPaperBytes("REFUND\nOrder 42\n", width));
    expect(readable(textPaperBytes("REFUND\nOrder 42\n", width))).not.toContain("TEST");
  });
});

describe("the paper this till makes of a job", () => {
  const session: OperationalSession = { token: "t", expiresAt: "2099-01-01T00:00:00Z", tenantId: "t", propertyId: "p1", outletId: "o1", terminalId: "x", staffId: "s", assurance: "RESTRICTED", capabilities: ["CORE", "POS"], permissions: [] };
  const job: POSPrintJob = { id: "j", sourceType: "POS_ORDER", sourceId: "o", jobType: "KITCHEN_TICKET", status: "PENDING", attempts: 0, createdAt: "", document: { dailyNumber: 7, station: "BAR", items: [{ name: "Water", quantity: 2, fulfilment: "PICKED" }] } };
  const thermal: PrinterSettings = { ...DEFAULT_PRINTER_SETTINGS, kitchen: { target: { kind: "network" as const, host: "127.0.0.1", port: 9100 }, width: 48 as const }, receipt: { target: { kind: "network" as const, host: "127.0.0.1", port: 9100 }, width: 48 as const } };
  const routes = (settings: PrinterSettings) => ({ settings, printRaw: async () => undefined });
  afterEach(() => { clearOperationalSession(); localStorage.clear(); });

  it("marks thermal and system papers once the business is known as a test one, offline too", () => {
    setOperationalSession({ ...session });
    cacheTestBusiness("p1", "o1", true);
    const kitchen = paperFor(job, routes(thermal));
    expect(kitchen.kind === "thermal" && lines(kitchen.bytes)[0]).toBe(MARK);
    const bill = paperFor({ ...job, jobType: "BILL", document: { dailyNumber: 7, items: [] } }, routes(thermal));
    expect(bill.kind === "thermal" && lines(bill.bytes)[0]).toBe(MARK);
    const refund = paperFor({ ...job, jobType: "REFUND_RECEIPT", document: { refundNumber: "R1" } }, routes(thermal));
    expect(refund.kind === "thermal" && lines(refund.bytes)[0]).toBe(MARK);
    const system = paperFor(job, routes({ ...thermal, kitchen: null }));
    expect(system.kind).toBe("system");
    if (system.kind === "system") {
      expect(system.text.startsWith(TEST_MARK)).toBe(true);
      expect(system.text.trimEnd().endsWith(TEST_MARK)).toBe(true);
    }
  });

  it("is unchanged for a normal business, and when nothing is known", () => {
    setOperationalSession({ ...session });
    const before = paperFor(job, routes(thermal));
    cacheTestBusiness("p1", "o1", false);
    const after = paperFor(job, routes(thermal));
    expect(after).toEqual(before);
    expect(before.kind === "thermal" && readable(before.bytes)).not.toContain("TEST");
    const sys = paperFor(job, routes({ ...thermal, kitchen: null }));
    expect(sys.kind === "system" && sys.text).not.toContain("TEST");
  });
});

describe("the remembered answer", () => {
  afterEach(() => localStorage.clear());
  it("survives a reload, and a catalogue that says nothing leaves it alone", () => {
    cacheTestBusiness("p1", "o1", true);
    cacheTestBusiness("p1", "o1", undefined);
    expect(cachedTestBusiness("p1", "o1")).toBe(true);
    expect(cachedTestBusiness()).toBe(true); // the lock screen has no session yet
    expect(cachedTestBusiness("p2", "o9")).toBe(false); // another business is never marked by it
  });
  it("a fresh catalogue that says false clears it", () => {
    cacheTestBusiness("p1", "o1", true);
    cacheTestBusiness("p1", "o1", false);
    expect(cachedTestBusiness("p1", "o1")).toBe(false);
  });
});
