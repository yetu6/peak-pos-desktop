import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CashMovementDialog } from "./CashMovementDialog";

const { recordMutate } = vi.hoisted(() => ({
  recordMutate: vi.fn((_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()),
}));

vi.mock("../hooks/usePosData", () => ({
  useRecordCashMovement: () => ({ mutate: recordMutate, isPending: false, error: null }),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  useMutationMessage: () => null,
}));

describe("CashMovementDialog", () => {
  it("defaults to cash in and requires a positive amount and a reason", async () => {
    const onClose = vi.fn();
    render(<CashMovementDialog shiftId="shift-1" onClose={onClose} />);

    const submit = screen.getByTestId("confirm-movement");
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByTestId("movement-amount"), "5000");
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByTestId("movement-reason"), "Change float top-up");
    expect(submit).not.toBeDisabled();

    await userEvent.click(submit);
    expect(recordMutate).toHaveBeenCalledWith(
      { movementType: "CASH_IN", amountMinor: 500_000, reason: "Change float top-up", idempotencyKey: "key-1" },
      expect.anything(),
    );
    expect(onClose).toHaveBeenCalled();
  });

  // Money audit, 2026-10-06: cash leaves the drawer only with a different
  // supervisor's approval, as the server requires.
  it("cash out needs a supervisor and their PIN, and sends them", async () => {
    render(<CashMovementDialog shiftId="shift-1" onClose={vi.fn()} />);

    await userEvent.click(screen.getByTestId("movement-type-CASH_OUT"));
    await userEvent.type(screen.getByTestId("movement-amount"), "2000");
    await userEvent.type(screen.getByTestId("movement-reason"), "Petty cash");
    const submit = screen.getByTestId("confirm-movement");
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByTestId("movement-supervisor-id"), "sup-7");
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByTestId("movement-supervisor-pin"), "736251");
    expect(submit).not.toBeDisabled();

    await userEvent.click(submit);
    expect(recordMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        movementType: "CASH_OUT",
        amountMinor: 200_000,
        supervisorStaffId: "sup-7",
        supervisorPin: "736251",
      }),
      expect.anything(),
    );
  });

  it("cash in asks for no supervisor", async () => {
    render(<CashMovementDialog shiftId="shift-1" onClose={vi.fn()} />);
    expect(screen.queryByTestId("movement-supervisor-pin")).toBeNull();
  });

  it("never allows a zero or negative amount to submit", async () => {
    render(<CashMovementDialog shiftId="shift-1" onClose={vi.fn()} />);

    await userEvent.type(screen.getByTestId("movement-amount"), "0");
    await userEvent.type(screen.getByTestId("movement-reason"), "Test");
    expect(screen.getByTestId("confirm-movement")).toBeDisabled();
  });
});
