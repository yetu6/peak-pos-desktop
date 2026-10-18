import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  OrderKitchenFixture,
  OrderLimitedFixture,
  OrderOpenFixture,
  OrderPaidFixture,
  OrderPartPaidFixture,
  OrdersFixture,
  OrdersNoMatchFixture,
  OrdersPaidFixture,
  OrdersSearchFixture,
} from "./OrdersFixtures";

describe("OrdersFixtures", () => {
  it("renders the open orders, each in its own state", () => {
    render(<OrdersFixture />);
    expect(screen.getAllByTestId(/^order-row-/)).toHaveLength(6);
    expect(screen.getByTestId("order-row-order-141")).toHaveTextContent("Room 204");
    expect(screen.getByTestId("order-row-order-140")).toHaveTextContent("still to pay");
  });

  it("renders the paid orders and a search", () => {
    const paid = render(<OrdersPaidFixture />);
    expect(screen.getAllByTestId(/^order-row-/).map((row) => row.dataset.testid)).toEqual(["order-row-order-136", "order-row-order-135"]);
    paid.unmount();
    const found = render(<OrdersSearchFixture />);
    expect(screen.getAllByTestId(/^order-row-/)).toHaveLength(1);
    found.unmount();
    render(<OrdersNoMatchFixture />);
    expect(screen.getByText("No order matches “0999”")).toBeInTheDocument();
  });

  it("renders each order's detail with the actions its state allows", () => {
    const open = render(<OrderOpenFixture />);
    expect(screen.getByRole("button", { name: /Remove/ })).toBeInTheDocument();
    expect(screen.getByTestId("detail-send")).toBeEnabled();
    open.unmount();
    const kitchen = render(<OrderKitchenFixture />);
    expect(screen.getByTestId("order-detail-timeline")).toHaveTextContent("Grill: preparing");
    kitchen.unmount();
    const part = render(<OrderPartPaidFixture />);
    expect(screen.getByRole("button", { name: "Void order" })).toBeDisabled();
    part.unmount();
    const paid = render(<OrderPaidFixture />);
    expect(within(screen.getByTestId("order-detail-payments")).getByText(/^Cash · TSh/)).toBeInTheDocument();
    expect(screen.getByTestId("order-detail-payments")).toHaveTextContent("Taken by Grace Mushi");
    paid.unmount();
    render(<OrderLimitedFixture />);
    expect(screen.getAllByRole("note")).toHaveLength(2);
  });
});
