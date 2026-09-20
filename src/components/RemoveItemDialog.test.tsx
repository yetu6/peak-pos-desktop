import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RemoveItemDialog } from "./RemoveItemDialog";
import type { POSOrder, POSOrderItem } from "../lib/posContracts";

const { removeItemMutate } = vi.hoisted(() => ({
  removeItemMutate: vi.fn((_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()),
}));

vi.mock("../hooks/usePosData", () => ({
  useRemoveOrderItem: () => ({ mutate: removeItemMutate, isPending: false, error: null }),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  useMutationMessage: () => null,
}));

const ORDER: POSOrder = {
  id: "order-1",
  shiftId: "shift-1",
  orderNumber: "POS-1",
  status: "OPEN",
  serviceType: "DINE_IN",
  initiatedById: "staff-1",
  initiatedByName: "Amina Hassan",
  subtotalMinor: 20_000,
  taxMinor: 4_000,
  totalMinor: 24_000,
  version: 3,
  items: [],
};

const ITEM: POSOrderItem = {
  id: "item-1",
  productId: "product-1",
  name: "Cappuccino",
  quantity: 2,
  unitPriceMinor: 6_500,
  taxMinor: 1_170,
  totalMinor: 14_170,
  status: "ADDED",
};

describe("RemoveItemDialog", () => {
  it("requires a second tap before removing an unsent item, never a single accidental one", async () => {
    const onClose = vi.fn();
    render(<RemoveItemDialog order={ORDER} item={ITEM} onClose={onClose} />);

    const button = screen.getByTestId("confirm-remove-item");
    expect(button).toHaveTextContent("Remove item");
    await userEvent.click(button);
    expect(removeItemMutate).not.toHaveBeenCalled();
    expect(button).toHaveTextContent("Confirm remove");

    await userEvent.click(button);
    expect(removeItemMutate).toHaveBeenCalledWith(
      { orderId: "order-1", itemId: "item-1", version: 3, idempotencyKey: "key-1" },
      expect.anything(),
    );
    expect(onClose).toHaveBeenCalled();
  });
});
