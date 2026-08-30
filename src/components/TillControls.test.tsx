import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TillControls } from "./TillControls";
import type { POSShift } from "../lib/posContracts";

const { usePosShiftMock, useHasPermissionMock } = vi.hoisted(() => ({
  usePosShiftMock: vi.fn(),
  useHasPermissionMock: vi.fn(() => true),
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
  return { mutate: vi.fn(), isPending: false, error: null, ...overrides };
}

const OPEN_SHIFT: POSShift = {
  id: "shift-1",
  status: "OPEN",
  openingCashMinor: 10_000,
  expectedCashMinor: 10_000,
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

  it("shows a variance that still needs a supervisor after close", () => {
    usePosShiftMock.mockReturnValue({
      shift: null,
      open: mutation(),
      close: mutation({ data: { status: "PENDING_VARIANCE_APPROVAL", varianceMinor: 500 } }),
    });
    render(<TillControls />);
    expect(screen.getByTestId("shift-close-result")).toHaveTextContent("needs a supervisor");
  });

  it("closes with the counted drawer expressed in minor units", async () => {
    const close = mutation();
    usePosShiftMock.mockReturnValue({ shift: OPEN_SHIFT, open: mutation(), close });
    render(<TillControls />);
    expect(screen.getByTestId("shift-open")).toHaveTextContent("expected");
    await userEvent.type(screen.getByTestId("counted-cash"), "100");
    await userEvent.click(screen.getByTestId("close-shift"));
    expect(close.mutate).toHaveBeenCalledWith({ countedCashMinor: 10_000, idempotencyKey: "key-1" });
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
