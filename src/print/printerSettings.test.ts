import { describe, expect, it } from "vitest";
import { DEFAULT_PRINTER_SETTINGS, parseNetworkAddress, printerFor, printerWords, settingsFrom, type PrinterSettings } from "./printerSettings";

const KITCHEN = { target: { kind: "network" as const, host: "192.168.1.50", port: 9100 }, width: 48 as const };
const BAR = { target: { kind: "system" as const, name: "Bar EPSON TM-T20" }, width: 32 as const };

describe("printers on the till (S8a)", () => {
  it("a station's ticket goes to its own printer, else the kitchen's, else this till's own", () => {
    const settings: PrinterSettings = { kitchenTickets: true, kitchen: KITCHEN, stations: { BAR }, receipt: null, cashDrawer: false };
    expect(printerFor(settings, "BAR")).toEqual(BAR);
    expect(printerFor(settings, "HOT")).toEqual(KITCHEN);
    expect(printerFor(DEFAULT_PRINTER_SETTINGS, "HOT")).toBeNull();
  });

  it("reads a network printer's address as people type it", () => {
    expect(parseNetworkAddress("192.168.1.50")).toEqual({ host: "192.168.1.50", port: 9100 });
    expect(parseNetworkAddress(" kitchen-printer.local:9101 ")).toEqual({ host: "kitchen-printer.local", port: 9101 });
    expect(parseNetworkAddress("192.168.1.300")).toBeNull();
    expect(parseNetworkAddress("192.168.1.5:70000")).toBeNull();
    // Only a printer in this building, on a printing port (as raw_print.rs).
    expect(parseNetworkAddress("192.168.1.5:22")).toBeNull();
    expect(parseNetworkAddress("8.8.8.8")).toBeNull();
    expect(parseNetworkAddress("10.0.0.7:9109")).toEqual({ host: "10.0.0.7", port: 9109 });
    expect(parseNetworkAddress("http://printer")).toBeNull();
    expect(parseNetworkAddress("")).toBeNull();
  });

  it("says a printer as staff read it", () => {
    expect(printerWords(KITCHEN)).toBe("192.168.1.50 (80 mm)");
    expect(printerWords(BAR)).toBe("Bar EPSON TM-T20 (58 mm)");
    expect(printerWords(null)).toBe("This till's own printer");
  });

  it("settings read back are made whole: anything missing or wrong is the default", () => {
    expect(settingsFrom(null)).toEqual(DEFAULT_PRINTER_SETTINGS);
    expect(settingsFrom({ kitchenTickets: false })).toEqual({ ...DEFAULT_PRINTER_SETTINGS, kitchenTickets: false });
    expect(settingsFrom({ kitchen: { target: { kind: "network", host: "999.1.1.1", port: 9100 }, width: 48 } }).kitchen).toBeNull();
    expect(settingsFrom({ kitchen: KITCHEN, stations: { BAR, HOT: { target: { kind: "system", name: " " } } } })).toEqual({
      kitchenTickets: true, kitchen: KITCHEN, stations: { BAR }, receipt: null, cashDrawer: false,
    });
  });

  it("a cash drawer opens only from a receipt printer that was chosen (S8b)", () => {
    const RECEIPT = { target: { kind: "system" as const, name: "EPSON TM-T20" }, width: 48 as const };
    expect(settingsFrom({ receipt: RECEIPT, cashDrawer: true })).toMatchObject({ receipt: RECEIPT, cashDrawer: true });
    expect(settingsFrom({ receipt: null, cashDrawer: true })).toMatchObject({ receipt: null, cashDrawer: false });
    expect(settingsFrom({ receipt: { target: { kind: "network", host: "8.8.8.8", port: 9100 } }, cashDrawer: true })).toMatchObject({ receipt: null, cashDrawer: false });
  });

  it("a station with no paper is read back as such, and prints nowhere (S8a)", () => {
    const settings = settingsFrom({ kitchenTickets: true, kitchen: KITCHEN, stations: { BAR: "none", HOT: "nonsense" } });
    expect(settings.stations).toEqual({ BAR: "none" });
    expect(printerFor(settings, "BAR")).toEqual(KITCHEN);
  });
});
