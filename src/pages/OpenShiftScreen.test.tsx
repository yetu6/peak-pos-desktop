import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpenShiftScreen } from "./OpenShiftScreen";

const { switchStaff, openMutate, useDeviceSessionMock, useHasPermissionMock } = vi.hoisted(() => ({
  switchStaff: vi.fn(),
  openMutate: vi.fn(),
  useDeviceSessionMock: vi.fn(),
  useHasPermissionMock: vi.fn(),
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSession: () => useDeviceSessionMock(),
}));

vi.mock("../hooks/usePosData", () => ({
  useHasPermission: () => useHasPermissionMock(),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  useMutationMessage: (error: unknown) => (error ? String(error) : null),
  usePosShift: () => ({
    open: { mutate: openMutate, isPending: false, error: null },
  }),
}));

function baseSession() {
  return {
    session: { staffId: "00007" },
    identity: { terminalName: "Bar 1" },
    switchStaff,
  };
}

describe("OpenShiftScreen", () => {
  it("lets a staff member with pos.shift.open key in a float and open the shift", async () => {
    useDeviceSessionMock.mockReturnValue(baseSession());
    useHasPermissionMock.mockReturnValue(true);
    render(<OpenShiftScreen />);

    expect(screen.getByTestId("shift-staff-name")).toHaveTextContent("00007");
    expect(screen.queryByTestId("open-shift-unavailable")).not.toBeInTheDocument();

    await userEvent.type(screen.getByTestId("opening-float"), "50000");
    await userEvent.click(screen.getByTestId("open-shift"));

    expect(openMutate).toHaveBeenCalledWith({ openingCashMinor: 5_000_000, idempotencyKey: "key-1" });
  });

  it("never renders a disabled register control for staff without shift-open permission", () => {
    useDeviceSessionMock.mockReturnValue(baseSession());
    useHasPermissionMock.mockReturnValue(false);
    render(<OpenShiftScreen />);

    expect(screen.queryByTestId("opening-float")).not.toBeInTheDocument();
    expect(screen.queryByTestId("open-shift")).not.toBeInTheDocument();
    expect(screen.getByTestId("open-shift-unavailable")).toBeInTheDocument();
  });

  it("lets the operator switch staff without opening a shift", async () => {
    useDeviceSessionMock.mockReturnValue(baseSession());
    useHasPermissionMock.mockReturnValue(true);
    render(<OpenShiftScreen />);

    await userEvent.click(screen.getByTestId("open-shift-switch-staff"));
    expect(switchStaff).toHaveBeenCalled();
  });
});
