import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { POSOrder, POSOrderPayment, POSOrderItem, POSOrderRefunds, POSReceipt, POSRefund } from "../lib/posContracts";
import { OrderDetailView, type OrderDetailViewProps } from "./OrderDetail";
import { DISCOUNT_HELD_WORDS } from "../register/registerWords";

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
    onQuantity: vi.fn(),
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

const PAID = { status: "CLOSED" as const, paidMinor: 1_534_000, remainingMinor: 0 };

function refundGiven(extra: Partial<POSRefund> = {}): POSRefund {
  return {
    id: "refund-1",
    orderId: "order-1",
    orderNumber: "0142",
    dailyNumber: 42,
    outletId: "outlet-1",
    shiftId: "shift-1",
    terminalId: "till-1",
    businessDate: "2026-10-18",
    reason: "Cold or not as ordered",
    initiatedById: "staff-1",
    initiatedByName: "Amina Hassan",
    authorizedById: "staff-2",
    authorizedByName: "Grace Mushi",
    netMinor: 650_000,
    discountMinor: 0,
    taxMinor: 117_000,
    totalMinor: 767_000,
    currency: "TZS",
    createdAt: new Date(2026, 9, 18, 17, 40).toISOString(),
    lines: [],
    tenders: [{ id: "t-1", paymentId: "pay-1", paymentMethod: "CASH", amountMinor: 767_000 }],
    ...extra,
  };
}

function refundsOf(refunds: POSRefund[], extra: Partial<POSOrderRefunds> = {}): POSOrderRefunds {
  const refundedMinor = refunds.reduce((sum, refund) => sum + refund.totalMinor, 0);
  return {
    orderId: "order-1",
    status: "CLOSED",
    totalMinor: 1_534_000,
    refundedMinor,
    remainingMinor: 1_534_000 - refundedMinor,
    lastRefundDate: "2026-11-17",
    wholeOrderOnly: false,
    refunds,
    lines: [],
    payments: [],
    ...extra,
  };
}

