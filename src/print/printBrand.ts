/** Owner, 22 Oct 2026: this signature belongs at the foot of every paper. */
export const PRINT_BRAND = "Powered by Yetu-FBC";
export function printBrandFooter(width = 48): string {
  return `${"-".repeat(width)}\n${" ".repeat(Math.max(0, Math.floor((width - PRINT_BRAND.length) / 2)))}${PRINT_BRAND}`;
}
