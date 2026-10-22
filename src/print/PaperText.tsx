import { Fragment, type ReactNode } from "react";
import { BILL_HEADING } from "../lib/receiptPrint";
import { PAPER_WORDS } from "./paperWords";
import { PRINT_BRAND } from "./printBrand";

const HEADINGS = new Set<string>([
  PAPER_WORDS.kitchenOrder, PAPER_WORDS.barOrder, PAPER_WORDS.handOver, PAPER_WORDS.make,
  BILL_HEADING, `${BILL_HEADING} - PAID`, `${BILL_HEADING} · PAID`,
]);

/** Styling annotates decoded text; no content is inserted, trimmed or reconstructed. */
export function renderPaperText(text: string | null): ReactNode {
  if (text === null) return null;
  const lines = text.split("\n");
  return lines.map((line, index) => {
    const footer = line.trim() === PRINT_BRAND;
    const heading = HEADINGS.has(line.trim());
    return <Fragment key={index}>
      {footer ? <span style={{ display: "inline-block", width: "100%", textAlign: "center", fontWeight: 700, whiteSpace: "normal" }}>{line}</span>
        : heading ? <span style={{ fontWeight: 700 }}>{line}</span> : line}
      {index < lines.length - 1 ? "\n" : null}
    </Fragment>;
  });
}
