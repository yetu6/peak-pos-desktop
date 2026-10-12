import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { TillControls } from "./TillControls";
import type { POSShift } from "../lib/posContracts";

const { usePosShiftMock, useHasPermissionMock } = vi.hoisted(() => ({
  usePosShiftMock: vi.fn(),
  useHasPermissionMock: vi.fn((_action: string) => true),
}));

vi.mock("../hooks/usePosData", () => ({
  usePosShift: usePosShiftMock,
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  useMutationMessage: (error: unknown) => (error ? String((error as Error).message ?? error) : null),
  useHasPermission: useHasPermissionMock,
}));

function mutation<T>(
  overrides: Partial<{ mutate: (value: unknown) => void; isPending: boolean; error: unknown; data: T }> = {},
) {
  return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null, ...overrides };
}

function renderControls(ui: ReactNode = <TillControls currency="TZS" />) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

const OPEN_SHIFT: POSShift = {
  id: "shift-1",
  status: "OPEN",
  openingCashMinor: 10_000,
  expectedCashMinor: 7_400_000,
  businessDate: "2026-08-29",
  openedAt: "2026-08-29T08:00:00Z",
};

describe("TillControls", () => {
  it("opens the shift with the cashier's float in minor units, not a silent zero", async () => {
    const open = mutation();
    usePosShiftMock.mockReturnValue({ shift: null, open, close: mutation() });
    render(<TillControls />);
    expect(screen.getByTestId("open-shift")).toBeDisabled();
    await userEvent.type(screen.getByTestId("opening-float"), "100");
    await userEvent.click(screen.getByTestId("open-shift"));
    expect(open.mutate).toHaveBeenCalledWith({ openingCashMinor: 10_000, idempotencyKey: "key-1" });
  });

  it("Close shift opens the close-shift sheet, count first, never a one-field close", async () => {
    const close = mutation();
    usePosShiftMock.mockReturnValue({ shift: OPEN_SHIFT, open: mutation(), close });
    renderControls();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("open-close-shift"));
    const sheet = screen.getByRole("dialog", { name: "Close the shift" });
    expect(within(sheet).getByTestId("close-step-count")).toBeInTheDocument();
    expect(close.mutate).not.toHaveBeenCalled();
    expect(close.mutateAsync).not.toHaveBeenCalled();
  });

  it("shows the expected figure in the header only to managers (EXPECTED_CASH_VISIBLE_TO)", () => {
    usePosShiftMock.mockReturnValue({ shift: OPEN_SHIFT, open: mutation(), close: mutation() });
    const manager = renderControls();
    expect(screen.getByTestId("shift-open")).toHaveTextContent("Shift open · expected TSh 74,000");
    manager.unmount();

    useHasPermissionMock.mockImplementation((action: string) => action !== "pos.report.manager");
    renderControls();
    expect(screen.getByTestId("shift-open")).toHaveTextContent("Shift open");
    expect(document.body).not.toHaveTextContent("74,000");
    expect(document.body).not.toHaveTextContent(/expected/i);
    useHasPermissionMock.mockImplementation(() => true);
  });

  it("hides Open shift for a staff account without pos.shift.open, with an explanatory message instead of a dead button", () => {
    useHasPermissionMock.mockReturnValue(false);
    usePosShiftMock.mockReturnValue({ shift: null, open: mutation(), close: mutation() });
    render(<TillControls />);
    expect(screen.queryByTestId("open-shift")).not.toBeInTheDocument();
    expect(screen.getByTestId("shift-open-unavailable")).toHaveTextContent("ask a cashier");
    useHasPermissionMock.mockReturnValue(true);
  });
});