describe("OrderDetailView: refunds (S7)", () => {
  it("a paid order offers Refund items beside Print receipt", async () => {
    const onRefund = vi.fn();
    renderDetail({ order: order(PAID), receipt: RECEIPT, refunds: refundsOf([]), refundOffer: { offer: true, why: null }, onRefund });
    const refund = within(footer()).getByRole("button", { name: "Refund items" });
    expect(refund).toBeEnabled();
    expect(within(footer()).getByRole("button", { name: "Print bill again" })).toHaveClass("y-button--primary");
    await userEvent.click(refund);
    expect(onRefund).toHaveBeenCalled();
  });

  it("says why a refund can't be given here, instead of offering it", () => {
    renderDetail({
      order: order(PAID),
      receipt: RECEIPT,
      refunds: refundsOf([]),
      refundOffer: { offer: false, why: "Open a shift on this till to give a refund." },
      onRefund: vi.fn(),
    });
    const refund = within(footer()).getByRole("button", { name: "Refund items" });
    expect(refund).toBeDisabled();
    expect(refund).toHaveAccessibleDescription("Open a shift on this till to give a refund.");
  });

  it("a partly refunded order says so in words, with each refund: how much, how, why and who", () => {
    renderDetail({ order: order(PAID), receipt: RECEIPT, refunds: refundsOf([refundGiven()]), refundOffer: { offer: true, why: null }, onRefund: vi.fn() });
    expect(screen.getByTestId("order-detail-status")).toHaveTextContent("Partly refunded");
    const given = within(screen.getByTestId("order-detail-refunds")).getAllByRole("listitem");
    expect(given.map((item) => item.textContent)).toEqual([
      "TSh 7,670 back in cash · 17:40Cold or not as ordered · Amina Hassan, approved by Grace Mushi",
    ]);
  });

  it("an order refunded in full reads Refunded, and a room charge as taken off the bill", () => {
    const room = refundGiven({ totalMinor: 1_534_000, tenders: [{ id: "t-2", paymentId: "pay-2", paymentMethod: "ROOM_CHARGE", amountMinor: 1_534_000 }] });
    renderDetail({ order: order(PAID), receipt: RECEIPT, refunds: refundsOf([room]), refundOffer: { offer: false, why: "Everything on this order has been refunded." } });
    expect(screen.getByTestId("order-detail-status")).toHaveTextContent("Refunded");
    expect(screen.getByTestId("order-detail-refunds")).toHaveTextContent("TSh 15,340 taken off the room bill");
  });

  it("offers no refund on an order that isn't paid", () => {
    renderDetail({ order: order({ status: "SENT" }), onRefund: vi.fn() });
    expect(within(footer()).queryByRole("button", { name: "Refund items" })).toBeNull();
  });
});

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
    // Not sent yet: Pay sends it first.
    const pay = within(actions).getByRole("button", { name: /Send and pay TSh 15,340/ });
    expect(pay).toHaveClass("y-button--primary", "y-button--64");
    expect(pay).toHaveTextContent("F9");
    await userEvent.click(within(actions).getByRole("button", { name: /Send to kitchen/ }));
    await userEvent.click(pay);
    await userEvent.click(within(actions).getByRole("button", { name: "Cancel order" }));
    expect(handlers.onSend).toHaveBeenCalled();
    expect(handlers.onPay).toHaveBeenCalled();
    expect(handlers.onVoid).toHaveBeenCalled();
  });

  it("an order in the kitchen: Pay and Void, no Send", () => {
    renderDetail({ order: order({ status: "PREPARING", items: [line("l1", "Cappuccino", "SENT")] }) });
    expect(within(footer()).queryByRole("button", { name: /Send to kitchen/ })).toBeNull();
    expect(within(footer()).getByRole("button", { name: /Pay TSh 15,340/ })).toBeEnabled();
    expect(within(footer()).getByRole("button", { name: "Cancel order" })).toBeEnabled();
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
    const voidButton = within(footer()).getByRole("button", { name: "Cancel order" });
    expect(voidButton).toBeDisabled();
    expect(voidButton).toHaveAccessibleDescription("An order can't be cancelled once part of it is paid.");
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
    expect(within(footer()).queryByRole("button", { name: "Cancel order" })).toBeNull();
    const print = within(footer()).getByRole("button", { name: "Print bill again" });
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
    expect(within(footer()).getByRole("button", { name: "Print bill again" })).toBeDisabled();
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
    expect(within(footer()).getByRole("note")).toHaveTextContent("Only a cashier or manager can print the bill again.");
  });

  it("a voided order has nothing left to do but close", () => {
    renderDetail({ order: order({ status: "VOIDED" }) });
    expect(within(footer()).getAllByRole("button").map((button) => button.textContent)).toEqual(["Close"]);
  });

  it("holds every action while a request is with Yetu, and the sheet can't be dismissed", async () => {
    const handlers = renderDetail({ pending: "send" });
    expect(within(footer()).getByRole("button", { name: /Sending…/ })).toBeDisabled();
    expect(within(footer()).getByRole("button", { name: /pay/i })).toBeDisabled();
    expect(within(footer()).getByRole("button", { name: "Cancel order" })).toBeDisabled();
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

describe("OrderDetailView: by round", () => {
  it("a line added after a round sits under Not sent yet, and can be removed", async () => {
    const base = order();
    const rounds = order({
      status: "SERVED",
      roundsSent: 1,
      items: [{ ...base.items[0], status: "SENT", roundNumber: 1 }, { ...base.items[0], id: "line-new", name: "Chocolate tart", status: "ADDED" }],
    });
    const handlers = renderDetail({ order: rounds, selectedLineId: "line-new" });
    expect(within(screen.getByTestId("detail-group-round-1")).getByRole("heading", { name: "Round 1" })).toBeInTheDocument();
    const unsent = screen.getByTestId("detail-group-unsent");
    expect(within(unsent).getByRole("heading", { name: "Not sent yet" })).toBeInTheDocument();
    await userEvent.click(within(unsent).getByRole("button", { name: "Remove Chocolate tart" }));
    expect(handlers.onRemoveLine).toHaveBeenCalledWith(expect.objectContaining({ id: "line-new" }));
    // Its quantity by its stepper; never below one (Remove takes it off).
    await userEvent.click(within(unsent).getByRole("button", { name: "One more Chocolate tart" }));
    expect(handlers.onQuantity).toHaveBeenCalledWith(expect.objectContaining({ id: "line-new" }), base.items[0].quantity + 1);
    expect(within(unsent).getByRole("button", { name: "One fewer Chocolate tart" })).toHaveProperty("disabled", base.items[0].quantity <= 1);
  });

  it("while a change is with Yetu, the stepper waits", () => {
    const base = order();
    const rounds = order({
      status: "SERVED",
      roundsSent: 1,
      items: [{ ...base.items[0], status: "SENT", roundNumber: 1 }, { ...base.items[0], id: "line-new", name: "Chocolate tart", quantity: 2, status: "ADDED" }],
    });
    renderDetail({ order: rounds, selectedLineId: "line-new", pending: "quantity" });
    expect(screen.getByRole("button", { name: "One more Chocolate tart" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "One fewer Chocolate tart" })).toBeDisabled();
  });
});

// F-236: an open order is carried on with on Sell, and takes a discount here.
describe("OrderDetail: Add items and Discount", () => {
  it("an open order offers Add items and Discount", async () => {
    const onAddItems = vi.fn();
    const onDiscount = vi.fn();
    renderDetail({ order: order({ status: "SENT", roundsSent: 1 }), onAddItems, onDiscount });
    await userEvent.click(within(footer()).getByTestId("detail-add-items"));
    await userEvent.click(within(footer()).getByTestId("detail-discount"));
    expect(onAddItems).toHaveBeenCalledTimes(1);
    expect(onDiscount).toHaveBeenCalledTimes(1);
  });

  it("an order sent to a Yetu before rounds takes nothing more, so Add items isn't offered", () => {
    renderDetail({ order: order({ status: "SENT" }), onAddItems: vi.fn(), onDiscount: vi.fn() });
    expect(within(footer()).queryByTestId("detail-add-items")).toBeNull();
    expect(within(footer()).getByTestId("detail-discount")).toBeEnabled();
  });

  it("no discount once part of the bill is paid, and the sheet says why", () => {
    renderDetail({ order: order({ status: "SENT", roundsSent: 1, paidMinor: 500_000, remainingMinor: 1_034_000 }), onAddItems: vi.fn(), onDiscount: vi.fn() });
    expect(within(footer()).getByTestId("detail-discount")).toBeDisabled();
    expect(footer()).toHaveTextContent("An order can't be cancelled or discounted once part of it is paid.");
  });

  it("a paid order offers neither", () => {
    renderDetail({ order: order(PAID), onAddItems: vi.fn(), onDiscount: vi.fn() });
    expect(within(footer()).queryByTestId("detail-add-items")).toBeNull();
    expect(within(footer()).queryByTestId("detail-discount")).toBeNull();
  });
});

// The owner, 2026-10-20: a percent discount never comes to more money off than its supervisor approved.
describe("OrderDetail: a discount kept to what was approved", () => {
  it("says so under the discount, and only when Yetu says it is kept", () => {
    const discounted = { discountKind: "PERCENT" as const, discountInput: 1000, discountMinor: 25_000, discountReason: "Staff meal" };
    renderDetail({ order: order({ ...discounted, discountCapped: true }) });
    expect(screen.getByTestId("discount-held")).toHaveTextContent(DISCOUNT_HELD_WORDS);
    cleanup();
    renderDetail({ order: order(discounted) });
    expect(screen.queryByTestId("discount-held")).not.toBeInTheDocument();
  });
});

// F-229: the order sheet reads like the ticket.
describe("OrderDetail: prices that include VAT", () => {
  it("reads Items at the menu prices, VAT included and the total", () => {
    renderDetail({
      order: order({ pricesIncludeTax: true, subtotalMinor: 1_864_407, taxMinor: 335_593, totalMinor: 2_200_000, remainingMinor: 2_200_000,
        items: [{ ...line("l1", "Chicken biryani", "SENT"), unitPriceMinor: 2_200_000, taxMinor: 335_593, totalMinor: 2_200_000 }] }),
    });
    const totals = screen.getByTestId("order-detail-totals");
    expect(totals).toHaveTextContent("Items");
    expect(totals).toHaveTextContent("VAT included");
    expect(totals).not.toHaveTextContent("Subtotal");
    expect(totals).not.toHaveTextContent("TSh 18,644.07");
  });
});

// fbc-peak #288 (2026-10-20): the bill before payment, above Pay; a paid order prints its bill again.
describe("OrderDetailView: the bill", () => {
  it("an open order offers Print bill, and presses it", async () => {
    const onPrintBill = vi.fn();
    renderDetail({ onPrintBill });
    await userEvent.click(screen.getByTestId("detail-print-bill"));
    expect(onPrintBill).toHaveBeenCalledTimes(1);
  });

  it("not for an order with nothing on it, nor for a paid one", () => {
    renderDetail({ onPrintBill: vi.fn(), order: order({ items: [] }) });
    expect(screen.getByTestId("detail-print-bill")).toBeDisabled();
    cleanup();
    renderDetail({ onPrintBill: vi.fn(), order: order(PAID) });
    expect(screen.queryByTestId("detail-print-bill")).toBeNull();
    expect(screen.getByRole("button", { name: "Print bill again" })).toBeInTheDocument();
  });
});
