import { beforeEach, describe, expect, it, vi } from "vitest";
import { render as renderInDom, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { VoidItemDialog } from "./VoidItemDialog";
import type { POSOrder, POSOrderItem } from "../lib/posContracts";
import { giveReason } from "../../tests/reasons";

vi.mock("../fnb/useTillReasons", async () => {
  const { VOID_REASONS } = await import("../orders/ordersSettings");
  return { useTillReasons: () => VOID_REASONS };
});

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderInDom(ui, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

const { voidItemMutate, voidState, printAfter, answered } = vi.hoisted(() => ({
  answered: { order: null as unknown },
  voidItemMutate: vi.fn(),
  voidState: { error: null as unknown, isPending: false },
  printAfter: vi.fn(async (_orderId: string) => [{ ok: true }] as Array<{ ok: boolean; error?: string; jobType?: string }>),
}));

vi.mock("../hooks/usePosData", () => ({
  useVoidItem: () => ({ mutate: voidItemMutate, reset: vi.fn(), ...voidState }),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  usePropertyId: () => "prop-1",
  usePrintAfter: () => printAfter,
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSessionOptional: () => ({
    session: { staffId: "staff-baraka" },
    roster: [
      { fullName: "Baraka Mushi", staffNumber: "staff-baraka" },
      { fullName: "Neema Kweka", staffNumber: "staff-neema" },
    ],
  }),
}));

const TUSKER: POSOrderItem = {
  id: "line-tusker",
  productId: "p-tusker",
  name: "Tusker",
  quantity: 3,
  unitPriceMinor: 500_000,
  taxMinor: 228_814,
  totalMinor: 1_500_000,
  status: "SENT",
  prepStation: "BAR",
  roundNumber: 1,
};

const ORDER: POSOrder = {
  id: "order-1",
  shiftId: "shift-1",
  orderNumber: "POS-MAIN-261021-7",
  dailyNumber: 7,
  createdAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  closedAt: null,
  payments: [],
  status: "SENT",
  serviceType: "DINE_IN",
  initiatedById: "staff-baraka",
  initiatedByName: "Baraka Mushi",
  subtotalMinor: 1_271_186,
  discountMinor: 0,
  discountKind: "NONE",
  discountInput: 0,
  taxMinor: 228_814,
  totalMinor: 1_500_000,
  paidMinor: 0,
  remainingMinor: 1_500_000,
  version: 5,
  items: [TUSKER],
};

async function approve() {
  await userEvent.click(screen.getByRole("radio", { name: /Neema Kweka/ }));
  for (const digit of "123456") await userEvent.click(screen.getByTestId(`void-item-pin-key-${digit}`));
}

beforeEach(() => {
  voidItemMutate.mockReset();
  voidItemMutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: (order: unknown) => void }) => opts?.onSuccess?.(answered.order));
  answered.order = { ...ORDER, version: 6 };
  printAfter.mockClear();
  voidState.error = null;
  voidState.isPending = false;
});

