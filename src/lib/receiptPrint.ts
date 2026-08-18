export interface ReceiptLine {
  name: string;
  quantity: string;
  unitPrice?: string;
  total?: string;
}

export interface ReceiptCopy {
  orderNumber?: string;
  tableNumber?: string;
  settledAt?: string;
  settlementMethod?: string;
  subtotal?: string;
  taxAmount?: string;
  totalAmount?: string;
  lines: ReceiptLine[];
}

export function receiptCopyFromPrintDocument(document: Record<string, unknown>): ReceiptCopy {
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
    : [];
  return {
    orderNumber: typeof document.orderNumber === "string" ? document.orderNumber : undefined,
    tableNumber: typeof document.tableNumber === "string" ? document.tableNumber : undefined,
    settledAt: typeof document.settledAt === "string" ? document.settledAt : undefined,
    settlementMethod:
      typeof document.settlementMethod === "string" ? document.settlementMethod : undefined,
    subtotal: typeof document.subtotal === "string" ? document.subtotal : undefined,
    taxAmount: typeof document.taxAmount === "string" ? document.taxAmount : undefined,
    totalAmount: typeof document.totalAmount === "string" ? document.totalAmount : undefined,
    lines,
  };
}

/** Guest bill. Unlike a kitchen ticket, this copy includes prices Peak already posted. */
export function formatReceipt(receipt: ReceiptCopy): string {
  const header = [
    "RECEIPT",
    receipt.orderNumber ?? "order",
    [
      receipt.tableNumber ? `Table ${receipt.tableNumber}` : null,
      receipt.settlementMethod ? receipt.settlementMethod.replaceAll("_", " ") : null,
    ]
      .filter(Boolean)
      .join("  "),
    receipt.settledAt ? `Settled ${receipt.settledAt}` : null,
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
    receipt.taxAmount ? `Tax  ${receipt.taxAmount}` : null,
    receipt.totalAmount ? `TOTAL  ${receipt.totalAmount}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `${header}\n\n${lines || "(no items)"}\n\n${totals}\n`;
}
