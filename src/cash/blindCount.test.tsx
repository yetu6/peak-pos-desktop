import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { POSCashMovement, POSShift } from "../lib/posContracts";
import { Manager } from "../pages/Manager";

/**
 * The count is blind: while a shift is open, a cashier never sees Yetu's
 * expected figure anywhere on the till before they have counted. This renders
 * the places that could show it (the Cash page and the close-shift sheet) in
 * one tree and searches all of it. Sell shows no shift money at all
 * (NewOrder.test).
 */

const { grants } = vi.hoisted(() => ({ grants: { permissions: [] as string[] } }));

const SHIFT: POSShift = {
  id: "shift-1",
  status: "OPEN",
  openingCashMinor: 5_000_000,
  expectedCashMinor: 7_400_000,
  businessDate: "2026-10-12",
  openedAt: "2026-10-12T04:02:00Z",
};

const MOVEMENTS: POSCashMovement[] = [
  {
    id: "m1",
    shiftId: SHIFT.id,
    movementType: "CASH_OUT",
    amountMinor: 2_000_000,
    reason: "Gas delivery",
    recordedBy: "staff-grace",
    createdAt: "2026-10-12T08:05:00Z",
  },
];

vi.mock("../hooks/usePosData", () => ({
  usePosShift: () => ({
    shift: SHIFT,
    open: { mutate: vi.fn(), isPending: false, error: null },
    close: { mutateAsync: vi.fn(), isPending: false, error: null },
  }),
  useCashMovements: () => ({ data: MOVEMENTS }),
  useCatalogCurrency: () => "TZS",
  useHasPermission: (action: string) => grants.permissions.includes(action),
  useHasCapability: () => false,
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  useMutationMessage: () => null,
  useCloseBusinessDay: () => ({ mutate: vi.fn(), isPending: false, error: null, data: undefined }),
  useOpenTabsOf: () => ({ count: 0, owedMinor: 0 }),
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

function renderTill() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Manager />
    </QueryClientProvider>,
  );
}

const EXPECTED = "74,000";

beforeEach(() => {
  grants.permissions = ["pos.shift.close", "pos.cash_movement.record"];
});

describe("the blind count", () => {
  it("a manager sees Yetu's expected figure, so the search below can find it", () => {
    grants.permissions = ["pos.shift.close", "pos.cash_movement.record", "pos.report.manager"];
    renderTill();
    expect(document.body).toHaveTextContent(EXPECTED);
  });

  it("a cashier never sees the expected figure anywhere on the till until they have counted", async () => {
    renderTill();
    expect(document.body).not.toHaveTextContent(EXPECTED);
    expect(document.body).not.toHaveTextContent(/expected/i);

    await userEvent.click(screen.getByTestId("open-close-shift"));
    const sheet = screen.getByRole("dialog", { name: "Close the shift" });
    expect(within(sheet).getByTestId("close-step-count")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(EXPECTED);
    expect(document.body).not.toHaveTextContent(/expected/i);

    await userEvent.type(screen.getByTestId("counted-cash"), "70000");
    expect(document.body).not.toHaveTextContent(EXPECTED);
    await userEvent.click(screen.getByRole("button", { name: "Check the count" }));
    expect(within(sheet).getByTestId("close-expected")).toHaveTextContent(`TSh ${EXPECTED}`);
  });
});
