import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render as renderInDom, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { idleLockHeld } from "../lib/idleLock";
import { DiscountDialog } from "./DiscountDialog";
import type { POSOrder } from "../lib/posContracts";
import { giveReason } from "../../tests/reasons";
import { DISCOUNT_REASONS } from "../orders/ordersSettings";

/** The app's query provider, fresh for each render: the approval sheets ask Yetu who may approve (F-249). */
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderInDom(ui, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

const { applyMutate, applyState, applyReset } = vi.hoisted(() => ({
  applyState: { isPending: false, error: null as unknown },
  applyReset: vi.fn(),
  applyMutate: vi.fn(
    (_vars: unknown, opts?: { onSuccess?: (order: unknown) => void; onError?: (error: Error) => void }) => opts?.onSuccess?.({}),
  ),
}));

vi.mock("../hooks/usePosData", () => ({
  useApplyDiscount: () => ({ mutate: applyMutate, isPending: applyState.isPending, error: applyState.error, reset: applyReset }),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSessionOptional: () => ({
    session: { staffId: "staff-amina" },
    roster: [
      { fullName: "Amina Hassan", staffNumber: "staff-amina" },
      { fullName: "Grace Mushi", staffNumber: "staff-grace" },
    ],
  }),
}));

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
  initiatedById: "staff-amina",
  initiatedByName: "Amina Hassan",
  subtotalMinor: 3_400_000,
  discountMinor: 0,
  discountKind: "NONE",
  discountInput: 0,
  taxMinor: 612_000,
  totalMinor: 4_012_000,
  paidMinor: 0,
  remainingMinor: 4_012_000,
  version: 4,
  items: [],
};

async function approveAsGrace() {
  await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
  for (const digit of "736251") await userEvent.click(screen.getByTestId(`discount-pin-key-${digit}`));
}

beforeEach(() => {
  applyMutate.mockClear();
  applyReset.mockClear();
  applyState.isPending = false;
  applyState.error = null;
});

