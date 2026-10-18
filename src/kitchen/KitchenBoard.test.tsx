import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { POSOrderItem } from "../lib/posContracts";
import { clockTime } from "../lib/words";
import { KitchenBoard, type KitchenBoardProps } from "./KitchenBoard";
import type { BoardTicket } from "./kitchenTickets";

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;

function line(id: string, name: string, quantity: number, options: string[] = []): POSOrderItem {
  return {
    id,
    productId: `p-${id}`,
    name,
    quantity,
    unitPriceMinor: 100_000,
    taxMinor: 18_000,
    totalMinor: 118_000 * quantity,
    status: "SENT",
    modifiers: options.map((optionName, index) => ({ id: `${id}-m${index}`, groupName: "Options", optionName, priceDeltaMinor: 0 })),
  };
}

function ticket(id: string, status: BoardTicket["status"], sentAgoMs: number, extra: Partial<BoardTicket> = {}): BoardTicket {
  return {
    id,
    kind: "station",
    orderId: `order-${id}`,
    orderNumber: `POS-MR-261012-${id.toUpperCase()}`,
    // a1 is order 11, b1 order 21, c1 order 31: the number the kitchen calls out.
    dailyNumber: (id.charCodeAt(0) - 96) * 10 + Number(id.slice(1)),
    status,
    version: 2,
    serviceType: "DINE_IN",
    tableLabel: "12",
    staffName: "Amina Hassan",
    sentAt: ago(sentAgoMs),
    items: [line(`${id}-1`, "Cappuccino", 2)],
    ...extra,
  };
}

function renderBoard(props: Partial<KitchenBoardProps> = {}) {
  const onNextStep = vi.fn();
  const view = render(
    <KitchenBoard
      title="Kitchen"
      tickets={[]}
      nowMs={NOW}
      busyIds={new Set()}
      canMove
      onNextStep={onNextStep}
      {...props}
    />,
  );
  return { ...view, onNextStep };
}

