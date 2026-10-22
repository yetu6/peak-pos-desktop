import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forgetClosedShift, lastClosedShift, rememberClosedShift } from "../cash/closedShift";
import type { POSShift } from "../lib/posContracts";
import { OpenShiftScreen } from "./OpenShiftScreen";

const { switchStaff, openMutate, useDeviceSessionMock, grants, dayClose, dayCloseMutate } = vi.hoisted(() => ({
  switchStaff: vi.fn(),
  openMutate: vi.fn((_vars: unknown) => new Promise<unknown>(() => {})),
  useDeviceSessionMock: vi.fn(),
  grants: { standardFloat: 0, permissions: [] as string[], capabilities: [] as string[] },
  dayClose: { error: null as unknown, data: undefined as unknown, isPending: false },
  dayCloseMutate: vi.fn(),
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSession: () => useDeviceSessionMock(),
}));

vi.mock("../hooks/usePosData", () => ({
  useOutletMoneySettings: () => ({ standardFloat: grants.standardFloat, quickCashNotes: [1000,2000,5000,10000] }),
  useHasPermission: (action: string) => grants.permissions.includes(action),
  useHasCapability: (code: string) => grants.capabilities.includes(code),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  useMutationMessage: (error: unknown) => (error ? String(error) : null),
  useCatalogCurrency: () => "TZS",
  usePosShift: () => ({
    open: { mutateAsync: openMutate, isPending: false, error: null },
  }),
  useCloseBusinessDay: () => ({ mutate: dayCloseMutate, ...dayClose }),
}));

function baseSession() {
  return {
    session: { staffId: "00007" },
    identity: { terminalName: "Bar 1" },
    roster: [],
    switchStaff,
  };
}

beforeEach(() => {
  grants.standardFloat = 0;
  grants.permissions = ["pos.shift.open"];
  grants.capabilities = [];
  dayClose.error = null;
  dayClose.data = undefined;
  openMutate.mockClear();
  dayCloseMutate.mockClear();
  useDeviceSessionMock.mockReturnValue(baseSession());
});

afterEach(() => {
  forgetClosedShift();
});

