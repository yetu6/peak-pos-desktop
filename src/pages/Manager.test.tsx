import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Manager } from "./Manager";
import type { POSShift, POSWaitersMoney } from "../lib/posContracts";

const { closeBusinessDayMutate, waitersRef, permissionsRef, capabilitiesRef, shiftRef, currencyRef, movementsRef } = vi.hoisted(() => ({
  closeBusinessDayMutate: vi.fn(),
  permissionsRef: { permissions: ["pos.shift.open"] as string[] },
  waitersRef: { data: undefined as POSWaitersMoney | undefined, isLoading: false },
  capabilitiesRef: { capabilities: [] as string[] },
  shiftRef: { shift: undefined as POSShift | undefined },
  currencyRef: { currency: "TZS" as string | undefined },
  movementsRef: {
    data: [] as Array<{
      id: string;
      movementType: "CASH_IN" | "CASH_OUT" | "DRAWER_OPENED";
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
  useOutletMoneySettings: () => ({ standardFloat: 0, quickCashNotes: [1000,2000,5000,10000] }),
  usePosShift: () => ({ shift: shiftRef.shift, close: { mutateAsync: vi.fn(), isPending: false } }),
  useCashMovements: () => movementsRef,
  useCatalogCurrency: () => currencyRef.currency,
  useCloseBusinessDay: () => ({ mutate: closeBusinessDayMutate, isPending: false, error: null, data: undefined }),
  useHasPermission: (action: string) => permissionsRef.permissions.includes(action),
  useHasCapability: (code: string) => capabilitiesRef.capabilities.includes(code),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  useOpenTabsOf: () => ({ count: 0, owedMinor: 0 }),
  useMutationMessage: () => null,
  useWaitersMoney: () => waitersRef,
  useReceiveFromWaiter: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock("../components/CashMovementDialog", () => ({
  CashMovementDialog: ({ initialType, onRecorded }: { initialType?: string; onRecorded?: () => void }) => (
    <div data-testid="cash-movement-dialog-stub" data-type={initialType}>
      <button type="button" onClick={onRecorded}>
        Yetu recorded it
      </button>
    </div>
  ),
}));

// The opening itself is tested in OpenDrawerSheet.test.tsx: here, what Cash does once Yetu has recorded it.
vi.mock("../cash/OpenDrawerSheet", () => ({
  OpenDrawerSheet: ({ onRecorded }: { onRecorded: (opening: { reason: string }) => void }) => (
    <div data-testid="open-drawer-sheet-stub">
      <button type="button" onClick={() => onRecorded({ reason: "Check the float" })}>
        Yetu recorded the opening
      </button>
    </div>
  ),
}));

// This till's printers: a drawer on the bill printer, or none (a laptop).
const { till } = vi.hoisted(() => ({
  till: { drawer: true, raw: [] as Uint8Array[], fails: false },
}));
vi.mock("../print/printerStore", () => ({
  loadPrinterSettings: async () => ({
    kitchenTickets: false,
    kitchen: null,
    stations: {},
    receipt: { target: { kind: "network", host: "192.168.1.50", port: 9100 }, width: 48 },
    cashDrawer: till.drawer,
  }),
  printRawToPrinter: async (_target: unknown, bytes: Uint8Array) => {
    if (till.fails) throw new Error("Printer offline");
    till.raw.push(bytes);
  },
}));
const DRAWER_KICK = [0x1b, 0x70, 0, 25, 250].join(",");

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
    waitersRef.data = undefined;
    till.drawer = true;
    till.raw = [];
    till.fails = false;
  });

  // Waiters collect (owner, 2026-10-29; fbc-peak #327): a waiter holds no drawer.
  it("a waiter sees the money they hold, never the drawer", async () => {
    shiftRef.shift = SHIFT;
    permissionsRef.permissions = ["pos.order.create", "pos.payment.record"];
    waitersRef.data = {
      shiftId: SHIFT.id,
      waiters: [{ staffId: "staff-amina", name: "Amina Hassan", ordersTaken: 2, ordersOpen: 0, cashMinor: 4_740_000,
        mobileMoneyMinor: 0, cardMinor: 0, otherMinor: 0, handedInMinor: 0, owedMinor: 0, heldMinor: 4_740_000 }],
    };
    renderCash();
    expect(await screen.findByTestId("waiter-own-money")).toHaveTextContent("TSh 47,400");
    expect(screen.queryByText("In the drawer")).toBeNull();
    expect(screen.queryByTestId("open-close-shift")).toBeNull();
  });

  it("the cashier sees who still holds cash before closing the shift", async () => {
    shiftRef.shift = SHIFT;
    permissionsRef.permissions = ["pos.shift.open", "pos.shift.close", "pos.cash_movement.record"];
    waitersRef.data = {
      shiftId: SHIFT.id,
      waiters: [{ staffId: "staff-grace", name: "Grace Mushi", ordersTaken: 1, ordersOpen: 0, cashMinor: 1_780_000,
        mobileMoneyMinor: 0, cardMinor: 0, otherMinor: 0, handedInMinor: 0, owedMinor: 0, heldMinor: 1_780_000 }],
    };
    renderCash();
    expect(await screen.findByTestId("receive-staff-grace")).toHaveTextContent("Receive");
    expect(screen.getByTestId("waiters-hold-warning")).toHaveTextContent(
      "Grace Mushi still holds TSh 17,800. If you close now, it's recorded as owed by Grace Mushi.",
    );
  });

  // The owner, 2026-10-21: anyone who takes money may open the drawer without a sale, on the record.
  it("offers Open drawer only on a till with a drawer, to those who may open it", async () => {
    shiftRef.shift = SHIFT;
    capabilitiesRef.capabilities = [];
    permissionsRef.permissions = ["pos.shift.open", "pos.cash_movement.record", "pos.cash_drawer.open"];
    const { unmount } = renderCash();
    expect(await screen.findByTestId("open-drawer")).toHaveTextContent("Open drawer");
    unmount();
    till.drawer = false; // a laptop: no drawer
    const laptop = renderCash();
    await screen.findByTestId("open-cash-movement");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId("open-drawer")).toBeNull();
    laptop.unmount();
    till.drawer = true;
    permissionsRef.permissions = ["pos.shift.open", "pos.cash_movement.record"];
    renderCash();
    await screen.findByTestId("open-cash-movement");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId("open-drawer")).toBeNull();
  });

  it("a role that may open the drawer but not move cash still sees Open drawer", async () => {
    shiftRef.shift = SHIFT;
    capabilitiesRef.capabilities = [];
    permissionsRef.permissions = ["pos.shift.open", "pos.cash_drawer.open"];
    renderCash();
    expect(await screen.findByTestId("open-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("cash-movement-unavailable")).toBeInTheDocument();
  });

  it("opens the drawer once Yetu has recorded why, and says so", async () => {
    shiftRef.shift = SHIFT;
    capabilitiesRef.capabilities = [];
    permissionsRef.permissions = ["pos.shift.open", "pos.cash_movement.record", "pos.cash_drawer.open"];
    renderCash();
    await userEvent.click(await screen.findByTestId("open-drawer"));
    expect(till.raw).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Yetu recorded the opening" }));
    expect(await screen.findByTestId("cash-notice")).toHaveTextContent("The drawer opened: Check the float.");
    expect(till.raw.map((bytes) => Array.from(bytes).join(","))).toEqual([expect.stringContaining(DRAWER_KICK)]);
    expect(screen.queryByTestId("open-drawer-sheet-stub")).toBeNull();
  });

  it("a drawer that didn't open says so, and how to open it", async () => {
    till.fails = true;
    shiftRef.shift = SHIFT;
    capabilitiesRef.capabilities = [];
    permissionsRef.permissions = ["pos.shift.open", "pos.cash_movement.record", "pos.cash_drawer.open"];
    renderCash();
    await userEvent.click(await screen.findByTestId("open-drawer"));
    await userEvent.click(screen.getByRole("button", { name: "Yetu recorded the opening" }));
    expect(await screen.findByTestId("cash-notice")).toHaveTextContent("The cash drawer didn't open: printer offline. Open it with its key");
  });

  it("cash in opens the drawer once Yetu has recorded it", async () => {
    shiftRef.shift = SHIFT;
    capabilitiesRef.capabilities = [];
    permissionsRef.permissions = ["pos.shift.open", "pos.cash_movement.record"];
    renderCash();
    await screen.findByTestId("open-cash-movement");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await userEvent.click(screen.getByTestId("open-cash-movement"));
    await userEvent.click(screen.getByRole("button", { name: "Yetu recorded it" }));
    expect(await screen.findByTestId("cash-notice")).toHaveTextContent("Cash in recorded. The drawer opened.");
    expect(till.raw).toHaveLength(1);
  });

  it("lists an opening of the drawer with why, who and when, and no money", () => {
    permissionsRef.permissions = ["pos.shift.open", "pos.cash_movement.record"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    movementsRef.data = [
      { id: "o1", movementType: "DRAWER_OPENED", amountMinor: 0, reason: "Change for a guest's note", recordedBy: "staff-grace", createdAt: new Date(2026, 8, 4, 12, 15).toISOString() },
    ];
    renderCash();
    const list = screen.getByTestId("cash-movement-list");
    expect(list).toHaveTextContent("Drawer opened");
    expect(list).toHaveTextContent("Change for a guest's note · Grace Mushi · 12:15");
    expect(list).not.toHaveTextContent("TSh");
  });

  it("hides cash movements and day close from a cashier with neither grant", () => {
    permissionsRef.permissions = ["pos.shift.open", ];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    renderCash();

    expect(screen.getByTestId("cash-movement-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("open-cash-movement")).not.toBeInTheDocument();
    expect(screen.queryByTestId("close-business-day")).not.toBeInTheDocument();
  });

  it("offers cash movements to a staff member who holds pos.cash_movement.record", async () => {
    permissionsRef.permissions = ["pos.shift.open", "pos.cash_movement.record"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    renderCash();

    const open = screen.getByTestId("open-cash-movement");
    expect(open).not.toBeDisabled();
    await userEvent.click(open);
    expect(screen.getByTestId("cash-movement-dialog-stub")).toBeInTheDocument();
  });

  it("lists a non-TZS outlet's cash movements in its own currency, never a hardcoded TZS", () => {
    permissionsRef.permissions = ["pos.shift.open", "pos.cash_movement.record"];
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
    permissionsRef.permissions = ["pos.shift.open", "pos.report.manager"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    renderCash();

    expect(screen.getByTestId("close-business-day")).toBeInTheDocument();
  });

  it("hides POS day close outright on a hybrid LODGING property even with pos.report.manager", () => {
    permissionsRef.permissions = ["pos.shift.open", "pos.report.manager"];
    capabilitiesRef.capabilities = ["LODGING"];
    shiftRef.shift = SHIFT;
    renderCash();

    expect(screen.queryByTestId("close-business-day")).not.toBeInTheDocument();
  });

  it("disables cash-movement entry with no open shift instead of a dead dialog", () => {
    permissionsRef.permissions = ["pos.shift.open", "pos.cash_movement.record"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = undefined;
    renderCash();

    expect(screen.getByTestId("open-cash-movement")).toBeDisabled();
  });

  it("sums up the drawer for a manager with only the figures Yetu works out, each explained", () => {
    permissionsRef.permissions = ["pos.shift.open", "pos.cash_movement.record", "pos.shift.close", "pos.report.manager"];
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
    permissionsRef.permissions = ["pos.shift.open", "pos.cash_movement.record", "pos.shift.close"];
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
    permissionsRef.permissions = ["pos.shift.open", "pos.cash_movement.record"];
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
    permissionsRef.permissions = ["pos.shift.open", "pos.cash_movement.record"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    renderCash();
    await userEvent.click(screen.getByTestId("open-cash-out"));
    expect(screen.getByTestId("cash-movement-dialog-stub")).toHaveAttribute("data-type", "CASH_OUT");
  });

  it("starts closing the shift from Cash", async () => {
    permissionsRef.permissions = ["pos.shift.open", "pos.shift.close"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    renderCash();
    await userEvent.click(screen.getByTestId("open-close-shift"));
    expect(screen.getByRole("dialog", { name: "Close the shift" })).toBeInTheDocument();
  });

  it("says in words who can close the shift and record cash, instead of hiding it", () => {
    permissionsRef.permissions = ["pos.shift.open", ];
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
    permissionsRef.permissions = ["pos.shift.open", "pos.report.manager"];
    capabilitiesRef.capabilities = [];
    shiftRef.shift = SHIFT;
    renderCash();
    expect(screen.getByTestId("close-business-day")).toBeDisabled();
    expect(screen.getByTestId("close-day")).toHaveTextContent("Close this till's shift first.");
  });
});