describe("VoidItemDialog (the owner, 2026-10-21)", () => {
  it("voids some of a line: how many, why, and a different supervisor's PIN", async () => {
    const onVoided = vi.fn();
    render(<VoidItemDialog order={ORDER} line={TUSKER} currency="TZS" onClose={vi.fn()} onVoided={onVoided} />);
    expect(screen.getByText("Takes it off the order and tells the bar. This is not a refund: no money moves.")).toBeInTheDocument();
    const submit = screen.getByTestId("confirm-void-item");
    expect(submit).toHaveTextContent("Cancel 3 × Tusker");
    // One of the three: the rest stay on the order.
    expect(within(screen.getByTestId("void-item-quantity")).getByText("The order has 3. The rest stay on it.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /fewer|less|decrease|minus/i }));
    await userEvent.click(screen.getByRole("button", { name: /fewer|less|decrease|minus/i }));
    expect(submit).toHaveTextContent("Cancel 1 × Tusker");
    await giveReason("void-item-reason", "Spilled");
    // Not all of it: no money is promised before Yetu says.
    expect(screen.getByText("Cancel 1 × Tusker on order 7: Spilled")).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await approve();
    expect(screen.getByRole("radio", { name: /Baraka Mushi/ })).toBeDisabled();
    await userEvent.click(submit);
    expect(voidItemMutate).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-1", itemId: "line-tusker", quantity: 1, reason: "Spilled", supervisorStaffId: "staff-neema", supervisorPin: "123456", version: 5 }),
      expect.anything(),
    );
    expect(onVoided).toHaveBeenCalledWith(answered.order, "1 × Tusker cancelled. The bar has been told.");
    expect(printAfter).toHaveBeenCalledWith("order-1");
  });

  it("asks again when how many changes after approval", async () => {
    render(<VoidItemDialog order={ORDER} line={TUSKER} currency="TZS" onClose={vi.fn()} onVoided={vi.fn()} />);
    await giveReason("void-item-reason", "Spilled");
    await approve();
    expect(screen.getByTestId("confirm-void-item")).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /fewer|less|decrease|minus/i }));
    expect(screen.getByTestId("confirm-void-item")).toBeDisabled();
  });

  it("asks no how-many for a line of one, and names its money", async () => {
    const one = { ...TUSKER, quantity: 1, totalMinor: 500_000 };
    render(<VoidItemDialog order={ORDER} line={one} currency="TZS" onClose={vi.fn()} onVoided={vi.fn()} />);
    expect(screen.queryByTestId("void-item-quantity")).toBeNull();
    await giveReason("void-item-reason", "Wrong item");
    expect(screen.getByText("Cancel 1 × Tusker on order 7 (TSh 5,000): Wrong item")).toBeInTheDocument();
  });

  it("asks for the order again when Yetu says it changed, and clears a refused PIN", async () => {
    const onStale = vi.fn();
    voidItemMutate.mockImplementationOnce((_vars: unknown, opts?: { onError?: (error: Error) => void }) =>
      opts?.onError?.(new Error(JSON.stringify({ code: "ITEM_NOT_VOIDABLE", detail: "This item is already voided." }))),
    );
    render(<VoidItemDialog order={ORDER} line={TUSKER} currency="TZS" onClose={vi.fn()} onVoided={vi.fn()} onStale={onStale} />);
    await giveReason("void-item-reason", "Spilled");
    await approve();
    await userEvent.click(screen.getByTestId("confirm-void-item"));
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("confirm-void-item")).toBeDisabled();
  });

  it("says when the slip for the bar didn't print", async () => {
    const onPrintProblem = vi.fn();
    printAfter.mockResolvedValueOnce([{ ok: false, error: "The bar printer didn't answer." }]);
    render(<VoidItemDialog order={ORDER} line={TUSKER} currency="TZS" onClose={vi.fn()} onVoided={vi.fn()} onPrintProblem={onPrintProblem} />);
    await giveReason("void-item-reason", "Spilled");
    await approve();
    await userEvent.click(screen.getByTestId("confirm-void-item"));
    await waitFor(() => expect(onPrintProblem).toHaveBeenCalledWith(expect.stringContaining("The cancel slip didn't print")));
  });

  // Review 2026-10-21: a refusal Yetu will always give is said, not reloaded forever.
  it("says what to do instead when Yetu can't void this many, and keeps the sheet", async () => {
    const onStale = vi.fn();
    voidState.error = new Error(JSON.stringify({ code: "ITEM_NOT_VOIDABLE", detail: "This item was added before Yetu kept each item's VAT rate: void all of it." }));
    render(<VoidItemDialog order={ORDER} line={TUSKER} currency="TZS" onClose={vi.fn()} onVoided={vi.fn()} onStale={onStale} />);
    expect(within(screen.getByTestId("void-item-dialog")).getByRole("alert")).toHaveTextContent("void all of it");
    expect(onStale).not.toHaveBeenCalled();
  });

  it("asks the supervisor again when the order changes under the sheet, and never offers more than the line holds now", async () => {
    const view = render(<VoidItemDialog order={ORDER} line={TUSKER} currency="TZS" onClose={vi.fn()} onVoided={vi.fn()} />);
    await giveReason("void-item-reason", "Spilled");
    await approve();
    expect(screen.getByTestId("confirm-void-item")).toBeEnabled();
    // Another till voided some of it: a new version, and the line holds one.
    view.rerender(<VoidItemDialog order={{ ...ORDER, version: ORDER.version + 1 }} line={{ ...TUSKER, quantity: 1 }} currency="TZS" onClose={vi.fn()} onVoided={vi.fn()} />);
    expect(screen.getByTestId("confirm-void-item")).toBeDisabled();
    expect(screen.getByTestId("confirm-void-item")).toHaveTextContent(`Cancel 1 × ${TUSKER.name}`);
  });

  it("reports a failed void slip, never an older paper waiting on the same order", async () => {
    const onPrintProblem = vi.fn();
    printAfter.mockResolvedValueOnce([{ ok: false, error: "The kitchen printer didn't answer.", jobType: "KITCHEN_TICKET" }, { ok: true, jobType: "KITCHEN_VOID" }]);
    render(<VoidItemDialog order={ORDER} line={TUSKER} currency="TZS" onClose={vi.fn()} onVoided={vi.fn()} onPrintProblem={onPrintProblem} />);
    await giveReason("void-item-reason", "Spilled");
    await approve();
    await userEvent.click(screen.getByTestId("confirm-void-item"));
    await waitFor(() => expect(printAfter).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onPrintProblem).not.toHaveBeenCalled();
  });

  it("says a part-paid order's item is refunded instead", () => {
    voidState.error = new Error(JSON.stringify({ code: "INVALID_STATE", detail: "This order has already taken payment." }));
    render(<VoidItemDialog order={ORDER} line={TUSKER} currency="TZS" onClose={vi.fn()} onVoided={vi.fn()} />);
    expect(within(screen.getByTestId("void-item-dialog")).getByRole("alert")).toHaveTextContent(
      "Part of this bill is paid, so items can't be cancelled. Refund it after it's paid.",
    );
  });
});
