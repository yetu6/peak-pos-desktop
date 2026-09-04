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

  it("switches to cash out when selected", async () => {
    render(<CashMovementDialog shiftId="shift-1" onClose={vi.fn()} />);

    await userEvent.click(screen.getByTestId("movement-type-CASH_OUT"));
    await userEvent.type(screen.getByTestId("movement-amount"), "2000");
    await userEvent.type(screen.getByTestId("movement-reason"), "Petty cash");
    await userEvent.click(screen.getByTestId("confirm-movement"));

    expect(recordMutate).toHaveBeenCalledWith(
      expect.objectContaining({ movementType: "CASH_OUT" }),
      expect.anything(),
    );
  });

  it("never allows a zero or negative amount to submit", async () => {
    render(<CashMovementDialog shiftId="shift-1" onClose={vi.fn()} />);

    await userEvent.type(screen.getByTestId("movement-amount"), "0");
    await userEvent.type(screen.getByTestId("movement-reason"), "Test");
    expect(screen.getByTestId("confirm-movement")).toBeDisabled();
  });
});
