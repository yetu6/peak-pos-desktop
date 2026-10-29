import { describe, expect, it, vi } from "vitest";
import { readable } from "./escpos";
import { DEFAULT_PRINTER_SETTINGS } from "./printerSettings";
import { printTestPageVia, testPageBytes } from "./testPage";

const network = { kind: "network", host: "192.168.1.50", port: 9100 } as const;

describe("Print test page", () => {
  it("goes out as raw ESC/POS at the bill printer's width, and says so", async () => {
    const printRaw = vi.fn(async () => undefined);
    const printOs = vi.fn(async () => undefined);
    const result = await printTestPageVia({ ...DEFAULT_PRINTER_SETTINGS, receipt: { target: network, width: 48 } }, { printRaw, printOs });
    expect(printOs).not.toHaveBeenCalled();
    expect(printRaw).toHaveBeenCalledTimes(1);
    const [target, bytes] = printRaw.mock.calls[0] as unknown as [unknown, Uint8Array];
    expect(target).toEqual(network);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(readable(bytes)).toContain("1234567890".repeat(4) + "12345678");
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.words).toMatch(/sent to the bill printer, 192\.168\.1\.50 \(80 mm\)/);
  });

  it("uses the width chosen: 58 mm is 32 characters", () => {
    expect(readable(testPageBytes(32, "x"))).toContain("12345678901234567890123456789012");
    expect(readable(testPageBytes(32, "x"))).not.toContain("123456789012345678901234567890123");
  });

  it("falls back to the computer's own printer only when no bill printer is set, and says so", async () => {
    const printRaw = vi.fn(async () => undefined);
    const printOs = vi.fn(async () => undefined);
    const result = await printTestPageVia(DEFAULT_PRINTER_SETTINGS, { printRaw, printOs });
    expect(printRaw).not.toHaveBeenCalled();
    expect(printOs).toHaveBeenCalledTimes(1);
    expect(result.ok && result.words).toMatch(/this computer's own printer/);
  });

  it("reports a failure with its reason", async () => {
    const result = await printTestPageVia(
      { ...DEFAULT_PRINTER_SETTINGS, receipt: { target: network, width: 48 } },
      { printRaw: async () => Promise.reject(new Error("The printer didn't take the ticket.")), printOs: async () => undefined },
    );
    expect(result).toEqual({ ok: false, error: "The printer didn't take the ticket." });
  });
});
