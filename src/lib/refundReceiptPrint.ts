import { formatMoney } from "./money";
import { orderName, orderReference } from "./orderNumber";
import { dateTimeWords, paymentMethodWords, type SettlementMethod } from "./words";

/**
 * The slip a refund prints (Yetu's REFUND_RECEIPT job, written by
 * internal/pos/refunds.go `RefundReceiptDocument`): what was given back, how,
 * why, and who asked and who approved. Money comes in minor units beside the
 * currency and goes out in words; given-back amounts are written as positive
 * figures under "Given back", never with a minus sign a printer may not have.
 */
export interface RefundReceiptCopy {
  propertyName?: string;
  outletName?: string;
  orderNumber?: string;
  dailyNumber?: number;
  refundedAt?: string;
  lines: { name: string; quantity: string; total: string }[];
  discount?: string;
  tax?: string;
  total?: string;
  tenders: { words: string; amount: string }[];
  reason?: string;
  askedBy?: string;
  approvedBy?: string;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];
}

/** How the money went back, in words: a room charge comes off the guest's bill. */
function tenderWords(method: string): string {
  return method === "ROOM_CHARGE" ? "Taken off the room bill" : paymentMethodWords(method as SettlementMethod);
}

export function refundReceiptCopyFromPrintDocument(document: Record<string, unknown>): RefundReceiptCopy {
  const currency = text(document.currency);
  const money = (minor: unknown) => (typeof minor === "number" ? formatMoney(minor, currency) : undefined);
  const discountMinor = typeof document.discountMinor === "number" ? document.discountMinor : 0;
  return {
    propertyName: text(document.propertyName),
    outletName: text(document.outletName),
    orderNumber: text(document.orderNumber),
    dailyNumber: typeof document.dailyNumber === "number" ? document.dailyNumber : undefined,
    refundedAt: typeof document.refundedAt === "string" ? dateTimeWords(document.refundedAt) || undefined : undefined,
    lines: rows(document.lines).flatMap((row) => {
      const name = text(row.name);
      return name ? [{ name, quantity: String(row.quantity ?? "1"), total: money(row.totalMinor) ?? "" }] : [];
    }),
    discount: discountMinor > 0 ? money(discountMinor) : undefined,
    tax: money(document.taxMinor),
    total: money(document.totalMinor),
    tenders: rows(document.tenders).flatMap((row) => {
      const method = text(row.paymentMethod);
      const amount = money(row.amountMinor);
      return method && amount ? [{ words: tenderWords(method), amount }] : [];
    }),
    reason: text(document.reason),
    askedBy: text(document.initiatedByName),
    approvedBy: text(document.authorizedByName),
  };
}

export function formatRefundReceipt(refund: RefundReceiptCopy): string {
  const header = [
    (refund.propertyName ?? "PROPERTY").toUpperCase(),
    refund.outletName ?? null,
    "REFUND",
    refund.dailyNumber || refund.orderNumber ? orderName(refund) : null,
    orderReference(refund) ? `Ref ${orderReference(refund)}` : null,
    refund.refundedAt ?? null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  const lines = refund.lines
    .map((line) => `${(line.quantity.trim() || "1").padStart(3, " ")}  ${line.name}${line.total ? `  ${line.total}` : ""}`)
    .join("\n");

  const totals = [
    refund.discount ? `Less the order's discount  ${refund.discount}` : null,
    refund.total ? `Given back  ${refund.total}` : null,
    refund.tax ? `VAT included  ${refund.tax}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const how = refund.tenders.map((tender) => `${tender.words}  ${tender.amount}`).join("\n");

  const who = [
    refund.reason ? `Reason: ${refund.reason}` : null,
    refund.askedBy ? `Asked by ${refund.askedBy}` : null,
    refund.approvedBy ? `Approved by ${refund.approvedBy}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const footer = ["----------------", "Powered by Yetu", "Not a TRA fiscal receipt — use EFD for tax invoices."].join("\n");

  return [header, lines || "(no items)", totals, how, who, footer].filter(Boolean).join("\n\n") + "\n";
}
