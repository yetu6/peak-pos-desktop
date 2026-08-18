import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VerificationGate } from "./VerificationGate";

const { useTenantVerification, switchStaff } = vi.hoisted(() => ({
  useTenantVerification: vi.fn(),
  switchStaff: vi.fn(),
}));

vi.mock("../hooks/usePosData", () => ({
  useTenantVerification: () => useTenantVerification(),
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSession: () => ({ switchStaff }),
}));

describe("VerificationGate", () => {
  it("opens the register only when eligibility is READY", () => {
    useTenantVerification.mockReturnValue({ status: "READY" });
    render(
      <VerificationGate>
        <div data-testid="register">register</div>
      </VerificationGate>,
    );
    expect(screen.getByTestId("register")).toBeInTheDocument();
  });

  it("blocks UNKNOWN instead of fail-opening the register", () => {
    useTenantVerification.mockReturnValue({ status: "UNKNOWN" });
    render(
      <VerificationGate>
        <div data-testid="register">register</div>
      </VerificationGate>,
    );
    expect(screen.queryByTestId("register")).not.toBeInTheDocument();
    expect(screen.getByTestId("verification-unknown")).toBeInTheDocument();
  });

  it("keeps an unverified business off the register", async () => {
    useTenantVerification.mockReturnValue({ status: "UNVERIFIED" });
    render(
      <VerificationGate>
        <div data-testid="register">register</div>
      </VerificationGate>,
    );
    expect(screen.queryByTestId("register")).not.toBeInTheDocument();
    expect(screen.getByTestId("verification-gate")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Switch staff" }));
    expect(switchStaff).toHaveBeenCalled();
  });
});