describe("KitchenBoard", () => {
  it("shows New, Preparing and Ready with how many tickets each holds", () => {
    renderBoard({
      tickets: [ticket("a1", "SENT", 2 * MINUTE), ticket("a2", "SENT", MINUTE), ticket("b1", "PREPARING", 6 * MINUTE)],
    });
    const columns = screen.getAllByRole("region");
    expect(columns.map((column) => column.getAttribute("aria-label"))).toEqual(["New, 2 tickets", "Preparing, 1 ticket", "Ready, 0 tickets"]);
    expect(within(screen.getByTestId("kitchen-column-SENT")).getAllByRole("article").map((card) => card.dataset.testid)).toEqual([
      "kitchen-ticket-a1",
      "kitchen-ticket-a2",
    ]);
  });

  it("shows where it goes, who took it, when it was sent and its age in words and minutes", () => {
    const sentAt = ago(12 * MINUTE);
    renderBoard({ tickets: [ticket("a1", "PREPARING", 12 * MINUTE, { sentAt, station: "GRILL" })] });
    const card = screen.getByTestId("kitchen-ticket-a1");
    expect(within(card).getByRole("heading", { name: "11" })).toBeInTheDocument();
    // The long reference is not what the kitchen calls it.
    expect(card).not.toHaveTextContent("POS-MR-261012-A1");
    expect(card).toHaveTextContent(`Table 12 · Amina Hassan · Sent ${clockTime(sentAt)} · Grill`);
    expect(within(card).getByTestId("kitchen-age-a1")).toHaveTextContent("Getting late · 12 min");
  });

  it("says Takeaway or Room when that is where it goes", () => {
    renderBoard({
      tickets: [
        ticket("a1", "SENT", MINUTE * 3, { serviceType: "TAKEAWAY", tableLabel: undefined }),
        ticket("a2", "SENT", MINUTE * 3, { serviceType: "ROOM_SERVICE", tableLabel: "204" }),
      ],
    });
    expect(screen.getByTestId("kitchen-ticket-a1")).toHaveTextContent("Takeaway · Amina Hassan");
    expect(screen.getByTestId("kitchen-ticket-a2")).toHaveTextContent("Room 204 · Amina Hassan");
  });

  it("says the sent time isn't known rather than guess it", () => {
    renderBoard({ tickets: [ticket("a1", "SENT", 0, { sentAt: undefined })] });
    expect(screen.getByTestId("kitchen-age-a1")).toHaveTextContent("Sent time not known");
    expect(screen.getByTestId("kitchen-ticket-a1")).not.toHaveTextContent(/Sent \d/);
  });

  it("lists each item with its quantity, and its options and the order's note picked out", () => {
    renderBoard({
      tickets: [
        ticket("a1", "SENT", MINUTE, {
          items: [line("l1", "House burger", 1, ["Medium", "Cheese"]), line("l2", "Sparkling water", 3)],
          notes: "No onions, nut allergy",
        }),
      ],
    });
    const items = within(screen.getByTestId("kitchen-ticket-a1")).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("1House burgerMediumCheese");
    expect(items[1]).toHaveTextContent("3Sparkling water");
    expect(within(items[0]).getAllByTestId("kitchen-option").map((option) => option.textContent)).toEqual(["Medium", "Cheese"]);
    expect(screen.getByTestId("kitchen-note-a1")).toHaveTextContent("Note: No onions, nut allergy");
  });

  it("marks a ticket nobody has started as New for its first 30 seconds", () => {
    renderBoard({ tickets: [ticket("a1", "SENT", 10_000), ticket("a2", "SENT", 31_000), ticket("a3", "PREPARING", 5_000)] });
    expect(within(screen.getByTestId("kitchen-ticket-a1")).getByText("New")).toBeInTheDocument();
    expect(within(screen.getByTestId("kitchen-ticket-a2")).queryByText("New")).toBeNull();
    expect(within(screen.getByTestId("kitchen-ticket-a3")).queryByText("New")).toBeNull();
  });

  it("gives each ticket one large next step, named with its order, that moves it on", async () => {
    const { onNextStep } = renderBoard({
      tickets: [ticket("a1", "SENT", MINUTE), ticket("b1", "PREPARING", MINUTE), ticket("c1", "READY", MINUTE)],
    });
    expect(screen.getByTestId("kitchen-next-a1")).toHaveAccessibleName("Start order 11");
    expect(screen.getByTestId("kitchen-next-b1")).toHaveAccessibleName("Ready order 21");
    expect(screen.getByTestId("kitchen-next-c1")).toHaveAccessibleName("Served order 31");
    expect(screen.getByTestId("kitchen-next-a1")).toHaveClass("y-button--primary", "y-button--64");
    await userEvent.click(screen.getByTestId("kitchen-next-b1"));
    expect(onNextStep).toHaveBeenCalledWith(expect.objectContaining({ id: "b1", status: "PREPARING" }));
  });

  it("holds only the ticket on its way to Yetu, saying so, and can't be pressed twice, keeping focus on it", async () => {
    const tickets = [ticket("a1", "SENT", MINUTE), ticket("a2", "SENT", MINUTE)];
    const view = renderBoard({ tickets });
    screen.getByTestId("kitchen-next-a1").focus();
    view.rerender(<KitchenBoard title="Kitchen" tickets={tickets} nowMs={NOW} busyIds={new Set(["a1"])} canMove onNextStep={view.onNextStep} />);
    const held = screen.getByTestId("kitchen-next-a1");
    expect(held).toHaveAttribute("aria-disabled", "true");
    expect(held).toHaveTextContent("Starting…");
    // Not the native disabled: that would drop the focus a keyboard user has on it.
    expect(held).toHaveFocus();
    expect(screen.getByTestId("kitchen-next-a2")).not.toHaveAttribute("aria-disabled");
    await userEvent.click(held);
    await userEvent.keyboard("{Enter}");
    expect(view.onNextStep).not.toHaveBeenCalled();
  });

  it("keeps focus with a ticket when its step moves it to the next column", () => {
    const view = renderBoard({ tickets: [ticket("a1", "SENT", MINUTE), ticket("a2", "SENT", MINUTE)] });
    screen.getByTestId("kitchen-next-a1").focus();
    view.rerender(
      <KitchenBoard
        title="Kitchen"
        tickets={[ticket("a1", "PREPARING", MINUTE, { version: 3 }), ticket("a2", "SENT", MINUTE)]}
        nowMs={NOW}
        busyIds={new Set()}
        canMove
        onNextStep={view.onNextStep}
      />,
    );
    expect(within(screen.getByTestId("kitchen-column-PREPARING")).getByTestId("kitchen-next-a1")).toHaveFocus();
  });

  it("gives focus to the next ticket in the column when a served one leaves the board (or the one above, if it was last)", () => {
    const board = (tickets: BoardTicket[]) => (
      <KitchenBoard title="Kitchen" tickets={tickets} nowMs={NOW} busyIds={new Set()} canMove onNextStep={vi.fn()} />
    );
    const fresh = ticket("a1", "SENT", MINUTE);
    const view = render(board([fresh, ticket("c1", "READY", MINUTE), ticket("c2", "READY", MINUTE), ticket("c3", "READY", MINUTE)]));
    screen.getByTestId("kitchen-next-c1").focus();
    view.rerender(board([fresh, ticket("c2", "READY", MINUTE), ticket("c3", "READY", MINUTE)]));
    expect(screen.getByTestId("kitchen-next-c2")).toHaveFocus();
    screen.getByTestId("kitchen-next-c3").focus();
    view.rerender(board([fresh, ticket("c2", "READY", MINUTE)]));
    expect(screen.getByTestId("kitchen-next-c2")).toHaveFocus();
  });

  it("doesn't pull focus back after a click on empty space, on the next tick or any later render", async () => {
    const board = (tickets: BoardTicket[], nowMs: number) => (
      <KitchenBoard title="Kitchen" tickets={tickets} nowMs={nowMs} busyIds={new Set()} canMove onNextStep={vi.fn()} />
    );
    const view = render(board([ticket("a1", "SENT", MINUTE), ticket("a2", "SENT", MINUTE)], NOW));
    // A step pressed from the keyboard moves its ticket on, and focus follows it.
    screen.getByTestId("kitchen-next-a1").focus();
    view.rerender(board([ticket("a1", "PREPARING", MINUTE, { version: 3 }), ticket("a2", "SENT", MINUTE)], NOW));
    expect(within(screen.getByTestId("kitchen-column-PREPARING")).getByTestId("kitchen-next-a1")).toHaveFocus();
    // The person clicks the board's empty space: nothing there takes focus.
    await userEvent.click(screen.getByTestId("kitchen-column-READY"));
    expect(document.body).toHaveFocus();
    // The clock ticks, and later the board changes: focus stays where the person left it.
    view.rerender(board([ticket("a1", "PREPARING", MINUTE, { version: 3 }), ticket("a2", "SENT", MINUTE)], NOW + 5_000));
    expect(document.body).toHaveFocus();
    view.rerender(board([ticket("a1", "READY", MINUTE, { version: 4 }), ticket("a2", "SENT", MINUTE)], NOW + 10_000));
    expect(document.body).toHaveFocus();
  });

  it("leaves focus alone when the person was somewhere else", () => {
    const stationFilter = { options: [{ value: "ALL", label: "All stations" }, { value: "GRILL", label: "Grill" }], value: "ALL", onChange: vi.fn() };
    const view = renderBoard({ tickets: [ticket("a1", "SENT", MINUTE)], stationFilter });
    screen.getByTestId("kitchen-next-a1").focus();
    // The person moves to the station choice, then leaves it for nothing in particular.
    screen.getByRole("radio", { name: "All stations" }).focus();
    screen.getByRole("radio", { name: "All stations" }).blur();
    view.rerender(
      <KitchenBoard title="Kitchen" tickets={[ticket("a1", "PREPARING", MINUTE)]} nowMs={NOW} busyIds={new Set()} canMove onNextStep={vi.fn()} stationFilter={stationFilter} />,
    );
    expect(document.body).toHaveFocus();
  });

  it("shows the step closed, with who can, to a person who can't move tickets; it can still be reached to scroll and read", async () => {
    const { onNextStep } = renderBoard({ tickets: [ticket("a1", "SENT", MINUTE)], canMove: false });
    const step = screen.getByTestId("kitchen-next-a1");
    expect(screen.getByRole("note")).toHaveTextContent("Only kitchen and waiting staff can move tickets on. Ask a manager.");
    expect(step).toHaveAttribute("aria-disabled", "true");
    expect(step).toHaveAccessibleDescription("Only kitchen and waiting staff can move tickets on. Ask a manager.");
    step.focus();
    expect(step).toHaveFocus();
    await userEvent.click(step);
    await userEvent.keyboard("{Enter}");
    expect(onNextStep).not.toHaveBeenCalled();
  });

  it("says nothing is waiting when the board is empty, and keeps its three columns", () => {
    renderBoard();
    expect(screen.getAllByRole("region")).toHaveLength(3);
    expect(screen.getByTestId("kitchen-column-SENT")).toHaveTextContent(
      "No orders waitingNew orders appear here as soon as they are sent.",
    );
  });

  it("announces what a step did, and a refusal as an alert", () => {
    renderBoard({ result: "Order 0142 is ready.", problem: "The ticket didn't move. Try again." });
    expect(screen.getByRole("status")).toHaveTextContent("Order 0142 is ready.");
    expect(screen.getByRole("alert")).toHaveTextContent("The ticket didn't move. Try again.");
  });

  it("says when the tickets couldn't be loaded, and that it tries again by itself", () => {
    renderBoard({ failed: true });
    expect(screen.getByRole("alert")).toHaveTextContent("The tickets couldn't be loaded. Check the connection. The screen tries again every 15 seconds.");
  });

  it("shows tickets loading in the shape of tickets", () => {
    renderBoard({ loading: true });
    expect(screen.getByLabelText("Loading the tickets")).toBeInTheDocument();
    expect(screen.queryByTestId("kitchen-column-SENT")).toBeNull();
  });

  it("offers the screen's own stations to choose from when it shows more than one", async () => {
    const onChange = vi.fn();
    renderBoard({
      stationFilter: {
        options: [
          { value: "ALL", label: "All stations" },
          { value: "GRILL", label: "Grill" },
          { value: "BAR", label: "Bar" },
        ],
        value: "ALL",
        onChange,
      },
    });
    await userEvent.click(screen.getByRole("radio", { name: "Grill" }));
    expect(onChange).toHaveBeenCalledWith("GRILL");
  });

  it("moves between tickets with the arrow keys: up and down in a column, left and right across", () => {
    renderBoard({
      tickets: [ticket("a1", "SENT", MINUTE), ticket("a2", "SENT", MINUTE), ticket("b1", "PREPARING", MINUTE)],
    });
    screen.getByTestId("kitchen-next-a1").focus();
    // The key moves focus instead of scrolling the column.
    expect(fireEvent.keyDown(screen.getByTestId("kitchen-next-a1"), { key: "ArrowDown" })).toBe(false);
    expect(screen.getByTestId("kitchen-next-a2")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("kitchen-next-a2"), { key: "ArrowRight" });
    expect(screen.getByTestId("kitchen-next-b1")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("kitchen-next-b1"), { key: "ArrowRight" });
    expect(screen.getByTestId("kitchen-next-b1")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("kitchen-next-b1"), { key: "ArrowLeft" });
    expect(screen.getByTestId("kitchen-next-a1")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("kitchen-next-a1"), { key: "ArrowUp" });
    expect(screen.getByTestId("kitchen-next-a1")).toHaveFocus();
  });

  it("does nothing with an arrow key that doesn't come from a ticket's step", () => {
    renderBoard({ tickets: [ticket("a1", "SENT", MINUTE)] });
    screen.getByTestId("kitchen-next-a1").focus();
    expect(fireEvent.keyDown(screen.getByTestId("kitchen-column-SENT"), { key: "ArrowDown" })).toBe(true);
    expect(screen.getByTestId("kitchen-next-a1")).toHaveFocus();
  });

  it("leaves Space and Enter to press the focused step", async () => {
    const { onNextStep } = renderBoard({ tickets: [ticket("a1", "SENT", MINUTE)] });
    screen.getByTestId("kitchen-next-a1").focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    expect(onNextStep).toHaveBeenCalledTimes(2);
  });
});

describe("KitchenBoard: what staff say about an item (S16-B4)", () => {
  it("says an item's tags on its ticket, and nothing for an item with none", () => {
    const tagged = ticket("a1", "SENT", MINUTE, { items: [line("a1-1", "Satay", 1), line("a1-2", "Chips", 1)] });
    renderBoard({ tickets: [tagged], tagsOf: (productId) => (productId === "p-a1-1" ? "Contains nuts · Spicy" : undefined) });
    const card = screen.getByTestId("kitchen-ticket-a1");
    const tags = within(card).getAllByTestId("kitchen-tags");
    expect(tags).toHaveLength(1);
    expect(tags[0]).toHaveTextContent("Contains nuts · Spicy");
    expect(tags[0].closest("li")).toHaveTextContent("Satay");
  });
});
