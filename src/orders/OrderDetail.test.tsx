import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { POSOrder, POSOrderPayment, POSOrderItem, POSReceipt } from "../lib/posContracts";
import { OrderDetailView, type OrderDetailViewProps } from "./OrderDetail";

function line(id: string, name: string, status: POSOrderItem["status"], options: string[] = []): POSOrderItem {
  return {
    id,
    productId: `p-${id}`,
    name,
    quantity: 1,
    unitPriceMinor: 650_000,
    taxMinor: 117_000,
    totalMinor: 767_000,
    status,
    modifiers: options.map((optionName, index) => ({ id: `${id}-${index}`, groupName: "Options", optionName, priceDeltaMinor: 0 })),
  };
}

function order(extra: Partial<POSOrder> = {}): POSOrder {
  return {
    id: "order-1",
    shiftId: "shift-1",
    orderNumber: "0142",
    dailyNumber: 42,
    createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    closedAt: null,
    payments: [],
    status: "OPEN",
    serviceType: "DINE_IN",
    tableLabel: "12",
    initiatedById: "staff-1",
    initiatedByName: "Amina Hassan",
    subtotalMinor: 1_300_000,
    discountMinor: 0,
    discountKind: "NONE",
    discountInput: 0,
    taxMinor: 234_000,
    totalMinor: 1_534_000,
    paidMinor: 0,
    remainingMinor: 1_534_000,
    version: 4,
    items: [line("l1", "Cappuccino", "ADDED"), line("l2", "Flat white", "ADDED", ["Oat milk"])],
    ...extra,
  };
}

const RECEIPT = {
  id: "r1",
  orderId: "order-1",
  status: "PRINTED",
  reprintCount: 2,
  createdAt: new Date().toISOString(),
  document: { tenderMethod: "CASH", operatorName: "Grace Mushi", initiatedByName: "Amina Hassan", settledAt: new Date().toISOString() },
} as unknown as POSReceipt;

