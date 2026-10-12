import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReceiptView } from "./ReceiptView";
import type { POSReceipt } from "../lib/posContracts";

const { reprintMutate, receiptRef } = vi.hoisted(() => ({
  reprintMutate: vi.fn(),
  receiptRef: { data: undefined as POSReceipt | undefined, isLoading: false, isError: false },
}));

vi.mock("../hooks/usePosData", () => ({
  useReceipt: () => receiptRef,
  useReprintReceipt: () => ({ mutate: reprintMutate, isPending: false, error: null }),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  useMutationMessage: () => null,
}));

const RECEIPT: POSReceipt = {
  id: "receipt-1",
  orderId: "order-1",
  status: "PRINTED",
  reprintCount: 0,
  createdAt: "2026-09-04T12:00:00Z",
  document: {
    orderId: "order-1",
    orderNumber: "POS-1",
    businessDate: "2026-09-04",
    propertyName: "Mama Rose Hotel",
    outletId: "outlet-1",
    outletName: "Main restaurant",
    terminalId: "terminal-1",
    initiatedById: "staff-1",
    initiatedByName: "Amina Hassan",
    operatorId: "staff-1",
    operatorName: "Amina Hassan",
    serviceType: "DINE_IN",
    items: [{ name: "Cappuccino", quantity: 2, unitPriceMinor: 6_500, taxMinor: 1_170, totalMinor: 14_170 }],
    subtotalMinor: 13_000,
    taxMinor: 1_170,
    totalMinor: 14_170,
    currency: "TZS",
    tenderMethod: "CASH",
    settledAt: "2026-09-04T12:00:00Z",
  },
};

describe("ReceiptView", () => {
  it("shows the settled document as Yetu kept it, in words, called a receipt", () => {
    receiptRef.data = RECEIPT;
    receiptRef.isLoading = false;
    receiptRef.isError = false;
    render(<ReceiptView orderId="order-1" onClose={vi.fn()} />);

    const sheet = screen.getByRole("dialog", { name: "Receipt" });
    const doc = screen.getByTestId("receipt-document");
    expect(screen.getByTestId("receipt-property")).toHaveTextContent("Mama Rose Hotel");
    expect(doc).toHaveTextContent("Order POS-1");
    expect(doc).toHaveTextContent("Paid by Cash");
    expect(doc).not.toHaveTextContent("CASH");
    expect(doc).toHaveTextContent("2 × Cappuccino");
    expect(doc).toHaveTextContent("TSh 141.70");
    expect(doc).toHaveTextContent("VAT");
    expect(screen.getByTestId("receipt-taken-by")).toHaveTextContent("Taken by Amina Hassan");
    expect(screen.getByTestId("receipt-footer")).toHaveTextContent(
      "This is not a tax receipt. Use your EFD machine for tax receipts.",
    );
    expect(sheet).not.toHaveTextContent(/invoice/i);
    expect(screen.queryByTestId("receipt-error")).not.toBeInTheDocument();
  });

  it("says where the order went and who took the payment, when someone else did", () => {
    receiptRef.data = {
      ...RECEIPT,
      document: { ...RECEIPT.document, tableLabel: "12", operatorId: "staff-2", operatorName: "Grace Mushi" },
    };
    render(<ReceiptView orderId="order-1" onClose={vi.fn()} />);
    expect(screen.getByTestId("receipt-document")).toHaveTextContent("Order POS-1 · Dine in · Table 12");
    expect(screen.getByTestId("receipt-settled-by")).toHaveTextContent("Payment taken by Grace Mushi");
  });

  it("says a split payment in words", () => {
    receiptRef.data = { ...RECEIPT, document: { ...RECEIPT.document, tenderMethod: "SPLIT" } };
    render(<ReceiptView orderId="order-1" onClose={vi.fn()} />);
    expect(screen.getByTestId("receipt-document")).toHaveTextContent("Paid by Split payment");
  });

  it("disables reprint until the real settled document has loaded", () => {
    receiptRef.data = undefined;
    receiptRef.isLoading = true;
    receiptRef.isError = false;
    render(<ReceiptView orderId="order-1" onClose={vi.fn()} />);

    expect(screen.getByTestId("reprint-receipt")).toBeDisabled();
  });

  it("calls the certified reprint endpoint with a fresh idempotency key, never a new original", async () => {
    receiptRef.data = RECEIPT;
    receiptRef.isLoading = false;
    receiptRef.isError = false;
    render(<ReceiptView orderId="order-1" onClose={vi.fn()} />);

    await userEvent.click(screen.getByTestId("reprint-receipt"));
    expect(reprintMutate).toHaveBeenCalledWith({ orderId: "order-1", idempotencyKey: "key-1" });
  });

  it("surfaces receipt-unavailable rather than fabricating one", () => {
    receiptRef.data = undefined;
    receiptRef.isLoading = false;
    receiptRef.isError = true;
    render(<ReceiptView orderId="order-1" onClose={vi.fn()} />);

    expect(screen.getByTestId("receipt-error")).toHaveTextContent("The receipt couldn't be loaded. Check the connection, then try again.");
    expect(screen.getByTestId("reprint-receipt")).toBeDisabled();
  });
});