describe("DiscountDialog", () => {
  it("offers the place's discount reasons in one tap, and sends the words tapped", async () => {
    render(<DiscountDialog order={ORDER} currency="TZS" onClose={vi.fn()} onApplied={vi.fn()} />);
    const reasons = within(screen.getByRole("radiogroup", { name: "Reason" }));
    expect(reasons.getAllByRole("radio").map((radio) => radio.textContent)).toEqual([...DISCOUNT_REASONS, "Another reason"]);
    await userEvent.type(screen.getByTestId("discount-value"), "1000");
    await userEvent.click(reasons.getByRole("radio", { name: DISCOUNT_REASONS[2] }));
    await approveAsGrace();
    await userEvent.click(screen.getByTestId("confirm-discount"));
    expect(applyMutate).toHaveBeenCalledWith(expect.objectContaining({ reason: DISCOUNT_REASONS[2] }), expect.anything());
  });

  // F-229: with VAT inside the prices, a discount comes off what the guest pays.
  it("says where the discount comes off: before VAT, or off what the guest pays when the prices include VAT", () => {
    render(<DiscountDialog order={ORDER} currency="TZS" onClose={vi.fn()} onApplied={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Discount" })).toHaveAccessibleDescription(
      "On order 42, before VAT. A different supervisor approves with their PIN.",
    );
    cleanup();
    render(<DiscountDialog order={{ ...ORDER, pricesIncludeTax: true }} currency="TZS" onClose={vi.fn()} onApplied={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Discount" })).toHaveAccessibleDescription(
      "On order 42, off what the guest pays. A different supervisor approves with their PIN.",
    );
  });

  it("takes an amount off with a reason and a different supervisor's PIN", async () => {
    const onApplied = vi.fn();
    render(<DiscountDialog order={ORDER} currency="TZS" onClose={vi.fn()} onApplied={onApplied} />);
    const submit = screen.getByTestId("confirm-discount");
    await userEvent.type(screen.getByTestId("discount-value"), "2000");
    await giveReason("discount-reason", "Regular guest");
    expect(screen.getByText("Take TSh 2,000 off order 42: Regular guest")).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await approveAsGrace();
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(applyMutate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "AMOUNT", value: 200_000, reason: "Regular guest", supervisorStaffId: "staff-grace", supervisorPin: "736251", version: 4 }),
      expect.anything(),
    );
    expect(onApplied).toHaveBeenCalled();
  });

  it("clears a refused PIN (keeping the supervisor), so a wrong PIN isn't sent again", async () => {
    applyMutate.mockImplementationOnce((_vars: unknown, opts?: { onSuccess?: (order: unknown) => void; onError?: (error: Error) => void }) =>
      opts?.onError?.(new Error(JSON.stringify({ code: "FORBIDDEN", detail: "POS permission denied" }))),
    );
    render(<DiscountDialog order={ORDER} currency="TZS" onClose={vi.fn()} onApplied={vi.fn()} />);
    await userEvent.type(screen.getByTestId("discount-value"), "2000");
    await giveReason("discount-reason", "Regular guest");
    await approveAsGrace();
    await userEvent.click(screen.getByTestId("confirm-discount"));
    expect(screen.getByTestId("pin-dots")).toHaveAccessibleName("0 digits entered");
    expect(screen.getByRole("radio", { name: /Grace Mushi/ })).toBeChecked();
    expect(screen.getByTestId("confirm-discount")).toBeDisabled();
    expect(applyMutate).toHaveBeenCalledTimes(1);
  });

  it("sends a percentage as basis points, from 0 up to 100", async () => {
    render(<DiscountDialog order={ORDER} currency="TZS" onClose={vi.fn()} onApplied={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: "Percent" }));
    await userEvent.type(screen.getByTestId("discount-value"), "12.5");
    await giveReason("discount-reason", "Staff meal");
    expect(screen.getByText("Take 12.5% off order 42: Staff meal")).toBeInTheDocument();
    await approveAsGrace();
    await userEvent.click(screen.getByTestId("confirm-discount"));
    expect(applyMutate).toHaveBeenCalledWith(expect.objectContaining({ kind: "PERCENT", value: 1250 }), expect.anything());
  });

  it("refuses more than 100 percent, even with a reason and an approval", async () => {
    render(<DiscountDialog order={ORDER} currency="TZS" onClose={vi.fn()} onApplied={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: "Percent" }));
    await userEvent.type(screen.getByTestId("discount-value"), "120");
    await giveReason("discount-reason", "Staff meal");
    await approveAsGrace();
    expect(screen.getByTestId("confirm-discount")).toBeDisabled();
  });

  it("takes a percentage to two decimals at most, sending exactly what was typed", async () => {
    render(<DiscountDialog order={ORDER} currency="TZS" onClose={vi.fn()} onApplied={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: "Percent" }));
    await userEvent.type(screen.getByTestId("discount-value"), "12.345");
    await giveReason("discount-reason", "Staff meal");
    await approveAsGrace();
    expect(screen.getByTestId("confirm-discount")).toBeDisabled();
    expect(screen.getByText("Up to two decimals, for example 12.5.")).toBeInTheDocument();
    await userEvent.clear(screen.getByTestId("discount-value"));
    await userEvent.type(screen.getByTestId("discount-value"), "12.34");
    await approveAsGrace();
    await userEvent.click(screen.getByTestId("confirm-discount"));
    expect(applyMutate).toHaveBeenCalledWith(expect.objectContaining({ kind: "PERCENT", value: 1234 }), expect.anything());
  });

  it("needs a reason, even with an amount and an approval", async () => {
    render(<DiscountDialog order={ORDER} currency="TZS" onClose={vi.fn()} onApplied={vi.fn()} />);
    await userEvent.type(screen.getByTestId("discount-value"), "2000");
    await approveAsGrace();
    expect(screen.getByTestId("confirm-discount")).toBeDisabled();
  });

  it("asks again when the amount, kind or reason changes after approval", async () => {
    render(<DiscountDialog order={ORDER} currency="TZS" onClose={vi.fn()} onApplied={vi.fn()} />);
    await userEvent.type(screen.getByTestId("discount-value"), "2000");
    await giveReason("discount-reason", "Regular guest");
    await approveAsGrace();
    await userEvent.type(screen.getByTestId("discount-value"), "0");
    expect(screen.getByRole("radio", { name: /Grace Mushi/ })).not.toBeChecked();
    expect(screen.getByTestId("confirm-discount")).toBeDisabled();
    await approveAsGrace();
    await giveReason("discount-reason", "!");
    expect(screen.getByTestId("confirm-discount")).toBeDisabled();
    await approveAsGrace();
    await userEvent.click(screen.getByRole("radio", { name: "Percent" }));
    expect(screen.getByRole("radio", { name: /Grace Mushi/ })).not.toBeChecked();
  });

  it("keeps the till from locking while the discount is with Yetu", () => {
    applyState.isPending = true;
    render(<DiscountDialog order={ORDER} currency="TZS" onClose={vi.fn()} onApplied={vi.fn()} />);
    expect(idleLockHeld()).toBe(true);
  });
});

describe("DiscountDialog after too many attempts (429)", () => {
  it("says so and holds the next attempt until Yetu's wait is over", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    applyState.error = new Error(JSON.stringify({ type: "about:blank", title: "Too many requests.", status: 429, code: "RATE_LIMITED", detail: "Too many requests. Try again in 41 seconds.", request_id: "req-9", retryAfterSeconds: 41 }));
    render(<DiscountDialog order={ORDER} currency="TZS" onClose={vi.fn()} onApplied={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts. Wait a minute and try again.");
    await userEvent.type(screen.getByTestId("discount-value"), "2000");
    await giveReason("discount-reason", "Regular guest");
    await approveAsGrace();
    expect(screen.getByTestId("confirm-discount")).toBeDisabled();
    try {
      act(() => vi.advanceTimersByTime(41_000));
      expect(applyReset).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
