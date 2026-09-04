import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Manager } from "./Manager";
import type { POSShift } from "../lib/posContracts";

const { closeBusinessDayMutate, permissionsRef, capabilitiesRef, shiftRef, currencyRef, movementsRef } = vi.hoisted(() => ({
  closeBusinessDayMutate: vi.fn(),
  permissionsRef: { permissions: [] as string[] },
  capabilitiesRef: { capabilities: [] as string[] },
  shiftRef: { shift: undefined as POSShift | undefined },
  currencyRef: { currency: "TZS" as string | undefined },
  movementsRef: { data: [] as Array<{ id: string; movementType: "CASH_IN" | "CASH_OUT"; amountMinor: number; reason: string }> },
}));

vi.mock("../hooks/usePosData", () => ({
  usePosShift: () => ({ shift: shiftRef.shift }),
  useCashMovements: () => movementsRef,
  useCatalogCurrency: () => currencyRef.currency,
  useCloseBusinessDay: () => ({ mutate: closeBusinessDayMutate, isPending: false, error: null, data: undefined }),
  useHasPermission: (action: string) => permissionsRef.permissions.includes(action),
  useHasCapability: (code: string) => capabilitiesRef.capabilities.includes(code),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  useMutationMessage: () => null,
}));

vi.mock("../components/CashMovementDialog", () => ({
  CashMovementDialog: () => <div data-testid="cash-movement-dialog-stub" />,
}));

const SHIFT: POSShift = {
  id: "shift-1",
  status: "OPEN",
  openingCashMinor: 50_000,
  expectedCashMinor: 74_000,
  businessDate: "2026-09-04",
  openedAt: "2026-09-04T06:00:00Z",
};

describe("Manager", () => {
  afterEach(() => {
    currencyRef.currency = "TZS";
    movementsRef.data = [];
  });

  it("hides cash movements and day close from a cashier with neither grant", () => {
    permissionsRef.permissions = [];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    render(<Manager />);

    expect(screen.getByTestId("cash-movement-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("open-cash-movement")).not.toBeInTheDocument();
    expect(screen.queryByTestId("close-business-day")).not.toBeInTheDocument();
  });

  it("offers cash movements to a staff member who holds pos.cash_movement.record", async () => {
    permissionsRef.permissions = ["pos.cash_movement.record"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    render(<Manager />);

    const open = screen.getByTestId("open-cash-movement");
    expect(open).not.toBeDisabled();
    await userEvent.click(open);
    expect(screen.getByTestId("cash-movement-dialog-stub")).toBeInTheDocument();
  });

  it("lists a non-TZS outlet's cash movements in its own currency, never a hardcoded TZS", () => {
    permissionsRef.permissions = ["pos.cash_movement.record"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    currencyRef.currency = "KES";
    movementsRef.data = [{ id: "m1", movementType: "CASH_IN", amountMinor: 500_000, reason: "Float top-up" }];
    render(<Manager />);

    const list = screen.getByTestId("cash-movement-list");
    expect(list).toHaveTextContent("KES");
    expect(list).not.toHaveTextContent("TZS");
  });

  it("offers POS day close only with pos.report.manager and no active LODGING capability", () => {
    permissionsRef.permissions = ["pos.report.manager"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    render(<Manager />);

    expect(screen.getByTestId("close-business-day")).toBeInTheDocument();
  });

  it("hides POS day close outright on a hybrid LODGING property even with pos.report.manager", () => {
    permissionsRef.permissions = ["pos.report.manager"];
    capabilitiesRef.capabilities = ["LODGING"];
    shiftRef.shift = SHIFT;
    render(<Manager />);

    expect(screen.queryByTestId("close-business-day")).not.toBeInTheDocument();
  });

  it("disables cash-movement entry with no open shift instead of a dead dialog", () => {
    permissionsRef.permissions = ["pos.cash_movement.record"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = undefined;
    render(<Manager />);

    expect(screen.getByTestId("open-cash-movement")).toBeDisabled();
  });
});
