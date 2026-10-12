import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { POSOrder } from "../lib/posContracts";
import { clockTime } from "../lib/words";
import { OrdersView, type OrdersViewProps } from "./OrdersView";

function order(id: string, extra: Partial<POSOrder> = {}): POSOrder {
  return {
    id,
    shiftId: "shift-1",
    orderNumber: id,
    status: "OPEN",
    serviceType: "DINE_IN",
    tableLabel: "12",
    initiatedById: "staff-1",
    initiatedByName: "Amina Hassan",
    subtotalMinor: 4_050_000,
    discountMinor: 0,
    discountKind: "NONE",
    discountInput: 0,
    taxMinor: 729_000,
    totalMinor: 4_779_000,
    paidMinor: 0,
    remainingMinor: 4_779_000,
    version: 4,
    items: [],
    ...extra,
  };
}

const OPEN = [
  order("0142"),
  order("0141", { status: "PREPARING", serviceType: "ROOM_SERVICE", tableLabel: "204", initiatedByName: "Juma Ally", totalMinor: 2_800_000, remainingMinor: 2_800_000 }),
  order("0140", { status: "READY", serviceType: "TAKEAWAY", tableLabel: undefined, totalMinor: 950_000, paidMinor: 500_000, remainingMinor: 450_000 }),
];
const PAID = [order("0139", { status: "CLOSED", paidMinor: 4_779_000, remainingMinor: 0 })];
const SENT_AT = new Date(Date.now() - 6 * 60_000).toISOString();

function Harness(props: Partial<OrdersViewProps>) {
  const [tab, setTab] = useState<"open" | "paid">(props.tab ?? "open");
  const [query, setQuery] = useState(props.query ?? "");
  return (
    <OrdersView
      openOrders={OPEN}
      paidOrders={PAID}
      currency="TZS"
      sentTimes={new Map([["0141", SENT_AT]])}
      onOpen={vi.fn()}
      openState={{ loading: false, failed: false, onRetry: vi.fn() }}
      paidState={{ loading: false, failed: false, onRetry: vi.fn() }}
      {...props}
      tab={tab}
      onTab={setTab}
      query={query}
      onQuery={setQuery}
    />
  );
}

describe("OrdersView", () => {
  it("lists open orders: number, where, who, when sent, status in words and total", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: /Open/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Open/ })).toHaveTextContent("3");
    const row = screen.getByTestId("order-row-0141");
    expect(row).toHaveTextContent("0141");
    expect(row).toHaveTextContent("Room 204");
    expect(row).toHaveTextContent(`Juma Ally · Sent ${clockTime(SENT_AT)}`);
    expect(row).toHaveTextContent("Preparing");
    expect(row).toHaveTextContent("TSh 28,000");
    expect(screen.getByTestId("order-row-0140")).toHaveTextContent("Takeaway");
    expect(screen.getByTestId("order-row-0140")).toHaveTextContent("TSh 4,500 still to pay");
    expect(screen.getByTestId("order-row-0142")).toHaveTextContent("Open");
  });

  it("shows this shift's paid orders on the other tab", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("tab", { name: /Paid this shift/ }));
    expect(screen.getByTestId("order-row-0139")).toHaveTextContent("Paid");
    expect(screen.queryByTestId("order-row-0142")).toBeNull();
  });

  it("finds orders as the search is typed, and says how many match", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Find an order" }), "room 204");
    expect(screen.getAllByTestId(/^order-row-/).map((row) => row.dataset.testid)).toEqual(["order-row-0141"]);
    expect(screen.getByRole("status")).toHaveTextContent("1 order matches");
  });

  it("says when nothing matches, and shows them all again from there", async () => {
    render(<Harness query="9999" />);
    expect(screen.getByText("No order matches “9999”")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show all orders" }));
    expect(screen.getAllByTestId(/^order-row-/)).toHaveLength(3);
  });

  it("opens an order with a press, and with Enter or Space on a focused row", async () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    await userEvent.click(screen.getByTestId("order-row-0141"));
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: "0141" }));
    screen.getByTestId("order-row-0142").focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ id: "0142" }));
    await userEvent.keyboard(" ");
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it("moves between rows with the arrow keys, from the search into the list but never back into the field", () => {
    render(<Harness />);
    const search = screen.getByRole("searchbox", { name: "Find an order" });
    search.focus();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(screen.getByTestId("order-row-0142")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("order-row-0142"), { key: "ArrowDown" });
    expect(screen.getByTestId("order-row-0141")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("order-row-0141"), { key: "End" });
    expect(screen.getByTestId("order-row-0140")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("order-row-0140"), { key: "Home" });
    expect(screen.getByTestId("order-row-0142")).toHaveFocus();
    expect(fireEvent.keyDown(screen.getByTestId("order-row-0142"), { key: "ArrowUp" })).toBe(false);
    expect(screen.getByTestId("order-row-0142")).toHaveFocus();
  });

  it("says there are no open orders and offers a new sale", async () => {
    const onNewSale = vi.fn();
    render(<Harness openOrders={[]} onNewSale={onNewSale} />);
    expect(screen.getByText("No open orders")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New sale" }));
    expect(onNewSale).toHaveBeenCalled();
  });

  it("says there are no paid orders on this shift yet", () => {
    render(<Harness tab="paid" paidOrders={[]} />);
    expect(screen.getByText("No paid orders on this shift yet")).toBeInTheDocument();
  });

  it("shows rows loading, and leaves the paid count off until it is known", () => {
    render(<Harness tab="paid" paidOrders={null} paidState={{ loading: true, failed: false, onRetry: vi.fn() }} />);
    expect(screen.getByLabelText("Loading the orders")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Paid this shift/ })).not.toHaveTextContent(/\d/);
  });

  it("says the list couldn't be loaded, as an alert, with Try again", async () => {
    const onRetry = vi.fn();
    render(<Harness openOrders={[]} openState={{ loading: false, failed: true, onRetry }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The orders couldn't be loaded. Check the connection, then try again.");
    await userEvent.click(within(screen.getByTestId("orders-load-error")).getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("announces what just happened to an order", () => {
    render(<Harness notice="Order 0142 was voided. The kitchen has been told." />);
    expect(screen.getByRole("status")).toHaveTextContent("Order 0142 was voided. The kitchen has been told.");
  });
});
