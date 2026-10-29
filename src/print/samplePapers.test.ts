import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAPER_58MM, PAPER_80MM, readable } from "./escpos";
import { kitchenTicketBytes } from "./kitchenTicket";
import { receiptBytes } from "./receipt";
import { voidSlipBytes } from "./voidTicket";
import { SAMPLE_MARK } from "./testMark";
import { DEFAULT_PRINTER_SETTINGS, NO_PAPER, type PrinterChoice, type PrinterSettings } from "./printerSettings";
import { SAMPLE_KINDS, SAMPLES_ONLY_IN_TILL, printSamplePapers, printSamplesFromTill, rememberSampleFacts, sampleFigures, type SampleKind } from "./samplePapers";
import { clearOperationalSession, setOperationalSession, type OperationalSession } from "../lib/operationalSession";
import { cacheTestBusiness } from "../lib/testBusiness";

const MARK = "SAMPLE - not a real sale"; // the thermal printer spells the dash
const ALL = SAMPLE_KINDS.map((entry) => entry.kind);
const lines = (bytes: Uint8Array) => readable(bytes).split("\n").filter((l) => l !== "");

const session: OperationalSession = { token: "t", expiresAt: "2099-01-01T00:00:00Z", tenantId: "t", propertyId: "p1", outletId: "o1", terminalId: "x", staffId: "s", assurance: "RESTRICTED", capabilities: ["CORE", "POS"], permissions: [], propertyName: "Bahari Hotel", outletName: "Beach Bar" };
const net = (host: string, port = 9100): PrinterChoice => ({ target: { kind: "network", host, port }, width: PAPER_80MM });
const at58 = (host: string): PrinterChoice => ({ target: { kind: "network", host, port: 9100 }, width: PAPER_58MM });

function rig(settings: PrinterSettings) {
  const raw: { host: string; bytes: Uint8Array }[] = [];
  const text: { title: string; text: string }[] = [];
  const send = {
    printRaw: async (target: { kind: string; host?: string; name?: string }, bytes: Uint8Array) => { raw.push({ host: target.host ?? target.name ?? "", bytes }); },
    printText: async (title: string, body: string) => { text.push({ title, text: body }); },
  };
  return { raw, text, run: (kinds: readonly SampleKind[] = ALL) => printSamplePapers(kinds, settings, send as never) };
}

const markedTopAndBottom = (bytes: Uint8Array) => {
  const all = lines(bytes);
  expect(all[0]).toBe(MARK);
  expect(all.slice(-4)).toContain(MARK);
  expect(all.filter((l) => l === MARK)).toHaveLength(2);
};

