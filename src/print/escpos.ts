/**
 * ESC/POS for the till's thermal printers (S8a): the commands every 58 mm
 * and 80 mm receipt printer takes -- start, bold, large type, centring, a
 * cut, the cash drawer -- and text the printer can show. A printer's own
 * code page is ASCII-safe only, so other letters are spelled out ("é" → "e",
 * "·" → "-") rather than printed as rubbish.
 */

const ESC = 0x1b;
const GS = 0x1d;

/** Characters a line holds: 58 mm paper 32, 80 mm paper 48 (Font A). */
export type PaperWidth = 32 | 48;

export const PAPER_58MM: PaperWidth = 32;
export const PAPER_80MM: PaperWidth = 48;

const SPELLED: Record<string, string> = {
  "·": "-", "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "×": "x", "•": "*",
};

/** Text the printer shows as written: ASCII, with other characters spelled out. */
export function printable(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFKD")) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code < 0x7f) out += ch;
    else if (SPELLED[ch] !== undefined) out += SPELLED[ch];
    else if (code >= 0x300 && code <= 0x36f) continue; // an accent, spelled out by NFKD
    else if (ch === "\n") out += "\n";
    else out += "?";
  }
  return out;
}

/** Words wrapped to the line's width; a word longer than a line is cut. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of printable(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (rest.length > width) {
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      if (!rest) continue;
      if (!line) line = rest;
      else if (line.length + 1 + rest.length <= width) line += ` ${rest}`;
      else {
        lines.push(line);
        line = rest;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Builds one print job's bytes, command by command. */
export class EscPos {
  private bytes: number[] = [ESC, 0x40]; // ESC @: start clean

  constructor(readonly width: PaperWidth) {}

  bold(on: boolean): this {
    this.bytes.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }

  /** Type size: 1 is normal, 2 is double (width × height). */
  size(width: 1 | 2, height: 1 | 2): this {
    this.bytes.push(GS, 0x21, ((width - 1) << 4) | (height - 1));
    return this;
  }

  align(where: "left" | "center"): this {
    this.bytes.push(ESC, 0x61, where === "center" ? 1 : 0);
    return this;
  }

  /** One line of text, as written (wrap first when it may be long). */
  line(text = ""): this {
    for (const ch of printable(text)) this.bytes.push(ch.charCodeAt(0));
    this.bytes.push(0x0a);
    return this;
  }

  /** Lines wrapped to `chars` a line (the width at the current type size). */
  wrapped(text: string, chars: number = this.width, indent = ""): this {
    for (const part of wrap(text, chars - indent.length)) this.line(indent + part);
    return this;
  }

  rule(): this {
    return this.line("-".repeat(this.width));
  }

  feed(lines: number): this {
    this.bytes.push(ESC, 0x64, lines);
    return this;
  }

  /** Feed past the cutter and cut, leaving a hinge (GS V 66 n). */
  cut(): this {
    this.bytes.push(GS, 0x56, 0x42, 3);
    return this;
  }

  /** Open the cash drawer on pin 2 (ESC p 0 25 250). */
  drawer(): this {
    this.bytes.push(ESC, 0x70, 0, 25, 250);
    return this;
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** The text in a job's bytes, without its commands: what a person reads on the paper. */
export function readable(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === ESC) {
      const op = bytes[i + 1];
      i += op === 0x40 ? 1 : op === 0x70 ? 4 : 2; // ESC @ | ESC p m t1 t2 | ESC x n
    } else if (b === GS) {
      i += bytes[i + 1] === 0x56 ? 3 : 2; // GS V m n | GS ! n
    } else out += String.fromCharCode(b);
  }
  return out;
}
