import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { POSOrder } from "../lib/posContracts";
import { TicketActions, type TicketActionsProps } from "./TicketActions";

const ORDER: POSOrder = {
  id: "order-1",
  shiftId: "shift-1",
  orderNumber: "0142",
  dailyNumber: 42,
  createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  closedAt: null,
  payments: [],
  status: "OPEN",
  serviceType: "DINE_IN",
  initiatedById: "staff-amina",
  initiatedByName: "Amina Hassan",
  subtotalMinor: 3_400_000,
  discountMinor: 0,
  discountKind: "NONE",
  discountInput: 0,
  taxMinor: 612_000,
  totalMinor: 4_012_000,
  paidMinor: 0,
  remainingMinor: 4_012_000,
  version: 4,
  items: [
    { id: "l1", productId: "p1", name: "Cappuccino", quantity: 2, unitPriceMinor: 650_000, taxMinor: 234_000, totalMinor: 1_534_000, status: "ADDED" },
  ],
};

function renderActions(props: Partial<TicketActionsProps> = {}) {
  const handlers = {
    onSend: vi.fn(),
    onPay: vi.fn(),
    onDiscount: vi.fn(),
    onVoid: vi.fn(),
    onNote: vi.fn(),
    onNewSale: vi.fn(),
  };
  render(
    <TicketActions
      order={ORDER}
      currency="TZS"
      busy={false}
      sending={false}
      canSend
      canPay
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("TicketActions", () => {
  // The owner, 2026-10-21: printing in plain sight, one row; Pay below.
  it("one row of Print order, Print bill and More, and Pay below: place, colour, icon, size and words", () => {
    renderActions({ onPrintBill: vi.fn() });
    const send = screen.getByRole("button", { name: /Print order/ });
    const bill = screen.getByRole("button", { name: /Print bill/ });
    const more = screen.getByRole("button", { name: "More" });
    expect(send.parentElement).toBe(bill.parentElement);
    expect(bill.parentElement).toBe(more.parentElement);
    // Nothing is sent yet: Pay prints it for the kitchen first, and says so.
    const pay = screen.getByRole("button", { name: /^Pay TSh 40,120/ });
    expect(screen.getByTestId("pay-prints-first")).toHaveTextContent("New items print for the kitchen first.");
    expect(send.compareDocumentPosition(pay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(send).toHaveClass("y-button--secondary", "y-button--56");
    expect(pay).toHaveClass("y-button--pay", "y-button--64");
    expect(send.querySelector(".y-button__icon svg")).not.toBeNull();
    expect(pay.querySelector(".y-button__icon svg")).not.toBeNull();
    expect(send).toHaveTextContent("F8");
    expect(pay).toHaveTextContent("F9");
  });

  it("with everything sent, Print order prints the last papers again; Pay only when something is owed", async () => {
    const onReprint = vi.fn();
    const { onSend } = renderActions({
      onReprint,
      order: { ...ORDER, status: "SENT", roundsSent: 1, items: [{ ...ORDER.items[0], status: "SENT", roundNumber: 1 }] },
    });
    const print = screen.getByRole("button", { name: /Print order/ });
    expect(print).toBeEnabled();
    await userEvent.click(print);
    expect(onReprint).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Pay TSh 40,120/ })).toBeEnabled();
    expect(screen.queryByTestId("pay-prints-first")).toBeNull();
  });

  it("with nothing on the ticket, Print order, Print bill and Pay wait", () => {
    renderActions({ order: null, onPrintBill: vi.fn() });
    expect(screen.getByRole("button", { name: /Print order/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Print bill/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Pay/ })).toBeDisabled();
  });

  it("says who can take payment, instead of Pay, without pos.payment.record", () => {
    renderActions({ canPay: false });
    expect(screen.queryByRole("button", { name: /^Pay/ })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Only a cashier or manager can take payment. Ask one to help.");
  });

  it("says who can print for the kitchen, instead of Print order, without pos.order.send", () => {
    renderActions({ canSend: false });
    expect(screen.queryByRole("button", { name: /Print order/ })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Only staff who take orders can print them for the kitchen. Ask one to help.");
  });

  it("F8 sends and F9 opens Pay, but not while a sheet is open", () => {
    const { onSend, onPay } = renderActions();
    fireEvent.keyDown(document.body, { key: "F8" });
    fireEvent.keyDown(document.body, { key: "F9" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onPay).toHaveBeenCalledTimes(1);
    const sheet = document.createElement("div");
    sheet.setAttribute("role", "dialog");
    document.body.append(sheet);
    fireEvent.keyDown(document.body, { key: "F9" });
    expect(onPay).toHaveBeenCalledTimes(1);
    sheet.remove();
  });

  it("More holds Discount, Void, the order note and a new sale", async () => {
    const handlers = renderActions();
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    const more = screen.getByRole("dialog", { name: "More for this order" });
    await userEvent.click(within(more).getByRole("button", { name: /Discount/ }));
    expect(handlers.onDiscount).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "More for this order" })).getByRole("button", { name: /Cancel order/ }));
    expect(handlers.onVoid).toHaveBeenCalled();
  });

  it("Discount and Void wait until there is an order not yet paid, and say why", async () => {
    renderActions({ order: { ...ORDER, paidMinor: 1_000_000, remainingMinor: 3_012_000 } });
    expect(screen.getByRole("button", { name: /^Pay TSh 30,120/ })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    const more = screen.getByRole("dialog", { name: "More for this order" });
    expect(within(more).getByRole("button", { name: /Discount/ })).toBeDisabled();
    expect(within(more).getByRole("button", { name: /Cancel order/ })).toBeDisabled();
    expect(more).toHaveTextContent("Not once part of the bill is paid.");
    expect(within(more).getByRole("button", { name: /Order note/ })).toBeEnabled();
  });
});

describe("TicketActions: rounds (S17a)", () => {
  const served: POSOrder = {
    ...ORDER,
    status: "SERVED",
    roundsSent: 1,
    items: [
      { ...ORDER.items[0], status: "SENT", roundNumber: 1 },
      { id: "l2", productId: "p2", name: "Cake", quantity: 1, unitPriceMinor: 500_000, taxMinor: 90_000, totalMinor: 590_000, status: "ADDED" },
    ],
  };

  it("prints what was added after a round as the next round; Pay prints it first", async () => {
    const handlers = renderActions({ order: served, onReprint: vi.fn() });
    const send = screen.getByTestId("send-order");
    expect(send).toHaveTextContent("Print order");
    expect(send).toBeEnabled();
    const pay = screen.getByTestId("pay-order");
    expect(pay).toBeEnabled();
    expect(pay).toHaveTextContent("Pay TSh");
    expect(screen.getByTestId("pay-prints-first")).toBeInTheDocument();
    expect(screen.queryByTestId("pay-waits")).toBeNull();
    await userEvent.click(send);
    expect(handlers.onSend).toHaveBeenCalledTimes(1);
  });

  it("someone who can't send waits for someone who can, in Yetu's words", () => {
    renderActions({ order: served, canSend: false });
    expect(screen.getByTestId("pay-order")).toBeDisabled();
    expect(screen.getByTestId("pay-waits")).toHaveTextContent("Print the new items first, or remove them, then take payment.");
  });

  it("a Yetu before rounds sends an order once: nothing to send after it", () => {
    const old = { ...served, roundsSent: undefined };
    renderActions({ order: old });
    expect(screen.getByTestId("send-order")).toBeDisabled();
    expect(screen.queryByTestId("pay-waits")).toBeNull();
  });
});

// fbc-peak #288 (2026-10-20): the bill before payment -- in plain sight
// since 2026-10-21, no longer in More.
describe("TicketActions: Print bill", () => {
  it("offers the bill for an order with something on it, and prints it", async () => {
    const onPrintBill = vi.fn();
    renderActions({ onPrintBill });
    await userEvent.click(screen.getByRole("button", { name: /Print bill/ }));
    expect(onPrintBill).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(within(screen.getByRole("dialog", { name: "More for this order" })).queryByRole("button", { name: /Print bill/ })).toBeNull();
  });

  it("isn't offered to staff who can't send an order", () => {
    renderActions();
    expect(screen.queryByRole("button", { name: /Print bill/ })).toBeNull();
  });

  it("nothing on the ticket, or while it prints: the bill waits", () => {
    renderActions({ onPrintBill: vi.fn(), order: { ...ORDER, items: [] } });
    expect(screen.getByRole("button", { name: /Print bill/ })).toBeDisabled();
  });

  it("says it is printing", () => {
    renderActions({ onPrintBill: vi.fn(), printingBill: true });
    const bill = screen.getByTestId("print-bill");
    expect(bill).toBeDisabled();
    expect(bill).toHaveTextContent("Printing…");
  });
});

describe("TicketActions: F8 does what Print order does", () => {
  it("with nothing new, F8 prints the last papers again", () => {
    const onReprint = vi.fn();
    const { onSend } = renderActions({
      onReprint,
      order: { ...ORDER, status: "SENT", roundsSent: 1, items: [{ ...ORDER.items[0], status: "SENT", roundNumber: 1 }] },
    });
    fireEvent.keyDown(document.body, { key: "F8" });
    expect(onReprint).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });
});
