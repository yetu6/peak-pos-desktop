import { printable, wrap, type PaperWidth } from "./escpos";
import { PAPER_WORDS } from "./paperWords";

/** Align the supplied money words; never calculate or change a bill amount. */
export function billItemColumns(lines: readonly { name: string; quantity: string; total?: string }[], width: PaperWidth): string[] {
  const amounts = lines.map(line => printable(line.total?.trim() ?? ""));
  const amountWidth = Math.min(width - 12, Math.max(PAPER_WORDS.amount.length, ...amounts.map(amount => amount.length)));
  const quantityWidth = Math.max(PAPER_WORDS.quantity.length, ...lines.map(line => line.quantity.trim().length));
  const nameWidth = Math.max(1, width - amountWidth - quantityWidth - 2);
  const row = (name: string, quantity: string, amount: string) => `${name.padEnd(nameWidth)} ${quantity.padStart(quantityWidth)} ${amount.padStart(amountWidth)}`;
  const rows = [row(PAPER_WORDS.item, PAPER_WORDS.quantity, PAPER_WORDS.amount)];
  for (const [index, line] of lines.entries()) {
    const parts = wrap(line.name, nameWidth);
    parts.forEach((part, partIndex) => rows.push(row(part, partIndex === parts.length - 1 ? line.quantity.trim() || "1" : "", partIndex === parts.length - 1 ? amounts[index] : "")));
  }
  return rows;
}
