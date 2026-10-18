import { formatMoney } from "./money";
import { orderName, orderReference } from "./orderNumber";
import { dateTimeWords, paymentMethodWords, type SettlementMethod } from "./words";
export interface ReceiptLine {
  name: string;
  quantity: string;
  unitPrice?: string;
  total?: string;
}

export interface ReceiptCopy {
  propertyName?: string;
  outletName?: string;
  /** The order's reference: printed small as "Ref …" when the order has a number for the day. */
  orderNumber?: string;
  /** S5b: the order's number for the day ("Order 42"); absent on receipts made before S5b. */
  dailyNumber?: number;
  tableNumber?: string;
  takenBy?: string;
  settledBy?: string;
  settledAt?: string;
  settlementMethod?: string;
  subtotal?: string;
  taxAmount?: string;
  totalAmount?: string;
  lines: ReceiptLine[];
}

/**
 * An amount from Yetu's document as a guest reads it: Yetu sends minor units
 * beside the currency (`totalMinor`, `currency`); a document that already
 * carries the words (`total`) keeps them.
 */
function amountWords(words: unknown, minor: unknown, currency: string | undefined): string | undefined {
  if (typeof words === "string") return words;
  return typeof minor === "number" ? formatMoney(minor, currency) : undefined;
}

export function receiptCopyFromPrintDocument(document: Record<string, unknown>): ReceiptCopy {
  const currency = typeof document.currency === "string" ? document.currency : undefined;
  const lines = Array.isArray(document.lines)
    ? document.lines.flatMap((line) => {
        if (!line || typeof line !== "object") return [];
        const row = line as Record<string, unknown>;
        if (typeof row.name !== "string") return [];
        return [
          {
            name: row.name,
            quantity: String(row.quantity ?? "1"),
            unitPrice: typeof row.unitPrice === "string" ? row.unitPrice : undefined,
            total: typeof row.total === "string" ? row.total : undefined,
          },
        ];
      })
    : Array.isArray(document.items)
      ? document.items.flatMap((line) => {
          if (!line || typeof line !== "object") return [];
          const row = line as Record<string, unknown>;
          if (typeof row.name !== "string") return [];
          return [
            {
              name: row.name,
              quantity: String(row.quantity ?? "1"),
              total: amountWords(row.total, row.totalMinor, currency),
            },
          ];
        })
      : [];

  const takenBy =
    typeof document.initiatedByName === "string"
      ? document.initiatedByName
      : typeof document.takenBy === "string"
        ? document.takenBy
        : undefined;
  const settledBy =
    typeof document.operatorName === "string"
      ? document.operatorName
      : typeof document.settledBy === "string"
        ? document.settledBy
        : undefined;

  return {
    propertyName: typeof document.propertyName === "string" ? document.propertyName : undefined,
    outletName: typeof document.outletName === "string" ? document.outletName : undefined,
    orderNumber: typeof document.orderNumber === "string" ? document.orderNumber : undefined,
    dailyNumber: typeof document.dailyNumber === "number" ? document.dailyNumber : undefined,
    tableNumber:
      typeof document.tableLabel === "string"
        ? document.tableLabel
        : typeof document.tableNumber === "string"
          ? document.tableNumber
          : undefined,
    takenBy,
    settledBy,
    settledAt: typeof document.settledAt === "string" ? dateTimeWords(document.settledAt) || undefined : undefined,
    settlementMethod:
      typeof document.tenderMethod === "string"
        ? paymentMethodWords(document.tenderMethod as SettlementMethod)
        : typeof document.settlementMethod === "string"
          ? paymentMethodWords(document.settlementMethod as SettlementMethod)
          : undefined,
    subtotal: amountWords(document.subtotal, document.subtotalMinor, currency),
    taxAmount: amountWords(document.taxAmount, document.taxMinor, currency),
    totalAmount: amountWords(document.totalAmount, document.totalMinor, currency),
    lines,
  };
}

/**
 * Guest invoice (operational settlement snapshot). Property brand at the top,
 * Yetu at the bottom. Not a TRA EFD fiscal receipt.
 */
export function formatReceipt(receipt: ReceiptCopy): string {
  const header = [
    (receipt.propertyName ?? "PROPERTY").toUpperCase(),
    receipt.outletName ? receipt.outletName : null,
    "INVOICE",
    receipt.dailyNumber || receipt.orderNumber ? orderName(receipt) : "order",
    orderReference(receipt) ? `Ref ${orderReference(receipt)}` : null,
    [
      receipt.tableNumber ? `Table ${receipt.tableNumber}` : null,
      receipt.settlementMethod ? receipt.settlementMethod : null,
    ]
      .filter(Boolean)
      .join("  "),
    receipt.takenBy ? `Taken by ${receipt.takenBy}` : null,
    receipt.settledBy && receipt.settledBy !== receipt.takenBy
      ? `Settled by ${receipt.settledBy}`
      : null,
    receipt.settledAt ? `Paid ${receipt.settledAt}` : null,
  ]
    .filter((line) => line && line.length > 0)
    .join("\n");

  const lines = receipt.lines
    .map((line) => {
      const qty = (line.quantity.trim() || "1").padStart(3, " ");
      const total = line.total?.trim() ? line.total.trim().padStart(8, " ") : "";
      return `${qty}  ${line.name}${total ? `  ${total}` : ""}`;
    })
    .join("\n");

  const totals = [
    receipt.subtotal ? `Subtotal  ${receipt.subtotal}` : null,
    receipt.taxAmount ? `VAT  ${receipt.taxAmount}` : null,
    receipt.totalAmount ? `TOTAL  ${receipt.totalAmount}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const footer = [
    "----------------",
    "Powered by Yetu",
    "Not a TRA fiscal receipt — use EFD for tax invoices.",
  ].join("\n");

  return `${header}\n\n${lines || "(no items)"}\n\n${totals}\n\n${footer}\n`;
}
