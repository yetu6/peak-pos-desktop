/**
 * Owner, 22 Oct 2026: this signature belongs at the foot of every paper. The
 * product's name, bold, then where to find it, plain.
 */
export const PRINT_BRAND = "Powered by Yetu";
export const PRINT_BRAND_ADDRESS = "yetu.fbcsoftwares.com";
export const PRINT_BRAND_LINES = [PRINT_BRAND, PRINT_BRAND_ADDRESS] as const;

/** A line of a laid-out paper that is the signature, however it was padded. */
export function isPrintBrandLine(line: string): boolean {
  return (PRINT_BRAND_LINES as readonly string[]).includes(line.trim());
}

function centred(text: string, width: number): string {
  return `${" ".repeat(Math.max(0, Math.floor((width - text.length) / 2)))}${text}`;
}

export function printBrandFooter(width = 48): string {
  return ["-".repeat(width), ...PRINT_BRAND_LINES.map((line) => centred(line, width))].join("\n");
}
