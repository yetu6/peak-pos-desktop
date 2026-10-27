import { billItemColumns } from "../print/billColumns";
import { PAPER_WORDS } from "../print/paperWords";
import { printBrandFooter } from "../print/printBrand";
import { guestCountWords } from "./words";
import { formatMoney } from "./money";
import { lineAmountMinor, vatFigures } from "./vatWords";
import { orderName, orderReference } from "./orderNumber";
import { dateTimeWords, paymentMethodWords, placeWords, type SettlementMethod } from "./words";
/**
 * The owner, 2026-10-20: Yetu is not connected to TRA's VFD, so nothing it
 * prints is the tax receipt. The restaurant's EFD issues that when the guest
 * pays; Yetu's paper is the BILL, handed over before they pay. The owner
 * chose to say nothing about TRA on it: the heading says what it is.
 */
export const BILL_HEADING = "BILL";
/** A hotel's bill (2026-10-20): the guest who charges it to their room signs it first. */
export const CHARGE_TO_ROOM = "Charge to room";
export const GUEST_SIGNATURE = "Guest signature";

export interface ReceiptLine {
  name: string;
  quantity: string;
  unitPrice?: string;
  total?: string;
}

export interface ReceiptCopy {
  copy?: boolean;
  printedAgainByName?: string;
  printedAgainAt?: string;
  propertyName?: string;
  propertyAddress?: string;
  propertyPhone?: string;
  outletName?: string;
  /** The order's reference: printed small as "Ref …" when the order has a number for the day. */
  orderNumber?: string;
  /** S5b: the order's number for the day ("Order 42"); absent on receipts made before S5b. */
  dailyNumber?: number;
  tableNumber?: string;
  /** The order's type, so its place reads as a table, a room or a name. */
  serviceType?: string;
  askForTable?: boolean;
  guestCount?: number;
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
  /**
   * A bill printed before payment (Yetu's kind BILL, 2026-10-20): what is
   * paid already, what is still to pay, and who printed it when. Absent on a
   * paid order's bill.
   */
  beforePayment?: boolean;
  paidAlready?: string;
  toPay?: string;
  printedBy?: string;
  printedAt?: string;
  /**
   * At a hotel, a bill before payment ends with lines for the guest who
   * charges it to their room: the room (filled in for room service) and
   * their signature. The restaurant keeps the signed bill (2026-10-20).
   */
  roomCharge?: { room?: string };
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

export function receiptCopyFromPrintDocument(document: Record<string, unknown>, place: { hotel?: boolean } = {}): ReceiptCopy {
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
              // As on screen: the line adds up to the Subtotal under it (lineAmountMinor).
              total:
                typeof row.total !== "string" && typeof row.totalMinor === "number"
                  ? formatMoney(lineAmountMinor(document.pricesIncludeTax === true, { totalMinor: row.totalMinor, taxMinor: typeof row.taxMinor === "number" ? row.taxMinor : 0 }), currency)
                  : amountWords(row.total, row.totalMinor, currency),
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
    copy: document.copy === true,
    printedAgainByName: typeof document.printedAgainByName === "string" ? document.printedAgainByName : undefined,
    printedAgainAt: typeof document.printedAgainAt === "string" ? dateTimeWords(document.printedAgainAt) || undefined : undefined,
    propertyName: typeof document.propertyName === "string" ? document.propertyName : undefined,
    propertyAddress: typeof document.address === "string" ? document.address.trim() || undefined : typeof document.propertyAddress === "string" ? document.propertyAddress.trim() || undefined : undefined,
    propertyPhone: typeof document.phone === "string" ? document.phone.trim() || undefined : typeof document.propertyPhone === "string" ? document.propertyPhone.trim() || undefined : undefined,
    outletName: typeof document.outletName === "string" ? document.outletName : undefined,
    orderNumber: typeof document.orderNumber === "string" ? document.orderNumber : undefined,
    dailyNumber: typeof document.dailyNumber === "number" ? document.dailyNumber : undefined,
    tableNumber:
      typeof document.tableLabel === "string"
        ? document.tableLabel
        : typeof document.tableNumber === "string"
          ? document.tableNumber
          : undefined,
    serviceType: typeof document.serviceType === "string" ? document.serviceType : undefined,
    askForTable: typeof document.askForTable === "boolean" ? document.askForTable : undefined,
    guestCount: typeof document.guestCount === "number" && Number.isSafeInteger(document.guestCount) && document.guestCount > 0 ? document.guestCount : undefined,
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
    ...billFigures(document, currency),
    roomCharge:
      place.hotel && document.kind === "BILL"
        ? { room: document.serviceType === "ROOM_SERVICE" && typeof document.tableLabel === "string" && document.tableLabel.trim() ? document.tableLabel.trim() : undefined }
        : undefined,
    lines,
  };
}

