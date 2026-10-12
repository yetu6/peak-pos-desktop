import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CashMovementDialog } from "./CashMovementDialog";

const { recordMutate, record, sessionRef } = vi.hoisted(() => ({
  recordMutate: vi.fn((_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()),
  record: { error: null as unknown, isPending: false },
  sessionRef: { value: null as null | { session: { staffId: string }; roster: Array<{ fullName: string; staffNumber: string }> } },
}));

vi.mock("../hooks/usePosData", () => ({
  useRecordCashMovement: () => ({ mutate: recordMutate, isPending: record.isPending, error: record.error }),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSessionOptional: () => sessionRef.value,
}));

const ROSTER = [
  { fullName: "Amina Hassan", staffNumber: "staff-amina" },
  { fullName: "Grace Mushi", staffNumber: "staff-grace" },
];

async function typePin(digits: string) {
  for (const digit of digits) await userEvent.click(screen.getByTestId(`movement-pin-key-${digit}`));
}

beforeEach(() => {
  recordMutate.mockClear();
  record.error = null;
  record.isPending = false;
  sessionRef.value = null;
});

describe("CashMovementDialog", () => {
  it("defaults to cash in and requires a positive amount and a reason", async () => {
    const onClose = vi.fn();
    render(<CashMovementDialog shiftId="shift-1" currency="TZS" onClose={onClose} />);
    const submit = screen.getByTestId("confirm-movement");
    expect(screen.getByRole("radio", { name: "Cash in" })).toBeChecked();
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
    sessionRef.value = { session: { staffId: "staff-amina" }, roster: ROSTER };
    render(<CashMovementDialog shiftId="shift-1" currency="TZS" onClose={vi.fn()} />);
    await userEvent.click(screen.getByTestId("movement-type-CASH_OUT"));
    await userEvent.type(screen.getByTestId("movement-amount"), "2000");
    await userEvent.type(screen.getByTestId("movement-reason"), "Petty cash");
    const submit = screen.getByTestId("confirm-movement");
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    expect(submit).toBeDisabled();
    await typePin("736251");
    expect(submit).not.toBeDisabled();
    await userEvent.click(submit);
    expect(recordMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        movementType: "CASH_OUT",
        amountMinor: 200_000,
        reason: "Petty cash",
        supervisorStaffId: "staff-grace",
        supervisorPin: "736251",
      }),
      expect.anything(),
    );
  });

  it("cash in asks for no supervisor", async () => {
    render(<CashMovementDialog shiftId="shift-1" currency="TZS" onClose={vi.fn()} />);
    expect(screen.queryByRole("group", { name: "Supervisor PIN" })).toBeNull();
  });

  it("never allows a zero or negative amount to submit", async () => {
    render(<CashMovementDialog shiftId="shift-1" currency="TZS" onClose={vi.fn()} />);
    await userEvent.type(screen.getByTestId("movement-amount"), "0");
    await userEvent.type(screen.getByTestId("movement-reason"), "Test");
    expect(screen.getByTestId("confirm-movement")).toBeDisabled();
  });

  it("says what a cash out is for, in money words, and refuses the person asking as their own supervisor", async () => {
    sessionRef.value = {
      session: { staffId: "staff-amina" },
      roster: [
        { fullName: "Amina Hassan", staffNumber: "staff-amina" },
        { fullName: "Grace Mushi", staffNumber: "staff-grace" },
      ],
    };
    render(<CashMovementDialog shiftId="shift-1" currency="TZS" initialType="CASH_OUT" onClose={vi.fn()} />);
    await userEvent.type(screen.getByTestId("movement-amount"), "20000");
    await userEvent.type(screen.getByTestId("movement-reason"), "Gas delivery");
    expect(screen.getByText("Take TSh 20,000 out of the drawer: Gas delivery")).toBeInTheDocument();
    const own = screen.getByRole("radio", { name: /Amina Hassan/ });
    expect(own).toBeDisabled();
    expect(own).toHaveAccessibleDescription("You can't approve your own request.");
    await userEvent.click(own);
    await typePin("736251");
    expect(screen.getByTestId("confirm-movement")).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    await typePin("736251");
    await userEvent.click(screen.getByTestId("confirm-movement"));
    expect(recordMutate).toHaveBeenCalledWith(
      expect.objectContaining({ movementType: "CASH_OUT", supervisorStaffId: "staff-grace", supervisorPin: "736251" }),
      expect.anything(),
    );
  });

  it("with no staff list, cash out can't be approved and says why", async () => {
    sessionRef.value = { session: { staffId: "staff-amina" }, roster: [] };
    render(<CashMovementDialog shiftId="shift-1" currency="TZS" initialType="CASH_OUT" onClose={vi.fn()} />);
    await userEvent.type(screen.getByTestId("movement-amount"), "20000");
    await userEvent.type(screen.getByTestId("movement-reason"), "Gas delivery");
    expect(screen.queryByRole("textbox", { name: /staff number/i })).not.toBeInTheDocument();
    expect(screen.getByText(/can't show its staff list right now/)).toBeInTheDocument();
    expect(screen.getByTestId("confirm-movement")).toBeDisabled();
  });

  describe("a cash-out approval holds only for what was approved", () => {
    async function approvedCashOut() {
      sessionRef.value = { session: { staffId: "staff-amina" }, roster: ROSTER };
      render(<CashMovementDialog shiftId="shift-1" currency="TZS" initialType="CASH_OUT" onClose={vi.fn()} />);
      await userEvent.type(screen.getByTestId("movement-amount"), "20000");
      await userEvent.type(screen.getByTestId("movement-reason"), "Gas delivery");
      await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
      await typePin("736251");
      expect(screen.getByTestId("confirm-movement")).not.toBeDisabled();
    }

    function expectApprovalCleared() {
      expect(screen.getByRole("radio", { name: /Grace Mushi/ })).not.toBeChecked();
      expect(screen.getByTestId("pin-dots")).toHaveAccessibleName("0 digits entered");
      expect(screen.getByTestId("confirm-movement")).toBeDisabled();
    }

    it("asks again after the amount changes", async () => {
      await approvedCashOut();
      await userEvent.type(screen.getByTestId("movement-amount"), "0");
      expectApprovalCleared();
      await userEvent.click(screen.getByTestId("confirm-movement"));
      expect(recordMutate).not.toHaveBeenCalled();
    });

    it("asks again after the reason changes", async () => {
      await approvedCashOut();
      await userEvent.type(screen.getByTestId("movement-reason"), " and charcoal");
      expectApprovalCleared();
    });

    it("asks again after switching to cash in and back", async () => {
      await approvedCashOut();
      await userEvent.click(screen.getByTestId("movement-type-CASH_IN"));
      await userEvent.click(screen.getByTestId("movement-type-CASH_OUT"));
      expectApprovalCleared();
    });
  });

  it("can't be dismissed while the cash in or out is being recorded", async () => {
    record.isPending = true;
    const onClose = vi.fn();
    render(<CashMovementDialog shiftId="shift-1" currency="TZS" onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("says a refused cash out in words", () => {
    record.error = new Error(
      JSON.stringify({ code: "FORBIDDEN", detail: "Taking cash out of the drawer needs a supervisor's approval: their name and PIN." }),
    );
    render(<CashMovementDialog shiftId="shift-1" currency="TZS" initialType="CASH_OUT" onClose={vi.fn()} />);
    expect(screen.getByTestId("movement-error")).toHaveTextContent(
      "A different supervisor must approve taking cash out. Their PIN wasn't accepted, or they can't approve this.",
    );
  });
});
