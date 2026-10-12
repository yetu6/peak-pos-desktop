import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PayCashFixture,
  PayRoomFixture,
  PaySplitFixture,
  PaymentDoneFixture,
  ReceiptFixture,
  RegisterFixture,
  RegisterLimitedFixture,
  RegisterSentFixture,
} from "./RegisterFixtures";

describe("RegisterFixtures", () => {
  it("renders the menu beside the ticket", () => {
    render(<RegisterFixture />);
    expect(screen.getByTestId("menu-grid")).toBeInTheDocument();
    expect(screen.getByTestId("ticket-panel")).toBeInTheDocument();
    expect(screen.getByTestId("menu-Avocado toast")).toHaveTextContent("Sold out");
  });

  it("renders a sent order with its time", () => {
    render(<RegisterSentFixture />);
    expect(screen.getByTestId("ticket-sent")).toHaveTextContent("Sent to kitchen 14:05");
  });

  it("renders a waiter who can't send or take payment", () => {
    render(<RegisterLimitedFixture />);
    expect(screen.getAllByRole("note")).toHaveLength(2);
  });

  it("renders cash with change, a split, and a room charge", () => {
    const cash = render(<PayCashFixture />);
    expect(screen.getByTestId("change-due")).toHaveTextContent("Change to give TSh 2,210");
    cash.unmount();
    const split = render(<PaySplitFixture />);
    expect(screen.getByTestId("amount-paid")).toHaveTextContent("Paid TSh 20,000 of TSh 47,790");
    split.unmount();
    render(<PayRoomFixture />);
    expect(screen.getByTestId("confirm-room-charge")).toHaveTextContent("Charge TSh 47,790 to room 12");
  });

  it("renders payment done and the receipt", () => {
    const done = render(<PaymentDoneFixture />);
    expect(screen.getByTestId("done-change")).toHaveTextContent("Change to give TSh 2,210");
    done.unmount();
    render(<ReceiptFixture />);
    expect(screen.getByTestId("receipt-footer")).toBeInTheDocument();
  });
});
