import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { idleLockHeld } from "../lib/idleLock";
import { ReceiptView } from "./ReceiptView";
import type { POSReceipt } from "../lib/posContracts";

const { reprintMutate, receiptRef, keys, reprintState } = vi.hoisted(() => ({
  reprintMutate: vi.fn(),
  receiptRef: { data: undefined as POSReceipt | undefined, isLoading: false, isError: false },
  keys: { minted: 0 },
  reprintState: { isPending: false, data: undefined as undefined | { failed?: string } },
}));

vi.mock("../hooks/usePosData", () => ({
  useOutletMoneySettings: () => ({ standardFloat: 0, quickCashNotes: [1000,2000,5000,10000] }),
  useReceipt: () => receiptRef,
  useReprintReceipt: () => ({ mutate: reprintMutate, isPending: reprintState.isPending, error: null, data: reprintState.data }),
  useIdempotencyKey: () => ({ current: "", next: () => `key-${++keys.minted}` }),
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
    outletName: "Main restaurant",
    initiatedByName: "Amina Hassan",
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
  it("shows the settled document as Yetu kept it, in words, called a bill", () => {
    receiptRef.data = RECEIPT;
    receiptRef.isLoading = false;
    receiptRef.isError = false;
    render(<ReceiptView orderId="order-1" onClose={vi.fn()} />);

    const sheet = screen.getByRole("dialog", { name: "Bill" });
    const doc = screen.getByTestId("receipt-document");
    expect(screen.getByTestId("receipt-property")).toHaveTextContent("Mama Rose Hotel");
    expect(doc).toHaveTextContent("Order POS-1");
    expect(doc).toHaveTextContent("Paid by Cash");
    expect(doc).not.toHaveTextContent("CASH");
    expect(doc).toHaveTextContent("2 × Cappuccino");
    expect(doc).toHaveTextContent("TSh 141.70");
    expect(doc).toHaveTextContent("VAT");
    expect(screen.getByTestId("receipt-taken-by")).toHaveTextContent("Taken by Amina Hassan");
    const footer = screen.getByTestId("receipt-footer");
    expect(footer).toHaveTextContent(/^Powered by Yetu\s*yetu\.fbcsoftwares\.com$/);
    expect(footer.querySelector("br")).not.toBeNull();
    expect(sheet).not.toHaveTextContent(/invoice/i);
    expect(screen.queryByTestId("receipt-error")).not.toBeInTheDocument();
  });

  it("a bill with VAT on top shows each line without its VAT, so the lines add up to the Subtotal", () => {
    receiptRef.data = RECEIPT;
    receiptRef.isLoading = false;
    receiptRef.isError = false;
    render(<ReceiptView orderId="order-1" onClose={vi.fn()} />);
    const doc = screen.getByTestId("receipt-document");
    expect(within(doc).getByText("2 × Cappuccino").parentElement).toHaveTextContent("TSh 130");
    expect(doc).toHaveTextContent("SubtotalTSh 130");
    expect(doc).not.toHaveTextContent("TSh 141.70TSh");
  });

  // F-229: a TSh 22,000 biryani at a hotel whose prices include VAT.
  it("a receipt whose prices include VAT reads the menu price, VAT included", () => {
    receiptRef.data = {
      ...RECEIPT,
      document: {
        ...RECEIPT.document,
        pricesIncludeTax: true,
        items: [{ name: "Chicken biryani", quantity: 1, unitPriceMinor: 2_200_000, taxMinor: 335_593, totalMinor: 2_200_000 }],
        subtotalMinor: 1_864_407,
        taxMinor: 335_593,
        totalMinor: 2_200_000,
      },
    };
    receiptRef.isLoading = false;
    receiptRef.isError = false;
    render(<ReceiptView orderId="order-1" onClose={vi.fn()} />);
    const doc = screen.getByTestId("receipt-document");
    expect(doc).toHaveTextContent("Items");
    expect(doc).toHaveTextContent("VAT included");
    expect(doc).toHaveTextContent("TSh 3,355.93");
    expect(doc).not.toHaveTextContent("Subtotal");
    expect(doc).not.toHaveTextContent("TSh 18,644.07");
  });

  // F-233: Yetu made the copy; the printer didn't print it.
  it("a copy the printer didn't print says so", () => {
    receiptRef.data = RECEIPT;
    receiptRef.isLoading = false;
    receiptRef.isError = false;
    reprintState.data = { failed: "No printer is set up on this till" };
    try {
      render(<ReceiptView orderId="order-1" onClose={vi.fn()} />);
      expect(screen.getByTestId("reprint-error")).toHaveTextContent(
        "The copy didn't print: no printer is set up on this till. Yetu has the bill; try again once the printer is ready.",
      );
    } finally {
      reprintState.data = undefined;
    }
  });

  it("says where the order went and who took the payment, when someone else did", () => {
    receiptRef.data = {
      ...RECEIPT,
      document: { ...RECEIPT.document, tableLabel: "12", operatorName: "Grace Mushi" },
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

  it("says Print bill again, as the order sheet does (Print again is Sell's kitchen button)", () => {
    receiptRef.data = RECEIPT;
    receiptRef.isLoading = false;
    receiptRef.isError = false;
    render(<ReceiptView orderId="order-1" onClose={vi.fn()} />);
    expect(screen.getByTestId("reprint-receipt")).toHaveTextContent("Print bill again");
  });

  it("disables reprint until the real settled document has loaded", () => {
    receiptRef.data = undefined;
    receiptRef.isLoading = true;
    receiptRef.isError = false;
    render(<ReceiptView orderId="order-1" onClose={vi.fn()} />);

    expect(screen.getByTestId("reprint-receipt")).toBeDisabled();
  });

  it("calls the certified reprint endpoint, never a new original: the same key when asked again after a lost answer, a new one for the next copy", async () => {
    receiptRef.data = RECEIPT;
    receiptRef.isLoading = false;
    receiptRef.isError = false;
    const view = render(<ReceiptView orderId="order-1" onClose={vi.fn()} />);

    await userEvent.click(screen.getByTestId("reprint-receipt"));
    await userEvent.click(screen.getByTestId("reprint-receipt"));
    const [first, again] = reprintMutate.mock.calls.map(([args]) => args as { orderId: string; idempotencyKey: string });
    expect(first.orderId).toBe("order-1");
    expect(again.idempotencyKey).toBe(first.idempotencyKey);

    // Yetu recorded the copy: the receipt now counts one reprint.
    receiptRef.data = { ...RECEIPT, reprintCount: 1 };
    view.rerender(<ReceiptView orderId="order-1" onClose={vi.fn()} />);
    await userEvent.click(screen.getByTestId("reprint-receipt"));
    expect(reprintMutate.mock.calls[2][0].idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("stays open, and keeps the till from locking, while a copy is with Yetu", async () => {
    receiptRef.data = RECEIPT;
    receiptRef.isLoading = false;
    receiptRef.isError = false;
    reprintState.isPending = true;
    const onClose = vi.fn();
    try {
      render(<ReceiptView orderId="order-1" onClose={onClose} />);
      expect(idleLockHeld()).toBe(true);
      await userEvent.keyboard("{Escape}");
      for (const close of screen.getAllByRole("button", { name: "Back to previous screen" })) await userEvent.click(close);
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      reprintState.isPending = false;
    }
  });

  it("surfaces receipt-unavailable rather than fabricating one", () => {
    receiptRef.data = undefined;
    receiptRef.isLoading = false;
    receiptRef.isError = true;
    render(<ReceiptView orderId="order-1" onClose={vi.fn()} />);

    expect(screen.getByTestId("receipt-error")).toHaveTextContent("The bill couldn't be loaded. Check the connection, then try again.");
    expect(screen.getByTestId("reprint-receipt")).toBeDisabled();
  });
});
