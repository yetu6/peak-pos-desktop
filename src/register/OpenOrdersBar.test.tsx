import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { POSOrder } from "../lib/posContracts";
import { OpenOrdersBar, visibleChips } from "./OpenOrdersBar";

function order(id: string, over: Partial<POSOrder> = {}): POSOrder {
  return {
    id, shiftId: "s", orderNumber: id, dailyNumber: Number(id.replace(/\D/g, "")) || 1, createdAt: new Date(2026, 9, 21, 14, 5).toISOString(),
    closedAt: null, payments: [], status: "OPEN", serviceType: "DINE_IN", initiatedById: "amina", initiatedByName: "Amina",
    subtotalMinor: 0, discountMinor: 0, discountKind: "NONE", discountInput: 0, taxMinor: 0, totalMinor: 1_200_000,
    paidMinor: 0, remainingMinor: 1_200_000, version: 1,
    items: [{ id: "l", productId: "p", name: "Soda", quantity: 2, unitPriceMinor: 1, taxMinor: 0, totalMinor: 1, status: "ADDED" }],
    ...over,
  } as POSOrder;
}

function renderBar(props: Partial<Parameters<typeof OpenOrdersBar>[0]> = {}) {
  const onPick = vi.fn();
  const onNew = vi.fn();
  render(
    <OpenOrdersBar
      orders={[order("o7", { tableLabel: "9" }), order("o8", { tableLabel: "Mama Neema" }), order("o9")]}
      current={order("o7", { tableLabel: "9" })}
      staffId="amina"
      currency="TZS"
      onPick={onPick}
      onNew={onNew}
      {...props}
    />,
  );
  return { onPick, onNew };
}

describe("OpenOrdersBar (owner, 2026-10-21)", () => {
  it("shows each open order as the waiter knows it, the one on the ticket pressed", () => {
    renderBar();
    const bar = screen.getByRole("navigation", { name: "Open orders" });
    const chips = within(bar).getAllByRole("button").filter((button) => button.dataset.testid?.startsWith("open-order-"));
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Table 9TSh 12,00014:05 · 2 Soda",
      "Mama NeemaTSh 12,00014:05 · 2 Soda",
      "Order 9TSh 12,00014:05 · 2 Soda",
    ]);
    expect(chips[0]).toHaveAttribute("aria-pressed", "true");
    expect(chips[1]).toHaveAttribute("aria-pressed", "false");
  });

  it("one tap moves the ticket to another order; New starts one", async () => {
    const { onPick, onNew } = renderBar();
    await userEvent.click(screen.getByTestId("open-order-o8"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "o8" }));
    await userEvent.click(screen.getByTestId("open-order-o7"));
    expect(onPick).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("open-orders-new"));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("stays where it is while the ticket is busy with Yetu", () => {
    renderBar({ disabled: true });
    expect(screen.getByTestId("open-order-o8")).toBeDisabled();
    expect(screen.getByTestId("open-orders-new")).toBeDisabled();
  });

  it("shows the order on the ticket before the list has caught up with it", () => {
    renderBar({ orders: [order("o8")], current: order("o12") });
    expect(screen.getByTestId("open-order-o12")).toHaveAttribute("aria-pressed", "true");
  });

  it("each chip reads its name and amount first, then when it started and what is on it", () => {
    renderBar();
    const chip = screen.getByTestId("open-order-o8");
    expect(within(chip).getByText("Mama Neema")).toHaveClass("y-open-orders__name");
    expect(within(chip).getByText("TSh 12,000")).toHaveClass("y-open-orders__amount");
    expect(within(chip).getByText("14:05 · 2 Soda")).toHaveClass("y-open-orders__meta");
  });

  it("All opens every open order in full; one tap moves the ticket there, Back leaves it", async () => {
    const { onPick } = renderBar({
      orders: [
        order("o7", { tableLabel: "9" }),
        order("o8", { tableLabel: "Mama Neema", initiatedById: "juma", initiatedByName: "Juma Ally" }),
        order("o9", { totalMinor: 4_750_000 }),
      ],
    });
    const all = screen.getByRole("button", { name: "All 3 open orders" });
    expect(all).toHaveTextContent("All 3");
    await userEvent.click(all);
    const sheet = screen.getByRole("dialog", { name: "Open orders" });
    const rows = within(sheet).getAllByRole("button").filter((row) => row.dataset.testid?.startsWith("open-order-row-"));
    // The waiter's own orders first, each in full: what is on it, when, how much, who took it.
    expect(rows.map((row) => row.dataset.testid)).toEqual(["open-order-row-o7", "open-order-row-o9", "open-order-row-o8"]);
    expect(rows[0]).toHaveTextContent("On the ticket");
    expect(rows[1]).toHaveTextContent("Order 9");
    expect(rows[1]).toHaveTextContent("TSh 47,500");
    expect(rows[2]).toHaveTextContent("2 Soda");
    expect(rows[2]).toHaveTextContent("14:05");
    expect(rows[2]).toHaveTextContent("Taken by Juma Ally");
    await userEvent.click(within(sheet).getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog", { name: "Open orders" })).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    await userEvent.click(all);
    await userEvent.click(screen.getByTestId("open-order-row-o9"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "o9" }));
    expect(screen.queryByRole("dialog", { name: "Open orders" })).toBeNull();
  });

  it("draws only the chips that fit, and the order on the ticket is always one of them", () => {
    const six = ["o1", "o2", "o3", "o4", "o5", "o6"].map((id) => order(id));
    expect(visibleChips(six, six[1], 3).map((o) => o.id)).toEqual(["o1", "o2", "o3"]);
    expect(visibleChips(six, six[5], 3).map((o) => o.id)).toEqual(["o1", "o2", "o6"]);
    expect(visibleChips(six, null, 2).map((o) => o.id)).toEqual(["o1", "o2"]);
  });

  it("with nothing open, there is no bar; with an empty ticket, New waits", () => {
    renderBar({ orders: [order("o5", { status: "CLOSED" })], current: null });
    expect(screen.queryByRole("navigation", { name: "Open orders" })).toBeNull();
  });
});
