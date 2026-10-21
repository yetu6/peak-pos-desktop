import { orderName, orderReference } from "../lib/orderNumber";
import { BILL_HEADING, CHARGE_TO_ROOM, GUEST_SIGNATURE, type ReceiptCopy } from "../lib/receiptPrint";
import { EscPos, printable, wrap, type PaperWidth } from "./escpos";
import { placeWords } from "../lib/words";

/**
 * The guest's bill on a thermal printer (S8b; a bill since 2026-10-20): the
 * property at the top, BILL, the order's number large, each line with its
 * amount at the right edge, the discount, VAT and total, and before payment
 * a large TO PAY; Yetu at the foot, and a cut. The words
 * are the text bill's (lib/receiptPrint.ts); only the layout is the paper's.
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
  out.bold(true).line(receipt.beforePayment ? BILL_HEADING : `${BILL_HEADING} - PAID`).bold(false);
  if (options.copy) out.bold(true).line("*** COPY ***").bold(false);
  if (receipt.dailyNumber || receipt.orderNumber) out.bold(true).size(2, 2).line(orderName(receipt)).size(1, 1).bold(false);
  const reference = orderReference(receipt);
  if (reference) out.line(`Ref ${reference}`);
  out.align("left").rule();

  const place = [placeWords(receipt.serviceType, receipt.tableNumber) || null, receipt.settlementMethod].filter(Boolean).join("  ");
  if (place) out.wrapped(place);
  if (receipt.takenBy) out.wrapped(`Taken by ${receipt.takenBy}`);
  if (receipt.settledBy && receipt.settledBy !== receipt.takenBy) out.wrapped(`Settled by ${receipt.settledBy}`);
  if (receipt.settledAt) out.wrapped(`Paid ${receipt.settledAt}`);
  if (receipt.printedAt) out.wrapped(`Printed ${receipt.printedAt}`);
  out.rule();

  if (receipt.lines.length === 0) out.line("(no items)");
  for (const line of receipt.lines) columns(out, `${line.quantity.trim() || "1"} x ${line.name}`, line.total ?? "", width);
  out.rule();

  if (receipt.subtotal) columns(out, receipt.vatIncluded ? "Items" : "Subtotal", receipt.subtotal, width);
  if (receipt.discount) columns(out, receipt.discountReason ? `Discount (${receipt.discountReason})` : "Discount", `-${receipt.discount}`, width);
  if (receipt.taxAmount) columns(out, receipt.vatIncluded ? "VAT included" : "VAT", receipt.taxAmount, width);
  if (receipt.totalAmount) {
    out.bold(true).size(1, receipt.toPay ? 1 : 2);
    columns(out, "TOTAL", receipt.totalAmount, width);
    out.size(1, 1).bold(false);
  }
  if (receipt.paidAlready) columns(out, "Paid already", receipt.paidAlready, width);
  if (receipt.toPay) {
    out.bold(true).size(1, 2);
    columns(out, "TO PAY", receipt.toPay, width);
    out.size(1, 1).bold(false);
  }
  if (receipt.roomCharge) {
    // A hotel's guest signs the bill to charge it to their room; the restaurant keeps it.
    out.rule().bold(true).line(CHARGE_TO_ROOM).bold(false);
    out.line(`Room ${receipt.roomCharge.room ?? "_".repeat(Math.max(8, width - 6))}`).feed(1);
    out.line(GUEST_SIGNATURE).feed(2).line("_".repeat(width));
  }
  out.rule().align("center").line("Powered by Yetu");
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
