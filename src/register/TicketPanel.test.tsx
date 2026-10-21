import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { POSOrder, POSOrderItem } from "../lib/posContracts";
import { TicketPanel, type TicketPanelProps } from "./TicketPanel";
import { DISCOUNT_HELD_WORDS } from "./registerWords";

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

/** The ticket as an element, for rerendering with a new order. */
function ticketElement(props: Partial<TicketPanelProps> = {}) {
  return (
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
      onServiceType={vi.fn()}
      onLabel={vi.fn()}
      onSelectLine={vi.fn()}
      onQuantity={vi.fn()}
      onRemoveLine={vi.fn()}
      {...props}
    />
  );
}

function renderTicket(props: Partial<TicketPanelProps> = {}) {
  const handlers = {
    onServiceType: vi.fn(),
    onLabel: vi.fn(),
    onSelectLine: vi.fn(),
    onQuantity: vi.fn(),
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
        onQuantity={vi.fn()}
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

  // The owner, 2026-10-20: a percent discount never comes to more money off than its supervisor approved.
  it("says when the discount is kept to what the supervisor approved, and only then", () => {
    renderTicket({ order: { ...ORDER, discountKind: "PERCENT", discountInput: 1000, discountCapped: true } });
    expect(screen.getByTestId("discount-held")).toHaveTextContent(DISCOUNT_HELD_WORDS);
    cleanup();
    renderTicket({ order: { ...ORDER, discountKind: "PERCENT", discountInput: 1000 } });
    expect(screen.queryByTestId("discount-held")).not.toBeInTheDocument();
  });

  it("shows what is paid and what is left once part of it is paid", () => {
    renderTicket({ order: { ...ORDER, paidMinor: 2_000_000, remainingMinor: 2_012_000 } });
    expect(screen.getByTestId("ticket-totals")).toHaveTextContent("Paid");
    expect(screen.getByTestId("cart-remaining")).toHaveTextContent("TSh 20,120");
  });

  it("selecting an unsent line offers its quantity and Remove", async () => {
    const { onSelectLine } = renderTicket();
    await userEvent.click(screen.getByRole("button", { name: /Cappuccino/ }));
    expect(onSelectLine).toHaveBeenCalledWith("l1");
  });

  it("for a selected unsent line, its stepper and Remove act on that line", async () => {
    const handlers = renderTicket({ selectedLineId: "l1" });
    const actions = screen.getByRole("group", { name: "Cappuccino" });
    expect(within(actions).getByRole("group", { name: "Cappuccino quantity" })).toHaveTextContent("2");
    await userEvent.click(within(actions).getByRole("button", { name: "One more Cappuccino" }));
    expect(handlers.onQuantity).toHaveBeenCalledWith(ORDER.items[0], 3);
    await userEvent.click(within(actions).getByRole("button", { name: "One fewer Cappuccino" }));
    expect(handlers.onQuantity).toHaveBeenCalledWith(ORDER.items[0], 1);
    await userEvent.click(within(actions).getByRole("button", { name: "Remove" }));
    expect(handlers.onRemoveLine).toHaveBeenCalledWith(ORDER.items[0]);
  });

  it("a sent line can't be removed here: a supervisor voids it (the owner, 2026-10-21)", async () => {
    const onVoidLine = vi.fn();
    renderTicket({ selectedLineId: "l2", onVoidLine });
    const actions = screen.getByRole("group", { name: "House burger" });
    expect(within(actions).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    await userEvent.click(within(actions).getByRole("button", { name: "Cancel item" }));
    expect(onVoidLine).toHaveBeenCalledWith(ORDER.items[1]);
  });

  it("once part of the bill is paid, a sent line is refunded after payment, not voided", () => {
    renderTicket({ selectedLineId: "l2", onVoidLine: vi.fn(), order: { ...ORDER, paidMinor: 100_000, remainingMinor: ORDER.totalMinor - 100_000 } });
    const actions = screen.getByRole("group", { name: "House burger" });
    expect(within(actions).queryByRole("button", { name: "Cancel item" })).not.toBeInTheDocument();
    expect(actions).toHaveTextContent("Sent to the kitchen, and part of the bill is paid: refund it after it's paid.");
  });

  it("a till that can't void says who can", () => {
    renderTicket({ selectedLineId: "l2" });
    expect(screen.getByRole("group", { name: "House burger" })).toHaveTextContent("Sent to the kitchen. A supervisor can cancel it.");
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

  // Bahari's Order 7 read "Items TSh 0" beside "Total —" before its first line.
  it("an order with no lines yet shows no figures, all alike", () => {
    const started = { ...ORDER, items: [], subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0, remainingMinor: 0, pricesIncludeTax: true };
    renderTicket({ order: started });
    const totals = screen.getByTestId("ticket-totals");
    expect(totals).not.toHaveTextContent("TSh");
    expect(totals).toHaveTextContent("VAT included");
  });
});

describe("TicketPanel: rounds (S17a)", () => {
  it("groups the lines by round under one heading each, never a chip on every line", () => {
    const rounds = {
      ...ORDER,
      status: "SERVED" as const,
      roundsSent: 2,
      items: [line("l1", "Cappuccino", 2, 1_534_000, { status: "SENT", roundNumber: 1 }), line("l2", "Cake", 1, 590_000, { status: "SENT", roundNumber: 2 })],
    };
    renderTicket({ order: rounds });
    const first = screen.getByTestId("ticket-group-round-1");
    expect(within(first).getByRole("heading", { name: "Round 1" })).toBeInTheDocument();
    expect(within(first).getByTestId("cart-Cappuccino")).toBeInTheDocument();
    expect(within(screen.getByTestId("ticket-group-round-2")).getByTestId("cart-Cake")).toBeInTheDocument();
    expect(screen.getByTestId("cart-Cappuccino")).not.toHaveTextContent("Round");
    cleanup();
    // One round, all sent: no headings; the ticket's own chip says it went.
    renderTicket({ order: { ...rounds, roundsSent: 1, items: [rounds.items[0]] } });
    expect(screen.queryByRole("heading", { name: /Round/ })).toBeNull();
    expect(screen.getByTestId("cart-Cappuccino")).not.toHaveTextContent("Sent");
  });

  it("keeps what isn't sent yet apart and last, under Not sent yet", () => {
    const added = {
      ...ORDER,
      status: "SERVED" as const,
      roundsSent: 1,
      items: [line("l1", "Cappuccino", 2, 1_534_000, { status: "SENT", roundNumber: 1 }), line("l2", "Cake", 1, 590_000, { status: "ADDED" })],
    };
    renderTicket({ order: added });
    const groups = screen.getAllByTestId(/^ticket-group-/).map((group) => group.getAttribute("data-testid"));
    expect(groups).toEqual(["ticket-group-round-1", "ticket-group-unsent"]);
    expect(within(screen.getByTestId("ticket-group-unsent")).getByRole("heading", { name: "Not sent yet" })).toBeInTheDocument();
    expect(within(screen.getByTestId("ticket-group-unsent")).getByTestId("cart-Cake")).toBeInTheDocument();
  });
});

describe("TicketPanel: the newest line in view", () => {
  it("scrolls to the line just added", () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      const one = { ...ORDER, items: [line("l1", "Cappuccino", 2, 1_534_000)] };
      const { rerender } = render(ticketElement({ order: one }));
      scrolled.length = 0;
      rerender(ticketElement({ order: { ...one, items: [...one.items, line("l2", "Cake", 1, 590_000)] } }));
      expect(scrolled.at(-1)).toBe(screen.getByTestId("cart-Cake"));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe("TicketPanel: an everyday removal is not a red block", () => {
  it("a chosen line's Remove is outlined in red, beside its stepper", () => {
    renderTicket({ selectedLineId: "l1" });
    const remove = screen.getByRole("button", { name: /Remove/ });
    expect(remove).toHaveClass("y-button--danger-outline");
    expect(remove).not.toHaveClass("y-button--danger");
  });
});

describe("TicketPanel: a line holds what Yetu takes", () => {
  it("one more stops at the most of an item a line holds", () => {
    const full = { ...ORDER, items: [{ ...ORDER.items[0], quantity: 999 }, ORDER.items[1]] };
    renderTicket({ order: full, selectedLineId: "l1" });
    expect(screen.getByRole("button", { name: "One more Cappuccino" })).toBeDisabled();
  });
});

// F-229: with VAT inside the prices the ticket reads the menu prices.
describe("TicketPanel: prices that include VAT", () => {
  it("reads Items at the menu prices, TSh 2,000 off them, VAT included and the total", () => {
    renderTicket({
      order: {
        ...ORDER,
        pricesIncludeTax: true,
        subtotalMinor: 1_271_186,
        discountMinor: 169_491,
        taxMinor: 198_305,
        totalMinor: 1_300_000,
        remainingMinor: 1_300_000,
        items: [line("l1", "Cappuccino", 3, 1_500_000)],
      },
    });
    const totals = screen.getByTestId("ticket-totals");
    expect(totals).toHaveTextContent("Items");
    expect(totals).toHaveTextContent("TSh 15,000");
    expect(screen.getByTestId("cart-discount")).toHaveTextContent("TSh 2,000");
    expect(totals).toHaveTextContent("VAT included");
    expect(totals).toHaveTextContent("TSh 1,983.05");
    expect(totals).not.toHaveTextContent("Subtotal");
    expect(screen.getByTestId("cart-preview-total")).toHaveTextContent("TSh 13,000");
  });
});