/** A bill before payment (kind BILL): what is paid already, still to pay, and who printed it when. */
function billFigures(document: Record<string, unknown>, currency: string | undefined): Partial<ReceiptCopy> {
  if (document.kind !== "BILL") return {};
  const paid = typeof document.paidMinor === "number" ? document.paidMinor : 0;
  const toPay = typeof document.remainingMinor === "number" ? document.remainingMinor : typeof document.totalMinor === "number" ? document.totalMinor : undefined;
  return {
    beforePayment: true,
    paidAlready: paid > 0 ? formatMoney(paid, currency) : undefined,
    toPay: toPay !== undefined ? formatMoney(toPay, currency) : undefined,
    printedBy: typeof document.printedByName === "string" && document.printedByName.trim() ? document.printedByName.trim() : undefined,
    printedAt: typeof document.printedAt === "string" ? dateTimeWords(document.printedAt) || undefined : undefined,
    // A bill is printed before payment: no tender, no settlement time on it.
    settledAt: undefined,
    settledBy: undefined,
    settlementMethod: undefined,
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
 * The guest's bill as text: before payment (kind BILL) it ends with what is
 * still to pay; a paid order's bill, printed again on request, says it was
 * paid. Property at the top, Yetu at the bottom (2026-10-20).
 */
export function formatReceipt(receipt: ReceiptCopy): string {
  const header = [
    (receipt.propertyName ?? "PROPERTY").toUpperCase(),
    receipt.outletName ? receipt.outletName : null,
    [receipt.propertyAddress, receipt.propertyPhone].filter(Boolean).join(" · "),
    receipt.copy ? "*** COPY ***" : null,
    receipt.copy && receipt.printedAgainAt ? `Printed again ${receipt.printedAgainAt}` : null,
    receipt.copy && receipt.printedAgainByName ? `by ${receipt.printedAgainByName}` : null,
    receipt.beforePayment ? BILL_HEADING : `${BILL_HEADING} - PAID`,
    receipt.dailyNumber || receipt.orderNumber ? orderName(receipt) : "order",
    orderReference(receipt) ? `Ref ${orderReference(receipt)}` : null,
    [
      placeWords(receipt.serviceType, receipt.tableNumber, receipt.askForTable) || null,
      receipt.settlementMethod ? receipt.settlementMethod : null,
    ]
      .filter(Boolean)
      .join("  "),
    receipt.guestCount ? guestCountWords(receipt.guestCount) : null,
    receipt.takenBy ? `Taken by ${receipt.takenBy}` : null,
    receipt.settledBy && receipt.settledBy !== receipt.takenBy
      ? `Settled by ${receipt.settledBy}`
      : null,
    receipt.settledAt ? `Paid ${receipt.settledAt}` : null,
    receipt.printedAt ? `Printed ${receipt.printedAt}` : null,
  ]
    .filter((line) => line && line.length > 0)
    .join("\n");

  const lines = billItemColumns(receipt.lines, 48).join("\n");

  const totals = [
    receipt.subtotal ? `${receipt.vatIncluded ? "Items" : "Subtotal"}  ${receipt.subtotal}` : null,
    receipt.discount ? `${receipt.discountReason ? `Discount (${receipt.discountReason})` : "Discount"}  -${receipt.discount}` : null,
    receipt.taxAmount ? `${receipt.vatIncluded ? "VAT included" : "VAT"}  ${receipt.taxAmount}` : null,
    receipt.totalAmount ? `TOTAL  ${receipt.totalAmount}` : null,
    receipt.paidAlready ? `Paid already  ${receipt.paidAlready}` : null,
    receipt.toPay ? `TO PAY  ${receipt.toPay}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const signing = receipt.roomCharge
    ? ["----------------", CHARGE_TO_ROOM, `Room ${receipt.roomCharge.room ?? "________"}`, GUEST_SIGNATURE, "", "________________________"].join("\n") + "\n\n"
    : "";

  const footer = ["----------------", receipt.beforePayment ? PAPER_WORDS.payThanks : PAPER_WORDS.thanks, printBrandFooter()].join("\n");

  return `${header}\n\n${lines || "(no items)"}\n\n${totals}\n\n${signing}${footer}\n`;
}
