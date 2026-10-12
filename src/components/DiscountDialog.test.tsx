import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscountDialog } from "./DiscountDialog";
import type { POSOrder } from "../lib/posContracts";

const { applyMutate } = vi.hoisted(() => ({
  applyMutate: vi.fn(
    (_vars: unknown, opts?: { onSuccess?: (order: unknown) => void; onError?: (error: Error) => void }) => opts?.onSuccess?.({}),
  ),
}));

vi.mock("../hooks/usePosData", () => ({
  useApplyDiscount: () => ({ mutate: applyMutate, isPending: false, error: null }),
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

beforeEach(() => applyMutate.mockClear());

describe("DiscountDialog", () => {
  it("takes an amount off with a reason and a different supervisor's PIN", async () => {
    const onApplied = vi.fn();
    render(<DiscountDialog order={ORDER} currency="TZS" onClose={vi.fn()} onApplied={onApplied} />);
    const submit = screen.getByTestId("confirm-discount");
    await userEvent.type(screen.getByTestId("discount-value"), "2000");
    await userEvent.type(screen.getByTestId("discount-reason"), "Regular guest");
    expect(screen.getByText("Take TSh 2,000 off order 0142: Regular guest")).toBeInTheDocument();
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
    await userEvent.type(screen.getByTestId("discount-reason"), "Regular guest");
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
    await userEvent.type(screen.getByTestId("discount-reason"), "Staff meal");
    expect(screen.getByText("Take 12.5% off order 0142: Staff meal")).toBeInTheDocument();
    await approveAsGrace();
    await userEvent.click(screen.getByTestId("confirm-discount"));
    expect(applyMutate).toHaveBeenCalledWith(expect.objectContaining({ kind: "PERCENT", value: 1250 }), expect.anything());
  });

  it("refuses more than 100 percent, even with a reason and an approval", async () => {
    render(<DiscountDialog order={ORDER} currency="TZS" onClose={vi.fn()} onApplied={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: "Percent" }));
    await userEvent.type(screen.getByTestId("discount-value"), "120");
    await userEvent.type(screen.getByTestId("discount-reason"), "Staff meal");
    await approveAsGrace();
    expect(screen.getByTestId("confirm-discount")).toBeDisabled();
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
    await userEvent.type(screen.getByTestId("discount-reason"), "Regular guest");
    await approveAsGrace();
    await userEvent.type(screen.getByTestId("discount-value"), "0");
    expect(screen.getByRole("radio", { name: /Grace Mushi/ })).not.toBeChecked();
    expect(screen.getByTestId("confirm-discount")).toBeDisabled();
    await approveAsGrace();
    await userEvent.type(screen.getByTestId("discount-reason"), "!");
    expect(screen.getByTestId("confirm-discount")).toBeDisabled();
    await approveAsGrace();
    await userEvent.click(screen.getByRole("radio", { name: "Percent" }));
    expect(screen.getByRole("radio", { name: /Grace Mushi/ })).not.toBeChecked();
  });
});
