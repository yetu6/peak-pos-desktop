import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { POSOrder, POSOrderItem } from "../lib/posContracts";
import { TicketPanel, type TicketPanelProps } from "./TicketPanel";

function line(id: string, name: string, quantity: number, totalMinor: number, extra: Partial<POSOrderItem> = {}): POSOrderItem {
  return { id, productId: `p-${id}`, name, quantity, unitPriceMinor: totalMinor, taxMinor: 0, totalMinor, status: "ADDED", ...extra };
}

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
  tableLabel: "12",
  initiatedById: "staff-amina",
  initiatedByName: "Amina Hassan",
  subtotalMinor: 3_600_000,
  discountMinor: 200_000,
  discountKind: "AMOUNT",
  discountInput: 200_000,
  discountReason: "Regular guest",
  taxMinor: 612_000,
  totalMinor: 4_012_000,
  paidMinor: 0,
  remainingMinor: 4_012_000,
  version: 4,
  items: [
    line("l1", "Cappuccino", 2, 1_534_000),
    line("l2", "House burger", 1, 2_478_000, {
      status: "SENT",
      modifiers: [
        { id: "m1", groupName: "Cooked", optionName: "Medium", priceDeltaMinor: 0 },
        { id: "m2", groupName: "Extras", optionName: "Cheese", priceDeltaMinor: 150_000 },
      ],
    }),
  ],
};

