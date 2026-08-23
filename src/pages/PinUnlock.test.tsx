import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PinUnlock } from "./PinUnlock";

const { unlock, useDeviceSessionMock } = vi.hoisted(() => ({
  unlock: vi.fn(async () => undefined),
  useDeviceSessionMock: vi.fn(),
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSession: () => useDeviceSessionMock(),
}));

function baseSession(overrides: Partial<ReturnType<typeof useDeviceSessionMock>> = {}) {
  return {
    unlock,
    error: null,
    identity: { terminalName: "Bar 1" },
    roster: [],
    ...overrides,
  };
}

async function typePin(digits: string): Promise<void> {
  for (const digit of digits) {
    await userEvent.click(screen.getByTestId(`pin-key-${digit}`));
  }
}

describe("PinUnlock", () => {
  it("goes straight to manual staff-number entry when the roster is empty", () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: [] }));
    render(<PinUnlock />);

    expect(screen.queryByTestId("staff-roster")).not.toBeInTheDocument();
    expect(screen.getByTestId("staff-number")).toBeInTheDocument();
  });

  it("shows a tap-to-select roster and unlocks with the tapped staff member's number", async () => {
    unlock.mockClear();
    useDeviceSessionMock.mockReturnValue(
      baseSession({
        roster: [
          { fullName: "Amina Hassan", staffNumber: "00001" },
          { fullName: "Grace Mushi", staffNumber: "00002" },
        ],
      }),
    );
    render(<PinUnlock />);

    expect(screen.getByTestId("staff-roster")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("roster-entry-00001"));
    expect(screen.getByTestId("selected-staff-name")).toHaveTextContent("Amina Hassan");

    await typePin("418205");
    await userEvent.click(screen.getByTestId("pin-unlock"));

    expect(unlock).toHaveBeenCalledWith("00001", "418205");
  });

  it("falls back to manual entry from the roster screen", async () => {
    useDeviceSessionMock.mockReturnValue(
      baseSession({
        roster: [{ fullName: "Amina Hassan", staffNumber: "00001" }],
      }),
    );
    render(<PinUnlock />);

    await userEvent.click(screen.getByTestId("staff-manual-entry"));
    expect(screen.queryByTestId("staff-roster")).not.toBeInTheDocument();
    expect(screen.getByTestId("staff-number")).toBeInTheDocument();
  });

  it("lets a roster selection be changed before unlocking", async () => {
    useDeviceSessionMock.mockReturnValue(
      baseSession({
        roster: [{ fullName: "Amina Hassan", staffNumber: "00001" }],
      }),
    );
    render(<PinUnlock />);

    await userEvent.click(screen.getByTestId("roster-entry-00001"));
    expect(screen.getByTestId("selected-staff-name")).toHaveTextContent("Amina Hassan");

    await userEvent.click(screen.getByTestId("staff-change"));
    expect(screen.getByTestId("staff-roster")).toBeInTheDocument();
  });
});
