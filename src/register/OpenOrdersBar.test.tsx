import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { POSOrder } from "../lib/posContracts";
import { OpenOrdersBar } from "./OpenOrdersBar";

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
      "Table 92 Soda · 14:05 · TSh 12,000",
      "Mama Neema2 Soda · 14:05 · TSh 12,000",
      "Order 92 Soda · 14:05 · TSh 12,000",
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

  it("with nothing open, there is no bar; with an empty ticket, New waits", () => {
    renderBar({ orders: [order("o5", { status: "CLOSED" })], current: null });
    expect(screen.queryByRole("navigation", { name: "Open orders" })).toBeNull();
  });
});
