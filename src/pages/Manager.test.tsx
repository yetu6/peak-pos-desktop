import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Manager } from "./Manager";
import type { POSShift } from "../lib/posContracts";

const { closeBusinessDayMutate, permissionsRef, capabilitiesRef, shiftRef, currencyRef, movementsRef } = vi.hoisted(() => ({
  closeBusinessDayMutate: vi.fn(),
  permissionsRef: { permissions: [] as string[] },
  capabilitiesRef: { capabilities: [] as string[] },
  shiftRef: { shift: undefined as POSShift | undefined },
  currencyRef: { currency: "TZS" as string | undefined },
  movementsRef: {
    data: [] as Array<{
      id: string;
      movementType: "CASH_IN" | "CASH_OUT";
      amountMinor: number;
      reason: string;
      recordedBy?: string;
      createdAt?: string;
    }>,
  },
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

vi.mock("../hooks/usePosData", () => ({
  usePosShift: () => ({ shift: shiftRef.shift, close: { mutateAsync: vi.fn(), isPending: false } }),
  useCashMovements: () => movementsRef,
  useCatalogCurrency: () => currencyRef.currency,
  useCloseBusinessDay: () => ({ mutate: closeBusinessDayMutate, isPending: false, error: null, data: undefined }),
  useHasPermission: (action: string) => permissionsRef.permissions.includes(action),
  useHasCapability: (code: string) => capabilitiesRef.capabilities.includes(code),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  useOpenTabsOf: () => ({ count: 0, owedMinor: 0 }),
  useMutationMessage: () => null,
}));

vi.mock("../components/CashMovementDialog", () => ({
  CashMovementDialog: ({ initialType }: { initialType?: string }) => (
    <div data-testid="cash-movement-dialog-stub" data-type={initialType} />
  ),
}));

function renderCash() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Manager />
    </QueryClientProvider>,
  );
}

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
    renderCash();

    expect(screen.getByTestId("cash-movement-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("open-cash-movement")).not.toBeInTheDocument();
    expect(screen.queryByTestId("close-business-day")).not.toBeInTheDocument();
  });

  it("offers cash movements to a staff member who holds pos.cash_movement.record", async () => {
    permissionsRef.permissions = ["pos.cash_movement.record"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    renderCash();

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
    renderCash();

    const list = screen.getByTestId("cash-movement-list");
    expect(list).toHaveTextContent("KES");
    expect(list).not.toHaveTextContent("TZS");
  });

  it("offers POS day close only with pos.report.manager and no active LODGING capability", () => {
    permissionsRef.permissions = ["pos.report.manager"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    renderCash();

    expect(screen.getByTestId("close-business-day")).toBeInTheDocument();
  });

  it("hides POS day close outright on a hybrid LODGING property even with pos.report.manager", () => {
    permissionsRef.permissions = ["pos.report.manager"];
    capabilitiesRef.capabilities = ["LODGING"];
    shiftRef.shift = SHIFT;
    renderCash();

    expect(screen.queryByTestId("close-business-day")).not.toBeInTheDocument();
  });

  it("disables cash-movement entry with no open shift instead of a dead dialog", () => {
    permissionsRef.permissions = ["pos.cash_movement.record"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = undefined;
    renderCash();

    expect(screen.getByTestId("open-cash-movement")).toBeDisabled();
  });

  it("sums up the drawer for a manager with only the figures Yetu works out, each explained", () => {
    permissionsRef.permissions = ["pos.cash_movement.record", "pos.shift.close", "pos.report.manager"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    renderCash();
    const summary = screen.getByTestId("cash-summary");
    expect(summary).toHaveTextContent("Float at the start");
    expect(summary).toHaveTextContent("TSh 500");
    expect(summary).toHaveTextContent("Expected in the drawer now");
    expect(summary).toHaveTextContent("TSh 740");
    expect(summary).toHaveTextContent("Float, plus cash sales and cash in, less cash out, worked out by Yetu.");
    expect(summary.querySelectorAll(".y-money")).toHaveLength(2);
  });

  it("keeps the count blind for a cashier: the float, never the expected figure", () => {
    permissionsRef.permissions = ["pos.cash_movement.record", "pos.shift.close"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    renderCash();
    const summary = screen.getByTestId("cash-summary");
    expect(summary).toHaveTextContent("Float at the start");
    expect(summary.querySelectorAll(".y-money")).toHaveLength(1);
    expect(document.body).not.toHaveTextContent("TSh 740");
    expect(document.body).not.toHaveTextContent(/expected in the drawer/i);
    expect(screen.getByText("Count the drawer. Yetu then compares your count with its own figure; if they differ, a manager approves.")).toBeInTheDocument();
  });

  it("lists each cash movement with its reason, who and when, never an id", () => {
    permissionsRef.permissions = ["pos.cash_movement.record"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    movementsRef.data = [
      { id: "m1", movementType: "CASH_OUT", amountMinor: 2_000_000, reason: "Gas delivery", recordedBy: "staff-grace", createdAt: new Date(2026, 8, 4, 11, 5).toISOString() },
      { id: "m2", movementType: "CASH_IN", amountMinor: 500_000, reason: "Float top-up", recordedBy: "unknown-id-123", createdAt: new Date(2026, 8, 4, 9, 30).toISOString() },
    ];
    renderCash();
    const list = screen.getByTestId("cash-movement-list");
    expect(list).toHaveTextContent("Cash out");
    expect(list).toHaveTextContent("Gas delivery · Grace Mushi · 11:05");
    expect(list).toHaveTextContent("Float top-up · 09:30");
    expect(list).not.toHaveTextContent("unknown-id-123");
  });

  it("opens Cash out straight onto cash out", async () => {
    permissionsRef.permissions = ["pos.cash_movement.record"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    renderCash();
    await userEvent.click(screen.getByTestId("open-cash-out"));
    expect(screen.getByTestId("cash-movement-dialog-stub")).toHaveAttribute("data-type", "CASH_OUT");
  });

  it("starts closing the shift from Cash", async () => {
    permissionsRef.permissions = ["pos.shift.close"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    renderCash();
    await userEvent.click(screen.getByTestId("open-close-shift"));
    expect(screen.getByRole("dialog", { name: "Close the shift" })).toBeInTheDocument();
  });

  it("says in words who can close the shift and record cash, instead of hiding it", () => {
    permissionsRef.permissions = [];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    renderCash();
    expect(screen.getByTestId("close-shift-unavailable")).toHaveTextContent(
      "Only a cashier or manager can close the shift. Ask one to close it.",
    );
    expect(screen.getByTestId("cash-movement-unavailable")).toHaveTextContent(
      "Only a cashier or manager can put cash in or take it out. Ask one to help.",
    );
  });

  it("shows Close the day but holds it until this till's shift is closed", () => {
    permissionsRef.permissions = ["pos.report.manager"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    renderCash();
    expect(screen.getByTestId("close-business-day")).toBeDisabled();
    expect(screen.getByTestId("close-day")).toHaveTextContent("Close this till's shift first.");
  });
});