function renderDetail(props: Partial<OrderDetailViewProps> = {}) {
  const handlers = {
    onSend: vi.fn(),
    onPay: vi.fn(),
    onVoid: vi.fn(),
    onRemoveLine: vi.fn(),
    onReprint: vi.fn(),
    onClose: vi.fn(),
    onSelectLine: vi.fn(),
  };
  render(
    <OrderDetailView
      order={order()}
      currency="TZS"
      timeline={[{ time: null, words: "Not sent to the kitchen yet" }]}
      canSend
      canPay
      pending={null}
      problem={null}
      result={null}
      selectedLineId={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

const footer = () => screen.getByTestId("order-detail-actions");

describe("OrderDetailView", () => {
  it("names the order, where it goes and who took it, with its lines, totals and what happened", () => {
    renderDetail();
    const sheet = screen.getByRole("dialog", { name: "Order 42" });
    // The reference Yetu keeps, small, for finding it again.
    expect(within(sheet).getByTestId("order-detail-reference")).toHaveTextContent("Reference 0142");
    expect(sheet).toHaveAccessibleDescription("Table 12 · Dine in · Amina Hassan");
    expect(within(sheet).getByTestId("order-detail-status")).toHaveTextContent("Open");
    expect(within(sheet).getByTestId("order-detail-lines")).toHaveTextContent("Flat white");
    expect(within(sheet).getByTestId("order-detail-lines")).toHaveTextContent("Oat milk");
    expect(within(sheet).getByTestId("order-detail-totals")).toHaveTextContent("TotalTSh 15,340");
    expect(within(sheet).getByTestId("order-detail-timeline")).toHaveTextContent("Not sent to the kitchen yet");
  });

  it("an open order: Send to kitchen and Void apart, Pay with the amount as the one primary action", async () => {
    const handlers = renderDetail();
    const actions = footer();
    expect(within(actions).getByRole("button", { name: /Send to kitchen/ })).toHaveTextContent("F8");
    const pay = within(actions).getByRole("button", { name: /Pay TSh 15,340/ });
    expect(pay).toHaveClass("y-button--primary", "y-button--64");
    expect(pay).toHaveTextContent("F9");
    await userEvent.click(within(actions).getByRole("button", { name: /Send to kitchen/ }));
    await userEvent.click(pay);
    await userEvent.click(within(actions).getByRole("button", { name: "Void order" }));
    expect(handlers.onSend).toHaveBeenCalled();
    expect(handlers.onPay).toHaveBeenCalled();
    expect(handlers.onVoid).toHaveBeenCalled();
  });

  it("an order in the kitchen: Pay and Void, no Send", () => {
    renderDetail({ order: order({ status: "PREPARING", items: [line("l1", "Cappuccino", "SENT")] }) });
    expect(within(footer()).queryByRole("button", { name: /Send to kitchen/ })).toBeNull();
    expect(within(footer()).getByRole("button", { name: /Pay TSh 15,340/ })).toBeEnabled();
    expect(within(footer()).getByRole("button", { name: "Void order" })).toBeEnabled();
  });

  const at = (hour: number, minute: number) => new Date(2026, 9, 12, hour, minute).toISOString();
  const payment = (paymentMethod: POSOrderPayment["paymentMethod"], amountMinor: number, createdAt: string, recordedByName: string) => ({
    id: `pay-${createdAt}`,
    paymentMethod,
    amountMinor,
    createdAt,
    recordedByName,
  });

  it("a part-paid order: what is paid and still to pay, and Void closed with the reason", () => {
    renderDetail({
      order: order({ status: "SENT", paidMinor: 1_000_000, remainingMinor: 534_000, payments: [payment("CASH", 1_000_000, at(14, 5), "Amina Hassan")] }),
    });
    expect(screen.getByTestId("order-detail-payment")).toHaveTextContent("Paid TSh 10,000 of TSh 15,340");
    // Each payment, with who took it and when (S5b).
    expect(screen.getByTestId("order-detail-payments")).toHaveTextContent("Cash · TSh 10,000Taken by Amina Hassan at 14:05");
    expect(within(footer()).getByRole("button", { name: /Pay TSh 5,340/ })).toBeEnabled();
    const voidButton = within(footer()).getByRole("button", { name: "Void order" });
    expect(voidButton).toBeDisabled();
    expect(voidButton).toHaveAccessibleDescription("An order can't be voided once part of it is paid.");
  });

  it("a paid order: each payment, who took it and when, from the order itself; and Print receipt", async () => {
    const split = [payment("MOBILE_MONEY", 1_000_000, at(14, 20), "Amina Hassan"), payment("CASH", 534_000, at(14, 23), "Grace Mushi")];
    const handlers = renderDetail({ order: order({ status: "CLOSED", paidMinor: 1_534_000, remainingMinor: 0, payments: split }), receipt: RECEIPT });
    const payments = within(screen.getByTestId("order-detail-payments")).getAllByRole("listitem");
    expect(payments.map((item) => item.textContent)).toEqual([
      "Mobile money · TSh 10,000Taken by Amina Hassan at 14:20",
      "Cash · TSh 5,340Taken by Grace Mushi at 14:23",
    ]);
    expect(screen.getByTestId("order-detail-payment")).toHaveTextContent("Printed again 2 times");
    expect(within(footer()).queryByRole("button", { name: /Pay/ })).toBeNull();
    expect(within(footer()).queryByRole("button", { name: "Void order" })).toBeNull();
    const print = within(footer()).getByRole("button", { name: "Print receipt" });
    expect(print).toHaveClass("y-button--primary");
    await userEvent.click(print);
    expect(handlers.onReprint).toHaveBeenCalled();
  });

  it("a room charge reads as done, and a payment with no name given says only when", () => {
    const lines = [payment("ROOM_CHARGE", 1_000_000, at(14, 20), "Amina Hassan"), payment("CASH", 534_000, at(14, 23), "")];
    renderDetail({ order: order({ status: "CLOSED", paidMinor: 1_534_000, remainingMinor: 0, payments: lines }) });
    const items = within(screen.getByTestId("order-detail-payments")).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Charged to the room · TSh 10,000Taken by Amina Hassan at 14:20",
      "Cash · TSh 5,340Taken at 14:23",
    ]);
  });

  it("a paid order says how it was paid before its receipt has come", () => {
    renderDetail({ order: order({ status: "CLOSED", paidMinor: 1_534_000, remainingMinor: 0, payments: [payment("CASH", 1_534_000, at(14, 23), "Grace Mushi")] }) });
    expect(screen.getByTestId("order-detail-payments")).toHaveTextContent("Cash · TSh 15,340Taken by Grace Mushi at 14:23");
    expect(screen.getByTestId("order-detail-payment")).not.toHaveTextContent("Getting the receipt");
  });

  it("shows the order's note for the kitchen", () => {
    renderDetail({ order: order({ status: "SENT", notes: "Guest has a nut allergy" }) });
    expect(screen.getByTestId("order-detail-note")).toHaveTextContent("Note: Guest has a nut allergy");
  });

  it("says a line is with the kitchen only while the order is, not once it is paid", () => {
    renderDetail({
      order: order({ status: "CLOSED", paidMinor: 1_534_000, remainingMinor: 0, items: [line("l1", "Cappuccino", "SENT")] }),
      receipt: RECEIPT,
    });
    expect(screen.getByTestId("order-detail-lines")).not.toHaveTextContent("Sent");
  });

  it("a paid order waits for its receipt before it can print a copy", () => {
    renderDetail({ order: order({ status: "CLOSED", paidMinor: 1_534_000, remainingMinor: 0 }), receipt: undefined });
    expect(within(footer()).getByRole("button", { name: "Print receipt" })).toBeDisabled();
  });

  it("says who can, instead of actions the person can't use", () => {
    renderDetail({ canSend: false, canPay: false });
    const notes = within(footer()).getAllByRole("note").map((note) => note.textContent);
    expect(notes).toEqual([
      "Only staff who take orders can send them to the kitchen. Ask one to help.",
      "Only a cashier or manager can take payment. Ask one to help.",
    ]);
  });

  it("says who can print a copy to a person who can't", () => {
    renderDetail({ order: order({ status: "CLOSED", paidMinor: 1_534_000, remainingMinor: 0 }), receipt: RECEIPT, canPay: false });
    expect(within(footer()).getByRole("note")).toHaveTextContent("Only a cashier or manager can print a copy of the receipt.");
  });

  it("a voided order has nothing left to do but close", () => {
    renderDetail({ order: order({ status: "VOIDED" }) });
    expect(within(footer()).getAllByRole("button").map((button) => button.textContent)).toEqual(["Close"]);
  });

  it("holds every action while a request is with Yetu, and the sheet can't be dismissed", async () => {
    const handlers = renderDetail({ pending: "send" });
    expect(within(footer()).getByRole("button", { name: /Sending…/ })).toBeDisabled();
    expect(within(footer()).getByRole("button", { name: /Pay/ })).toBeDisabled();
    expect(within(footer()).getByRole("button", { name: "Void order" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(handlers.onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{F8}");
    await userEvent.keyboard("{F9}");
    expect(handlers.onSend).not.toHaveBeenCalled();
    expect(handlers.onPay).not.toHaveBeenCalled();
  });

  it("an open order with nothing on it can't be sent or paid", () => {
    renderDetail({ order: order({ items: [], subtotalMinor: 0, taxMinor: 0, totalMinor: 0, remainingMinor: 0 }) });
    expect(within(footer()).getByRole("button", { name: /Send to kitchen/ })).toBeDisabled();
    expect(within(footer()).getByRole("button", { name: /^Pay/ })).toBeDisabled();
  });

  it("announces a result and a refusal", () => {
    renderDetail({ result: "Sent to the kitchen.", problem: "The order wasn't sent. Try again." });
    expect(screen.getByTestId("order-detail-result")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("order-detail-result")).toHaveTextContent("Sent to the kitchen.");
    expect(screen.getByRole("alert")).toHaveTextContent("The order wasn't sent. Try again.");
  });

  it("lets a line not yet sent be chosen and removed; a sent line can't be", async () => {
    const handlers = renderDetail({
      order: order({ items: [line("l1", "Cappuccino", "ADDED"), line("l2", "Flat white", "SENT")] }),
      selectedLineId: "l1",
    });
    await userEvent.click(screen.getByRole("button", { name: "Remove Cappuccino" }));
    expect(handlers.onRemoveLine).toHaveBeenCalledWith(expect.objectContaining({ id: "l1" }));
    expect(screen.queryByRole("button", { name: /Flat white/ })).toBeNull();
  });

  it("presses Send with F8 and Pay with F9 while the sheet has the keys", async () => {
    const handlers = renderDetail();
    await userEvent.keyboard("{F8}");
    await userEvent.keyboard("{F9}");
    expect(handlers.onSend).toHaveBeenCalledTimes(1);
    expect(handlers.onPay).toHaveBeenCalledTimes(1);
  });
});
