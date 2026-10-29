import { describe, expect, it } from "vitest";
import { printerHealthWords, systemPrinterNames, type PrinterHealth } from "./printerHealth";
import { DEFAULT_PRINTER_SETTINGS } from "./printerSettings";

const h = (state: PrinterHealth["state"], extra: Partial<PrinterHealth> = {}): PrinterHealth => ({ state, detail: null, stuckJobs: 0, ...extra });

describe("printer health in words", () => {
  it("says Ready only when the printer is ready and nothing is stuck", () => {
    expect(printerHealthWords(h("ready"))).toEqual({ ok: true, words: "Ready" });
  });
  it("names a switched-off printer and a printer out of paper", () => {
    expect(printerHealthWords(h("offline"))).toEqual({ ok: false, words: "Switched off or not connected" });
    expect(printerHealthWords(h("paper-out"))).toEqual({ ok: false, words: "Out of paper" });
  });
  it("never says Ready when Windows can't tell", () => {
    expect(printerHealthWords(h("unknown"))).toEqual({ ok: false, words: "Windows can't tell" });
  });
  it("names waiting papers, even on a printer that says it is ready, and never says to cancel them", () => {
    expect(printerHealthWords(h("ready", { stuckJobs: 3 }))).toEqual({ ok: false, words: "3 papers waiting to print" });
    expect(printerHealthWords(h("ready", { stuckJobs: 1 })).words).toBe("1 paper waiting to print");
    expect(printerHealthWords(h("paper-out", { stuckJobs: 2 })).words).toBe("Out of paper. 2 papers waiting to print");
  });
  it("puts a known problem in plain words", () => {
    expect(printerHealthWords(h("problem", { detail: "PaperJam" })).words).toBe("Paper jam");
    expect(printerHealthWords(h("problem", { detail: "Weird" })).words).toBe("Needs attention in Windows");
  });
  it("lists each system printer once", () => {
    const settings = {
      ...DEFAULT_PRINTER_SETTINGS,
      receipt: { target: { kind: "system", name: "EPSON" }, width: 48 },
      kitchen: { target: { kind: "system", name: "EPSON" }, width: 48 },
      stations: { BAR: { target: { kind: "network", host: "192.168.1.9", port: 9100 }, width: 32 } },
    } as never;
    expect(systemPrinterNames(settings)).toEqual(["EPSON"]);
  });
});
