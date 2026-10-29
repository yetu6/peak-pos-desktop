import { EscPos, type PaperWidth } from "./escpos";
import { printerWords, type PrinterChoice, type PrinterSettings, type PrinterTarget } from "./printerSettings";

/**
 * The test page for a bill printer: made like a bill (raw ESC/POS at the
 * printer's own width), so it shows what bills will look like on that paper.
 */
export function testPageBytes(width: PaperWidth, printerName: string): Uint8Array {
  const out = new EscPos(width).align("center").bold(true).size(1, 2).line("Yetu printer test").size(1, 1).bold(false).align("left");
  out.wrapped(`Printer: ${printerName}`);
  out.rule();
  out.line("1234567890".repeat(Math.ceil(width / 10)).slice(0, width));
  out.line(`Paper: ${width === 48 ? "80 mm" : "58 mm"}, ${width} characters across`);
  out.rule();
  out.wrapped("If you can read this and it fits the paper, bills will print the same way.");
  return out.cut().build();
}

export type TestPageResult = { ok: true; words: string | null } | { ok: false; error: string };

/**
 * Prints the test page the way real bills go out: to the bill printer chosen in
 * Printers when there is one, otherwise through this computer's own printer.
 * The result says which.
 */
export async function printTestPageVia(
  settings: PrinterSettings,
  send: { printRaw: (target: PrinterTarget, bytes: Uint8Array) => Promise<void>; printOs: () => Promise<void> },
): Promise<TestPageResult> {
  const choice: PrinterChoice | null = settings.receipt;
  try {
    if (choice) {
      const name = printerWords(choice);
      await send.printRaw(choice.target, testPageBytes(choice.width, name));
      return { ok: true, words: `Test page sent to the bill printer, ${name}, the same way bills print. Check it came out and fits the paper.` };
    }
    await send.printOs();
    return {
      ok: true,
      words: "Test page sent to this computer's own printer. No bill printer is set up in Printers, so this isn't how bills will look on a thermal printer.",
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