function renderTicket(props: Partial<TicketPanelProps> = {}) {
  const handlers = {
    onServiceType: vi.fn(),
    onLabel: vi.fn(),
    onSelectLine: vi.fn(),
    onAddAnother: vi.fn(),
    onRemoveLine: vi.fn(),
  };
  render(
    <TicketPanel
      order={ORDER}
      currency="TZS"
      serviceType="DINE_IN"
      label=""
      selectedLineId={null}
      lineBusy={false}
      sentAt={null}
      error={null}
      actions={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("TicketPanel", () => {
  it("offers the backend's three order types only", () => {
    renderTicket({ order: null });
    const types = within(screen.getByRole("radiogroup", { name: "Order type" })).getAllByRole("radio");
    expect(types.map((type) => type.textContent)).toEqual(["Dine in", "Takeaway", "Room service"]);
  });

  it("asks for a table for dine in", () => {
    renderTicket({ order: null, serviceType: "DINE_IN" });
    expect(screen.getByRole("textbox", { name: "Table" })).toBeInTheDocument();
  });

  it("asks for a room for room service and nothing for takeaway", () => {
    const { unmount } = render(
      <TicketPanel
        order={null}
        currency="TZS"
        serviceType="ROOM_SERVICE"
        label=""
        onServiceType={vi.fn()}
        onLabel={vi.fn()}
        selectedLineId={null}
        onSelectLine={vi.fn()}
        onAddAnother={vi.fn()}
        onRemoveLine={vi.fn()}
        lineBusy={false}
        sentAt={null}
        error={null}
        actions={null}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Room" })).toBeInTheDocument();
    unmount();
    renderTicket({ order: null, serviceType: "TAKEAWAY" });
    expect(screen.queryByRole("textbox", { name: /Table|Room/ })).not.toBeInTheDocument();
  });

  it("locks the order type and table once the order has started, and says so", () => {
    renderTicket({ label: "12" });
    for (const type of within(screen.getByRole("radiogroup", { name: "Order type" })).getAllByRole("radio")) {
      expect(type).toBeDisabled();
    }
    expect(screen.queryByRole("textbox", { name: "Table" })).not.toBeInTheDocument();
    expect(screen.getByTestId("table-label")).toHaveTextContent("Table 12 · Saved with the order.");
  });

  it("shows each line with its quantity, options beneath, and Yetu's price", () => {
    renderTicket();
    const burger = screen.getByRole("button", { name: /House burger/ });
    expect(burger).toHaveTextContent("1");
    expect(burger).toHaveTextContent("Medium");
    expect(burger).toHaveTextContent("Cheese");
    expect(burger).toHaveTextContent("TSh 24,780");
    expect(screen.getByRole("button", { name: /Cappuccino/ })).toHaveTextContent("2");
  });

  it("totals from Yetu's figures: subtotal, discount, VAT and total", () => {
    renderTicket();
    const totals = screen.getByTestId("ticket-totals");
    expect(totals).toHaveTextContent("Subtotal");
    expect(totals).toHaveTextContent("TSh 36,000");
    expect(screen.getByTestId("cart-discount")).toHaveTextContent("−TSh 2,000");
    expect(totals).toHaveTextContent("VAT");
    expect(totals).toHaveTextContent("TSh 6,120");
    expect(screen.getByTestId("cart-preview-total")).toHaveTextContent("TSh 40,120");
  });

  it("shows what is paid and what is left once part of it is paid", () => {
    renderTicket({ order: { ...ORDER, paidMinor: 2_000_000, remainingMinor: 2_012_000 } });
    expect(screen.getByTestId("ticket-totals")).toHaveTextContent("Paid");
    expect(screen.getByTestId("cart-remaining")).toHaveTextContent("TSh 20,120");
  });

  it("selecting an unsent line offers Add another and Remove", async () => {
    const { onSelectLine } = renderTicket();
    await userEvent.click(screen.getByRole("button", { name: /Cappuccino/ }));
    expect(onSelectLine).toHaveBeenCalledWith("l1");
  });

  it("for a selected unsent line, Add another and Remove act on that line", async () => {
    const handlers = renderTicket({ selectedLineId: "l1" });
    const actions = screen.getByRole("group", { name: "Cappuccino" });
    await userEvent.click(within(actions).getByRole("button", { name: "Add another" }));
    expect(handlers.onAddAnother).toHaveBeenCalledWith(ORDER.items[0]);
    await userEvent.click(within(actions).getByRole("button", { name: "Remove" }));
    expect(handlers.onRemoveLine).toHaveBeenCalledWith(ORDER.items[0]);
  });

  it("a sent line can't be removed here: it says to void the order with a supervisor", () => {
    renderTicket({ selectedLineId: "l2" });
    const actions = screen.getByRole("group", { name: "House burger" });
    expect(within(actions).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(actions).toHaveTextContent("Sent to the kitchen. To take it off, void the order with a supervisor (More).");
  });

  it("Esc lets go of the selected line", () => {
    const { onSelectLine } = renderTicket({ selectedLineId: "l1" });
    fireEvent.keyDown(screen.getByRole("group", { name: "Cappuccino" }), { key: "Escape" });
    expect(onSelectLine).toHaveBeenCalledWith(null);
  });

  it("says when the order went to the kitchen", () => {
    renderTicket({ order: { ...ORDER, status: "SENT" }, sentAt: new Date(2026, 9, 12, 14, 5) });
    expect(screen.getByTestId("ticket-sent")).toHaveTextContent("Sent to kitchen 14:05");
  });

  it("starts empty with what to do", () => {
    renderTicket({ order: null });
    expect(screen.getByText("Tap an item to start an order.")).toBeInTheDocument();
  });
});

describe("TicketPanel: rounds (S17a)", () => {
  it("says each sent line's round once there are several, and Sent when there is one", () => {
    const rounds = {
      ...ORDER,
      status: "SERVED" as const,
      roundsSent: 2,
      items: [line("l1", "Cappuccino", 2, 1_534_000, { status: "SENT", roundNumber: 1 }), line("l2", "Cake", 1, 590_000, { status: "SENT", roundNumber: 2 })],
    };
    renderTicket({ order: rounds });
    expect(screen.getByTestId("cart-Cappuccino")).toHaveTextContent("Round 1");
    expect(screen.getByTestId("cart-Cake")).toHaveTextContent("Round 2");
    cleanup();
    renderTicket({ order: { ...rounds, roundsSent: 1, items: [rounds.items[0]] } });
    expect(screen.getByTestId("cart-Cappuccino")).toHaveTextContent("Sent");
    expect(screen.getByTestId("cart-Cappuccino")).not.toHaveTextContent("Round");
  });
});
