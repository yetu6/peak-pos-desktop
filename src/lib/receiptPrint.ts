import { formatMoney } from "./money";
import { vatFigures } from "./vatWords";
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
  /** S8b: what came off the order (follow-up 45), and why. */
  discount?: string;
  discountReason?: string;
  taxAmount?: string;
  totalAmount?: string;
  /** F-229: the prices hold their VAT: "Items" and "VAT included" in place of "Subtotal" and "VAT". */
  vatIncluded?: boolean;
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
    ...guestFigures(document, currency),
    discountReason: typeof document.discountReason === "string" && document.discountReason.trim() ? document.discountReason.trim() : undefined,
    taxAmount: amountWords(document.taxAmount, document.taxMinor, currency),
    totalAmount: amountWords(document.totalAmount, document.totalMinor, currency),
    lines,
  };
}

/**
 * Subtotal and discount as the guest reads them: with VAT inside the prices
 * (F-229), the items at their menu prices and what came off those.
 */
function guestFigures(document: Record<string, unknown>, currency: string | undefined): Pick<ReceiptCopy, "subtotal" | "discount" | "vatIncluded"> {
  const items = Array.isArray(document.items) ? document.items : [];
  if (document.pricesIncludeTax === true && typeof document.totalMinor === "number" && typeof document.subtotalMinor === "number") {
    const figures = vatFigures({
      pricesIncludeTax: true,
      subtotalMinor: document.subtotalMinor,
      taxMinor: typeof document.taxMinor === "number" ? document.taxMinor : 0,
      totalMinor: document.totalMinor,
      items: items.flatMap((line) =>
        line && typeof line === "object" && typeof (line as Record<string, unknown>).totalMinor === "number"
          ? [{ totalMinor: (line as { totalMinor: number }).totalMinor }]
          : [],
      ),
    });
    return {
      subtotal: formatMoney(figures.itemsMinor, currency),
      discount: figures.discountMinor > 0 ? formatMoney(figures.discountMinor, currency) : undefined,
      vatIncluded: true,
    };
  }
  return {
    subtotal: amountWords(document.subtotal, document.subtotalMinor, currency),
    discount: typeof document.discountMinor === "number" && document.discountMinor > 0 ? formatMoney(document.discountMinor, currency) : undefined,
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
    receipt.subtotal ? `${receipt.vatIncluded ? "Items" : "Subtotal"}  ${receipt.subtotal}` : null,
    receipt.discount ? `${receipt.discountReason ? `Discount (${receipt.discountReason})` : "Discount"}  -${receipt.discount}` : null,
    receipt.taxAmount ? `${receipt.vatIncluded ? "VAT included" : "VAT"}  ${receipt.taxAmount}` : null,
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
