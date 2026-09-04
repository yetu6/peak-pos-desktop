import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoidOrderDialog } from "./VoidOrderDialog";
import type { POSOrder } from "../lib/posContracts";

const { voidOrderMutate, rosterRef } = vi.hoisted(() => ({
  voidOrderMutate: vi.fn((_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()),
  rosterRef: { roster: [] as Array<{ fullName: string; staffNumber: string }> },
}));

vi.mock("../hooks/usePosData", () => ({
  useVoidOrder: () => ({ mutate: voidOrderMutate, isPending: false, error: null }),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  useMutationMessage: () => null,
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSessionOptional: () => ({ roster: rosterRef.roster }),
}));

const ORDER: POSOrder = {
  id: "order-1",
  shiftId: "shift-1",
  orderNumber: "POS-1",
  status: "SENT",
  serviceType: "DINE_IN",
  subtotalMinor: 20_000,
  taxMinor: 4_000,
  totalMinor: 24_000,
  version: 4,
  items: [],
};

describe("VoidOrderDialog", () => {
  it("requires a different supervisor's own 6-digit PIN and a reason before voiding", async () => {
    rosterRef.roster = [];
    render(<VoidOrderDialog order={ORDER} onClose={vi.fn()} />);

    const submit = screen.getByTestId("confirm-void-order");
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByTestId("void-supervisor-id"), "00099");
    await userEvent.type(screen.getByTestId("void-supervisor-pin"), "12345"); // 5 digits, too short
    await userEvent.type(screen.getByTestId("void-reason"), "Wrong table");
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByTestId("void-supervisor-pin"), "6");
    expect(submit).not.toBeDisabled();

    await userEvent.click(submit);
    expect(voidOrderMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        supervisorStaffId: "00099",
        supervisorPin: "123456",
        reason: "Wrong table",
        version: 4,
      }),
      expect.anything(),
    );
  });

  it("offers a roster picker instead of free text when the device roster is known", () => {
    rosterRef.roster = [{ fullName: "Grace Mushi", staffNumber: "00002" }];
    render(<VoidOrderDialog order={ORDER} onClose={vi.fn()} />);

    expect(screen.getByTestId("void-supervisor-select")).toBeInTheDocument();
    expect(screen.queryByTestId("void-supervisor-id")).not.toBeInTheDocument();
  });
});