describe("OpenShiftScreen", () => {
  it("lets a staff member with pos.shift.open key in a float and open the shift", async () => {
    render(<OpenShiftScreen />);
    expect(screen.getByTestId("shift-staff-name")).toHaveTextContent("00007");
    expect(screen.queryByTestId("open-shift-unavailable")).not.toBeInTheDocument();
    await userEvent.type(screen.getByTestId("opening-float"), "50000");
    await userEvent.click(screen.getByTestId("open-shift"));
    expect(openMutate).toHaveBeenCalledWith({ openingCashMinor: 5_000_000, idempotencyKey: "key-1" });
  });

  it("asks for the drawer to be counted, in the outlet's own currency", () => {
    render(<OpenShiftScreen />);
    expect(screen.getByRole("heading", { name: "Open the shift" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Opening cash" })).toBeInTheDocument();
    expect(screen.getByText("TSh")).toBeInTheDocument();
  });

  it("never renders a disabled register control for staff without shift-open permission", () => {
    grants.permissions = [];
    render(<OpenShiftScreen />);
    expect(screen.queryByTestId("opening-float")).not.toBeInTheDocument();
    expect(screen.queryByTestId("open-shift")).not.toBeInTheDocument();
    expect(screen.getByTestId("open-shift-unavailable")).toHaveTextContent(
      "Only a cashier or manager can open the shift. Ask one to open it.",
    );
  });

  it("lets the operator switch staff without opening a shift", async () => {
    render(<OpenShiftScreen />);
    await userEvent.click(screen.getByTestId("open-shift-switch-staff"));
    expect(switchStaff).toHaveBeenCalled();
  });

  it("counts note by note and uses the total as the float", async () => {
    render(<OpenShiftScreen />);
    await userEvent.click(screen.getByRole("button", { name: "Count note by note" }));
    const counter = screen.getByRole("dialog", { name: "Count note by note" });
    await userEvent.click(within(counter).getByRole("button", { name: "One more TSh 10,000" }));
    await userEvent.click(within(counter).getByRole("button", { name: "One more TSh 10,000" }));
    await userEvent.click(within(counter).getByRole("button", { name: "One more TSh 5,000" }));
    expect(within(counter).getByTestId("note-count-total")).toHaveTextContent("TSh 25,000");
    await userEvent.click(within(counter).getByRole("button", { name: "Use TSh 25,000" }));
    expect(screen.getByTestId("opening-float")).toHaveValue("25,000");
    await userEvent.click(screen.getByTestId("open-shift"));
    expect(openMutate).toHaveBeenCalledWith({ openingCashMinor: 2_500_000, idempotencyKey: "key-1" });
  });
});

describe("OpenShiftScreen after a shift closes", () => {
  const CLOSED: POSShift = {
    id: "shift-1",
    status: "CLOSED",
    openingCashMinor: 5_000_000,
    expectedCashMinor: 7_400_000,
    countedCashMinor: 7_450_000,
    varianceMinor: 50_000,
    businessDate: "2026-10-12",
    openedAt: "2026-10-12T04:02:00Z",
  };

  it("keeps the summary when the new shift doesn't open", async () => {
    openMutate.mockRejectedValueOnce(new Error(JSON.stringify({ code: "CONFLICT", detail: "x" })));
    rememberClosedShift({ shift: CLOSED, currency: "TZS", at: new Date(2026, 9, 12, 22, 14) });
    render(<OpenShiftScreen />);
    await userEvent.type(screen.getByTestId("opening-float"), "50000");
    await userEvent.click(screen.getByTestId("open-shift"));
    expect(openMutate).toHaveBeenCalled();
    expect(lastClosedShift()).not.toBeNull();
    expect(screen.getByTestId("closed-shift-summary")).toBeInTheDocument();
  });

  it("forgets the summary once the new shift is open", async () => {
    openMutate.mockResolvedValueOnce({ ...CLOSED, id: "shift-2", status: "OPEN" });
    rememberClosedShift({ shift: CLOSED, currency: "TZS", at: new Date(2026, 9, 12, 22, 14) });
    render(<OpenShiftScreen />);
    await userEvent.type(screen.getByTestId("opening-float"), "50000");
    await userEvent.click(screen.getByTestId("open-shift"));
    await waitFor(() => expect(lastClosedShift()).toBeNull());
  });

  it("forgets the summary when the person switches", async () => {
    rememberClosedShift({ shift: CLOSED, currency: "TZS", at: new Date(2026, 9, 12, 22, 14) });
    render(<OpenShiftScreen />);
    await userEvent.click(screen.getByTestId("open-shift-switch-staff"));
    expect(switchStaff).toHaveBeenCalled();
    expect(lastClosedShift()).toBeNull();
  });

  it("shows the closed shift as Yetu worked it out", () => {
    rememberClosedShift({ shift: CLOSED, currency: "TZS", at: new Date(2026, 9, 12, 22, 14) });
    render(<OpenShiftScreen />);
    const summary = screen.getByTestId("closed-shift-summary");
    expect(summary).toHaveTextContent("Shift closed at 22:14");
    expect(summary).toHaveTextContent("Expected TSh 74,000");
    expect(summary).toHaveTextContent("Counted TSh 74,500");
    expect(summary).toHaveTextContent("Over by TSh 500");
    expect(screen.queryByTestId("closed-shift-tabs")).toBeNull();
  });

  it("says the tabs it handed over to the next shift, and what they owe (S17b)", () => {
    rememberClosedShift({ shift: { ...CLOSED, handedOverTabs: 3, handedOverOwedMinor: 4_520_000 }, currency: "TZS", at: new Date(2026, 9, 12, 22, 14) });
    render(<OpenShiftScreen />);
    expect(screen.getByTestId("closed-shift-tabs")).toHaveTextContent("3 tabs handed over to the next shift, owing TSh 45,200.");
  });
});

describe("Close the day", () => {
  it("is offered to a manager on a restaurant-only property, with what Yetu checks", async () => {
    grants.permissions = ["pos.shift.open", "pos.report.manager"];
    render(<OpenShiftScreen />);
    const card = screen.getByTestId("close-day");
    expect(within(card).getByRole("list", { name: "Before the day closes" })).toHaveTextContent("This till's shift is closed");
    // S17b: the day closes once its tabs are settled.
    expect(within(card).getByRole("list", { name: "Before the day closes" })).toHaveTextContent("Today's tabs are paid, charged to a room or cancelled");
    await userEvent.click(screen.getByTestId("close-business-day"));
    expect(dayCloseMutate).toHaveBeenCalledWith("key-1");
  });

  it("says what blocks it, in words", () => {
    grants.permissions = ["pos.report.manager"];
    dayClose.error = new Error(
      JSON.stringify({ code: "INVALID_STATE", detail: "a shift for this business date is still open: 2 shift(s) for 2026-10-12" }),
    );
    render(<OpenShiftScreen />);
    expect(screen.getByTestId("day-close-error")).toHaveTextContent(
      "2 shifts are still open today. Close every till's shift, then close the day.",
    );
  });

  it("says the new business day in words", () => {
    grants.permissions = ["pos.report.manager"];
    dayClose.data = { businessDate: "2026-10-12", nextBusinessDate: "2026-10-13", shiftsClosed: 3, settledAmountMinor: 0, closedAt: "" };
    render(<OpenShiftScreen />);
    expect(screen.getByTestId("day-close-result")).toHaveTextContent("Day closed. The new business day is Tue 13 Oct.");
  });

  it("once the day has closed, there is no Close the day to press again", () => {
    grants.permissions = ["pos.report.manager"];
    dayClose.data = { businessDate: "2026-10-12", nextBusinessDate: "2026-10-13", shiftsClosed: 3, settledAmountMinor: 0, closedAt: "" };
    render(<OpenShiftScreen />);
    expect(screen.getByTestId("day-close-result")).toBeInTheDocument();
    expect(screen.queryByTestId("close-business-day")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close the day/i })).not.toBeInTheDocument();
  });

  it("is not offered without pos.report.manager, nor on a hotel (night audit closes the day there)", () => {
    grants.standardFloat = 0;
  grants.permissions = ["pos.shift.open"];
    const { unmount } = render(<OpenShiftScreen />);
    expect(screen.queryByTestId("close-day")).not.toBeInTheDocument();
    unmount();
    grants.permissions = ["pos.shift.open", "pos.report.manager"];
    grants.capabilities = ["LODGING"];
    render(<OpenShiftScreen />);
    expect(screen.queryByTestId("close-day")).not.toBeInTheDocument();
  });
});

it("fills the standard float when settings arrive, preserving an edited count", async () => {
 const view = render(<OpenShiftScreen />);
 grants.standardFloat = 5_000_000;
 view.rerender(<OpenShiftScreen />);
 expect(screen.getByTestId("opening-float")).toHaveValue("50,000");
 await userEvent.clear(screen.getByTestId("opening-float"));
 await userEvent.type(screen.getByTestId("opening-float"), "40000");
 grants.standardFloat = 6_000_000;
 view.rerender(<OpenShiftScreen />);
 expect(screen.getByTestId("opening-float")).toHaveValue("40,000");
 await userEvent.click(screen.getByTestId("open-shift"));
 expect(openMutate).toHaveBeenCalledWith({ openingCashMinor: 4_000_000, idempotencyKey: "key-1" });
});
