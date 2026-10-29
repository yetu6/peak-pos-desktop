import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrinterHealth } from "./printerHealth";
import { PRINT_CHECK_AFTER_SECONDS, checkPrinter, forgetPrinterProblem, printerProblemNow, watchAfterPrint } from "./printerWatch";

const said = (state: PrinterHealth["state"], stuckJobs = 0): PrinterHealth => ({ state, detail: null, stuckJobs });

// Owner, 2026-10-29: out of paper, papers were sent, nothing came out, and
// nobody was told. Windows takes a paper whatever the printer's state, so the
// till asks again after printing and says what is wrong on every screen.
describe("the printer after a print", () => {
  afterEach(() => {
    forgetPrinterProblem();
    vi.useRealTimers();
  });

  it("asks Windows again after printing, and an empty printer is said", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => said("paper-out", 1));
    watchAfterPrint({ kind: "system", name: "XP-80" }, check);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PRINT_CHECK_AFTER_SECONDS[0] * 1000);
    expect(check).toHaveBeenCalledWith("XP-80");
    expect(printerProblemNow()).toEqual({ printer: "XP-80", words: "Out of paper. 1 paper waiting to print" });
  });

  it("papers still waiting on a printer that calls itself ready are said too", async () => {
    await checkPrinter("XP-80", async () => said("ready", 2));
    expect(printerProblemNow()?.words).toBe("2 papers waiting to print");
  });

  it("the problem stays until a check finds the printer right", async () => {
    await checkPrinter("XP-80", async () => said("paper-out"));
    await checkPrinter("XP-80", async () => said("unknown"));
    expect(printerProblemNow()?.words).toBe("Out of paper");
    await checkPrinter("XP-80", async () => said("ready"));
    expect(printerProblemNow()).toBeNull();
  });

  it("Windows not knowing raises no alarm, and a network printer isn't asked", async () => {
    vi.useFakeTimers();
    await checkPrinter("XP-80", async () => said("unknown"));
    expect(printerProblemNow()).toBeNull();
    const check = vi.fn(async () => said("paper-out"));
    watchAfterPrint({ kind: "network", host: "192.168.1.9", port: 9100 }, check);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).not.toHaveBeenCalled();
  });
});
