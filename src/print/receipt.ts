import { orderName, orderReference } from "../lib/orderNumber";
import type { ReceiptCopy } from "../lib/receiptPrint";
import { EscPos, printable, wrap, type PaperWidth } from "./escpos";

/**
 * The guest's receipt on a thermal printer (S8b): the property at the top,
 * the order's number large, each line with its amount at the right edge,
 * the discount, VAT and a large total, and a cut. The words are the text
 * receipt's (lib/receiptPrint.ts); only the layout is the paper's.
 */
export interface ReceiptPaperOptions {
  /** Open the cash drawer first (a cash payment's original receipt). */
  drawer?: boolean;
  /** A copy printed again: says COPY. */
  copy?: boolean;
}

/** Words at the left, wrapping; an amount at the right edge of their last line. */
function columns(out: EscPos, left: string, right: string, width: number): void {
  const amount = printable(right);
  const lines = wrap(left, Math.max(8, width - amount.length - 1));
  lines.forEach((part, index) => {
    if (index < lines.length - 1 || !amount) out.line(part);
    else out.line(part + " ".repeat(Math.max(1, width - part.length - amount.length)) + amount);
  });
}

export function receiptBytes(receipt: ReceiptCopy, width: PaperWidth, options: ReceiptPaperOptions = {}): Uint8Array {
  const out = new EscPos(width);
  if (options.drawer) out.drawer();
  out.align("center").bold(true).size(1, 2).wrapped((receipt.propertyName ?? "Property").toUpperCase()).size(1, 1);
  if (receipt.outletName) out.wrapped(receipt.outletName);
  out.bold(false).line("INVOICE");
  if (options.copy) out.bold(true).line("*** COPY ***").bold(false);
  if (receipt.dailyNumber || receipt.orderNumber) out.bold(true).size(2, 2).line(orderName(receipt)).size(1, 1).bold(false);
  const reference = orderReference(receipt);
  if (reference) out.line(`Ref ${reference}`);
  out.align("left").rule();

  const place = [receipt.tableNumber ? `Table ${receipt.tableNumber}` : null, receipt.settlementMethod].filter(Boolean).join("  ");
  if (place) out.wrapped(place);
  if (receipt.takenBy) out.wrapped(`Taken by ${receipt.takenBy}`);
  if (receipt.settledBy && receipt.settledBy !== receipt.takenBy) out.wrapped(`Settled by ${receipt.settledBy}`);
  if (receipt.settledAt) out.wrapped(`Paid ${receipt.settledAt}`);
  out.rule();

  if (receipt.lines.length === 0) out.line("(no items)");
  for (const line of receipt.lines) columns(out, `${line.quantity.trim() || "1"} x ${line.name}`, line.total ?? "", width);
  out.rule();

  if (receipt.subtotal) columns(out, receipt.vatIncluded ? "Items" : "Subtotal", receipt.subtotal, width);
  if (receipt.discount) columns(out, receipt.discountReason ? `Discount (${receipt.discountReason})` : "Discount", `-${receipt.discount}`, width);
  if (receipt.taxAmount) columns(out, receipt.vatIncluded ? "VAT included" : "VAT", receipt.taxAmount, width);
  if (receipt.totalAmount) {
    out.bold(true).size(1, 2);
    columns(out, "TOTAL", receipt.totalAmount, width);
    out.size(1, 1).bold(false);
  }
  out.rule().align("center").line("Powered by Yetu").wrapped("Not a TRA fiscal receipt - use EFD for tax invoices.");
  return out.feed(3).cut().build();
}

/** A slip Yetu's text formatter already laid out (a refund), wrapped to the paper, with a cut. */
export function textPaperBytes(text: string, width: PaperWidth, options: ReceiptPaperOptions = {}): Uint8Array {
  const out = new EscPos(width);
  if (options.drawer) out.drawer();
  if (options.copy) out.align("center").bold(true).line("*** COPY ***").bold(false).align("left");
  for (const line of text.replace(/\n+$/, "").split("\n")) {
    if (line.trim() === "") out.line();
    else out.wrapped(line);
  }
  return out.feed(3).cut().build();
}