describe("Print sample papers", () => {
  beforeEach(() => setOperationalSession({ ...session }));
  afterEach(() => { clearOperationalSession(); localStorage.clear(); vi.unstubAllGlobals(); });

  describe.each([PAPER_58MM, PAPER_80MM])("on thermal paper %i characters wide", (width) => {
    const printer = { target: { kind: "network" as const, host: "10.0.0.5", port: 9100 }, width };
    const settings: PrinterSettings = { ...DEFAULT_PRINTER_SETTINGS, kitchen: printer, receipt: printer };

    it("makes every paper with the real builder, marked SAMPLE top and bottom, from the till's own names", async () => {
      const { raw, run } = rig(settings);
      const results = await run();
      expect(results.map((r) => r.ok)).toEqual([true, true, true, true, true, true]);
      expect(raw).toHaveLength(6);
      raw.forEach((paper) => markedTopAndBottom(paper.bytes));
      const [bill, receipt, kitchen, bar, refund, voided] = raw.map((p) => readable(p.bytes));
      for (const paper of [bill, receipt, kitchen, bar, refund, voided]) expect(paper).not.toContain("TEST");
      expect(bill).toContain("BAHARI HOTEL");
      expect(bill).toContain("Beach Bar");
      expect(bill).toContain("Sample drink");
      expect(bill).toContain("Sample dish");
      expect(receipt).toContain("TSh 21,240"); // 18,000 + 18% VAT on top (the default)
      expect(kitchen).toContain("Sample dish");
      expect(kitchen).not.toContain("Sample drink"); // the kitchen makes the dish
      expect(bar).toContain("Sample drink");
      expect(refund.toUpperCase()).toContain("REFUND");
      expect(voided).toContain("DO NOT MAKE");
      // The same bytes the real builders make, plus the marker: a sample is the real paper.
      const ticket = { dailyNumber: 1, station: "BAR", lines: [{ quantity: 2, name: "Sample drink", options: [] }] };
      expect(lines(kitchenTicketBytes({ ...ticket, testBusiness: SAMPLE_MARK }, width))[0]).toBe(MARK);
      expect(lines(voidSlipBytes({ ...ticket, testBusiness: SAMPLE_MARK }, width))[0]).toBe(MARK);
      expect(lines(receiptBytes({ lines: [] }, width, { testBusiness: SAMPLE_MARK }))[0]).toBe(MARK);
    });

    it("never opens the cash drawer, even with a drawer set up", async () => {
      const { raw, run } = rig({ ...settings, cashDrawer: true });
      await run(["receipt", "refund"]);
      expect(raw).toHaveLength(2);
      // ESC p (open drawer) is never in a sample.
      for (const paper of raw) for (let i = 0; i < paper.bytes.length - 1; i++) expect(!(paper.bytes[i] === 0x1b && paper.bytes[i + 1] === 0x70)).toBe(true);
    });
  });

  it("prints no paper that has no saved printer, and says what to do", async () => {
    const { text, raw, run } = rig(DEFAULT_PRINTER_SETTINGS);
    const results = await run();
    // Windows page printing makes an unreadable strip on a thermal printer: nothing is sent.
    expect(raw).toHaveLength(0);
    expect(text).toHaveLength(0);
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(results[0].words).toBe("Not printed — set the bill printer in Printers and press Save");
    expect(results[2].words).toBe("Not printed — set the kitchen printer in Printers and press Save");
    expect(results[3].words).toBe("Not printed — set the bar printer in Printers and press Save");
  });

  it("sends each paper to the printer its kind normally uses", async () => {
    const { raw, run } = rig({
      ...DEFAULT_PRINTER_SETTINGS,
      receipt: net("10.0.0.1"),
      kitchen: at58("10.0.0.2"),
      stations: { BAR: net("10.0.0.3") },
    });
    const results = await run();
    expect(raw.map((p) => p.host)).toEqual([
      "10.0.0.1", // bill
      "10.0.0.1", // receipt
      "10.0.0.2", // kitchen ticket: the kitchen's printer
      "10.0.0.3", // bar ticket: the bar's own printer
      "10.0.0.1", // refund slip
      "10.0.0.2", // void slip goes where the kitchen's tickets go
    ]);
    expect(results[2].words).toBe("sent to 10.0.0.2 (58 mm)");
    expect(results[3].words).toBe("sent to 10.0.0.3 (80 mm)");
  });

  it("says so, per paper, when a station prints no paper or kitchen tickets are off", async () => {
    const noBar = await rig({ ...DEFAULT_PRINTER_SETTINGS, receipt: net("10.0.0.1"), stations: { BAR: NO_PAPER } }).run();
    expect(noBar[3]).toMatchObject({ kind: "bar", ok: false });
    expect(noBar[3].words).toContain("no paper for the bar");
    expect(noBar[0].ok).toBe(true);
    const off = rig({ ...DEFAULT_PRINTER_SETTINGS, kitchenTickets: false, receipt: net("10.0.0.1") });
    const results = await off.run();
    expect(results.filter((r) => !r.ok).map((r) => r.kind)).toEqual(["kitchen", "bar", "void"]);
    expect(results[2].words).toContain("kitchen tickets are off");
    expect(off.raw).toHaveLength(3); // bill, receipt, refund
  });

  it("prints only the papers picked, and reports a printer that fails without stopping the others", async () => {
    const printed: string[] = [];
    const results = await printSamplePapers(["bill", "refund"], { ...DEFAULT_PRINTER_SETTINGS, receipt: net("10.0.0.1") }, {
      printRaw: async () => { if (printed.push("x") === 1) throw new Error("Printer is offline"); },
      printText: async () => undefined,
    });
    expect(results.map((r) => r.kind)).toEqual(["bill", "refund"]);
    expect(results[0]).toMatchObject({ ok: false });
    expect(results[0].words).toContain("Printer is offline");
    expect(results[1].ok).toBe(true);
  });

  it("shows VAT the way this business shows it, and keeps its currency", async () => {
    expect(sampleFigures({ pricesIncludeTax: true }).totalMinor).toBe(1_800_000);
    expect(sampleFigures({ pricesIncludeTax: true }).taxMinor).toBe(274_576);
    rememberSampleFacts("p1", "o1", { currency: "TZS", vatRateBp: 1800, pricesIncludeTax: true });
    const { raw, run } = rig({ ...DEFAULT_PRINTER_SETTINGS, receipt: net("10.0.0.1") });
    await run(["receipt"]);
    const paper = readable(raw[0].bytes);
    expect(paper).toContain("VAT included");
    expect(paper).toContain("TSh 18,000");
  });

  it("also says TEST on a test business's sample? It says SAMPLE, never a sale either way", async () => {
    cacheTestBusiness("p1", "o1", true);
    const { raw, run } = rig({ ...DEFAULT_PRINTER_SETTINGS, receipt: net("10.0.0.1") });
    await run(["bill"]);
    markedTopAndBottom(raw[0].bytes);
  });

  it("makes no network or Yetu call at all", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (...args: unknown[]) => { calls.push(`fetch ${String(args[0])}`); return Promise.reject(new Error("no network")); });
    vi.stubGlobal("XMLHttpRequest", class { constructor() { calls.push("xhr"); } });
    vi.stubGlobal("WebSocket", class { constructor(url: string) { calls.push(`ws ${url}`); } });
    vi.stubGlobal("EventSource", class { constructor(url: string) { calls.push(`sse ${url}`); } });
    const beacon = vi.fn(() => { calls.push("beacon"); return true; });
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
    const { raw, text, run } = rig({ ...DEFAULT_PRINTER_SETTINGS, receipt: net("10.0.0.1") });
    const results = await run();
    expect(results).toHaveLength(6);
    expect(text).toHaveLength(0);
    expect(raw.length).toBe(results.filter((result) => result.ok).length);
    expect(calls).toEqual([]);
  });

  it("says samples print only from the till app in a browser", async () => {
    const answer = await printSamplesFromTill(ALL);
    expect(answer).toEqual({ available: false, words: SAMPLES_ONLY_IN_TILL });
    expect(SAMPLES_ONLY_IN_TILL).toBe("Sample papers can be printed only from the till app.");
  });
});
