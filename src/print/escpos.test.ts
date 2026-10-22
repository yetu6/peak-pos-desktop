import { describe, expect, it } from "vitest";
import { EscPos, PAPER_58MM, printable, readable, wrap } from "./escpos";

describe("ESC/POS", () => {
  it("starts clean, sets type and cuts with the printers' own commands", () => {
    const bytes = new EscPos(PAPER_58MM).bold(true).size(2, 2).align("center").line("42").cut().build();
    expect(Array.from(bytes).slice(0, 14)).toEqual([
      0x1b, 0x40, // ESC @
      0x1b, 0x45, 1, // bold on
      0x1d, 0x21, 0x11, // double width and height
      0x1b, 0x61, 1, // centre
      0x34, 0x32, 0x0a, // "42"
    ]);
    expect(readable(bytes)).toBe("42\nPowered by Yetu\nyetu.fbcsoftwares.com\n");
    expect(Array.from(bytes).slice(-4)).toEqual([0x1d, 0x56, 0x42, 3]);
  });

  it("opens the cash drawer on pin 2", () => {
    expect(Array.from(new EscPos(PAPER_58MM).drawer().build()).slice(2)).toEqual([0x1b, 0x70, 0, 25, 250]);
  });

  it("spells out what the printer can't show", () => {
    expect(printable("Café crème · Pint – “cold”")).toBe('Cafe creme - Pint - "cold"');
    expect(printable("Chai ☕")).toBe("Chai ?");
  });

  it("wraps words to the line, and cuts a word longer than a line", () => {
    expect(wrap("Nyama choma with kachumbari and ugali", 16)).toEqual(["Nyama choma with", "kachumbari and", "ugali"]);
    expect(wrap("abcdefghijklmnopqrst", 8)).toEqual(["abcdefgh", "ijklmnop", "qrst"]);
  });

  it("reads back as the words on the paper", () => {
    const bytes = new EscPos(PAPER_58MM).bold(true).line("ORDER 42").bold(false).rule().drawer().cut().build();
    expect(readable(bytes)).toBe(`ORDER 42\n${"-".repeat(32)}\nPowered by Yetu\nyetu.fbcsoftwares.com\n`);
  });
});
