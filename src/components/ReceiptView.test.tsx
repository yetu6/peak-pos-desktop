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
    outletId: "outlet-1",
    outletName: "Main restaurant",
    terminalId: "terminal-1",
    operatorId: "staff-1",
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
  it("shows the immutable settled document, never a reconstruction from a live menu", () => {
    receiptRef.data = RECEIPT;
    receiptRef.isLoading = false;
    receiptRef.isError = false;
    render(<ReceiptView orderId="order-1" onClose={vi.fn()} />);

    const doc = screen.getByTestId("receipt-document");
    expect(doc).toHaveTextContent("POS-1");
    expect(doc).toHaveTextContent("CASH");
    expect(doc).toHaveTextContent("Cappuccino");
    expect(screen.queryByTestId("receipt-error")).not.toBeInTheDocument();
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

    expect(screen.getByTestId("receipt-error")).toBeInTheDocument();
    expect(screen.getByTestId("reprint-receipt")).toBeDisabled();
  });
});
