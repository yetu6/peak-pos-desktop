import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { POSOrder } from "../lib/posContracts";
import { PaymentDone } from "./PaymentDone";
import { REGISTER_AUTO_RETURN_SECONDS } from "./registerSettings";

const ORDER: POSOrder = {
  id: "order-1",
  shiftId: "shift-1",
  orderNumber: "0142",
  status: "CLOSED",
  serviceType: "DINE_IN",
  initiatedById: "staff-amina",
  initiatedByName: "Amina Hassan",
  subtotalMinor: 3_601_695,
  discountMinor: 0,
  discountKind: "NONE",
  discountInput: 0,
  taxMinor: 648_305,
  totalMinor: 4_250_000,
  paidMinor: 4_250_000,
  remainingMinor: 0,
  version: 3,
  items: [],
};

function renderDone(props: Partial<Parameters<typeof PaymentDone>[0]> = {}) {
  const handlers = { onNewSale: vi.fn(), onViewReceipt: vi.fn() };
  render(<PaymentDone paid={{ order: ORDER, method: "CASH", changeMinor: 750_000 }} currency="TZS" {...handlers} {...props} />);
  return handlers;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("PaymentDone", () => {
  it("shows the tick, Paid, the amount, how and the change to give", () => {
    renderDone();
    const done = screen.getByRole("dialog", { name: "Paid" });
    expect(done).toHaveTextContent("TSh 42,500");
    expect(done).toHaveTextContent("Cash");
    expect(screen.getByTestId("done-change")).toHaveTextContent("Change to give TSh 7,500");
  });

  it("says Split payment when more than one tender paid it", () => {
    renderDone({ paid: { order: ORDER, method: "EXTERNAL_CARD", changeMinor: 0, split: true } });
    expect(screen.getByRole("dialog", { name: "Paid" })).toHaveTextContent("Split payment · Order 0142");
  });

  it("for a room charge, says it went on the room", () => {
    renderDone({ paid: { order: ORDER, method: "ROOM_CHARGE", changeMinor: 0, roomNumber: "12" } });
    expect(screen.getByRole("dialog", { name: "Charged to room 12" })).toHaveTextContent("TSh 42,500");
    expect(screen.queryByTestId("done-change")).not.toBeInTheDocument();
  });

  it("claims nothing about printing; the receipt is there to see", () => {
    const { onViewReceipt } = renderDone();
    expect(screen.getByRole("dialog")).not.toHaveTextContent(/print/i);
    fireEvent.click(screen.getByRole("button", { name: "View receipt" }));
    expect(onViewReceipt).toHaveBeenCalled();
  });

  it("New sale starts the next order", () => {
    const { onNewSale } = renderDone();
    fireEvent.click(screen.getByRole("button", { name: /New sale/ }));
    expect(onNewSale).toHaveBeenCalledTimes(1);
  });

  it("goes back to Sell on its own after the named setting's seconds", () => {
    expect(REGISTER_AUTO_RETURN_SECONDS).toBe(8);
    const { onNewSale } = renderDone();
    act(() => vi.advanceTimersByTime(REGISTER_AUTO_RETURN_SECONDS * 1000 - 1000));
    expect(onNewSale).not.toHaveBeenCalled();
    expect(screen.getByTestId("done-countdown")).toHaveTextContent("Back to Sell in 1 second");
    act(() => vi.advanceTimersByTime(1000));
    expect(onNewSale).toHaveBeenCalledTimes(1);
  });

  it("waits while the pointer is over it, and while one of its buttons has focus", () => {
    const { onNewSale } = renderDone();
    const done = screen.getByTestId("payment-done");
    fireEvent.mouseEnter(done);
    act(() => vi.advanceTimersByTime(20_000));
    expect(onNewSale).not.toHaveBeenCalled();
    expect(screen.getByTestId("done-countdown")).toHaveTextContent("Waiting while you look");
    fireEvent.mouseLeave(done);
    fireEvent.focus(screen.getByRole("button", { name: "View receipt" }));
    act(() => vi.advanceTimersByTime(20_000));
    expect(onNewSale).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByRole("button", { name: "View receipt" }));
    act(() => vi.advanceTimersByTime(REGISTER_AUTO_RETURN_SECONDS * 1000));
    expect(onNewSale).toHaveBeenCalledTimes(1);
  });
});
