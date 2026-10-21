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
    dailyNumber: Number(id.replace(/\D/g, "")) || 1,
    createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    closedAt: null,
    payments: [],
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
    // Its number for the day, as staff call it; never the long reference.
    expect(row).toHaveTextContent(/^141/);
    expect(row).not.toHaveTextContent("0141");
    expect(row).toHaveTextContent("Room 204");
    expect(row).toHaveTextContent(`Juma Ally · Sent ${clockTime(SENT_AT)}`);
    expect(row).toHaveTextContent("Preparing");
    expect(row).toHaveTextContent("TSh 28,000");
    expect(screen.getByTestId("order-row-0140")).toHaveTextContent("Takeaway");
    expect(screen.getByTestId("order-row-0140")).toHaveTextContent("TSh 4,500 still to pay");
    expect(screen.getByTestId("order-row-0142")).toHaveTextContent("Open");
  });

  it("shows today's paid orders on the other tab", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("tab", { name: /Paid today/ }));
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

  const paidPage = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      order(`p${String(index).padStart(3, "0")}`, {
        status: "CLOSED",
        paidMinor: 4_779_000,
        remainingMinor: 0,
        closedAt: new Date(2026, 9, 12, 14, 23).toISOString(),
      }),
    );
  const paging = (extra: Partial<NonNullable<OrdersViewProps["paidPaging"]>> = {}) => ({
    hasMore: false,
    loadingMore: false,
    searchedAll: true,
    reading: false,
    onMore: vi.fn(),
    ...extra,
  });

  it("shows today's paid orders as Yetu pages them, the latest paid first; Show more asks for the next page", async () => {
    const onMore = vi.fn();
    render(<Harness tab="paid" paidOrders={paidPage(50)} paidPaging={paging({ hasMore: true, searchedAll: false, onMore })} />);
    expect(screen.getByRole("tab", { name: /Paid today/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByTestId(/^order-row-/)).toHaveLength(50);
    expect(screen.getByTestId("orders-caption")).toHaveTextContent("Latest paid first · 50 shown");
    // How many were paid today isn't known until every page is read.
    expect(screen.getByRole("tab", { name: /Paid today/ })).not.toHaveTextContent(/\d/);
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it("holds Show more while the next page is with Yetu, and drops it once every page is read", () => {
    const { rerender } = render(<Harness tab="paid" paidOrders={paidPage(50)} paidPaging={paging({ hasMore: true, loadingMore: true, searchedAll: false })} />);
    expect(screen.getByRole("button", { name: "Loading more…" })).toBeDisabled();
    rerender(<Harness tab="paid" paidOrders={paidPage(62)} paidPaging={paging()} />);
    expect(screen.queryByRole("button", { name: /Show more|Loading more/ })).toBeNull();
    expect(screen.getByRole("tab", { name: /Paid today/ })).toHaveTextContent("62");
  });

  it("a paid row says when it was paid", () => {
    render(<Harness tab="paid" paidOrders={paidPage(1)} paidPaging={paging()} />);
    expect(screen.getByTestId("order-row-p000")).toHaveTextContent("Amina Hassan · Paid 14:23");
  });

  it("while a search reads the rest of today, it says so, even between two pages, and never says 'no match' yet", () => {
    render(
      <Harness
        tab="paid"
        query="nothing like it"
        paidOrders={paidPage(50)}
        paidPaging={paging({ hasMore: true, loadingMore: false, searchedAll: false, reading: true })}
      />,
    );
    expect(screen.getByTestId("orders-status")).toHaveTextContent("Looking through today's paid orders…");
    expect(screen.queryByText(/No order matches/)).toBeNull();
  });

  it("a search that stopped at its ceiling says which orders it looked through", () => {
    render(<Harness tab="paid" query="nothing like it" paidOrders={paidPage(50)} paidPaging={paging({ hasMore: true, searchedAll: false })} />);
    expect(screen.getByText("No order matches “nothing like it”")).toBeInTheDocument();
    expect(screen.getByText("Only the latest 50 paid orders today were searched.")).toBeInTheDocument();
  });

  it("says there are no paid orders today yet", () => {
    render(<Harness tab="paid" paidOrders={[]} paidPaging={paging()} />);
    expect(screen.getByText("No paid orders today yet")).toBeInTheDocument();
  });

  it("shows rows loading, and leaves the paid count off until it is known", () => {
    render(<Harness tab="paid" paidOrders={null} paidState={{ loading: true, failed: false, onRetry: vi.fn() }} />);
    expect(screen.getByLabelText("Loading the orders")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Paid today/ })).not.toHaveTextContent(/\d/);
  });

  it("says the list couldn't be loaded, as an alert, with Try again", async () => {
    const onRetry = vi.fn();
    render(<Harness openOrders={[]} openState={{ loading: false, failed: true, onRetry }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The orders couldn't be loaded. Check the connection, then try again.");
    await userEvent.click(within(screen.getByTestId("orders-load-error")).getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("announces what just happened to an order", () => {
    render(<Harness notice="Order 0142 was cancelled. The kitchen has been told." />);
    expect(screen.getByRole("status")).toHaveTextContent("Order 0142 was cancelled. The kitchen has been told.");
  });
});

describe("OrdersView: refunds on the paid list (S10a)", () => {
  it("says Partly refunded or Refunded from Yetu's figure, and the status otherwise", async () => {
    const total = 4_779_000;
    const paid = [
      order("0137", { status: "CLOSED", paidMinor: total, remainingMinor: 0, totalMinor: total, refundedMinor: 590_000 }),
      order("0138", { status: "CLOSED", paidMinor: total, remainingMinor: 0, totalMinor: total, refundedMinor: total }),
      order("0139", { status: "CLOSED", paidMinor: total, remainingMinor: 0, totalMinor: total, refundedMinor: 0 }),
    ];
    render(<Harness tab="paid" paidOrders={paid} />);
    expect(screen.getByTestId("order-state-0137")).toHaveTextContent("Partly refunded");
    expect(screen.getByTestId("order-state-0138")).toHaveTextContent("Refunded");
    expect(screen.getByTestId("order-state-0138")).not.toHaveTextContent("Partly");
    expect(screen.getByTestId("order-state-0139")).not.toHaveTextContent(/refunded/i);
  });
});
