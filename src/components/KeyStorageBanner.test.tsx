import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KeyStorageBanner } from "./KeyStorageBanner";

const session = vi.hoisted(() => ({ keyStorageWarning: null as string | null }));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSession: () => ({ keyStorageWarning: session.keyStorageWarning }),
}));

describe("KeyStorageBanner", () => {
  it("shows nothing while the key is stored safely", () => {
    session.keyStorageWarning = null;
    const { container } = render(<KeyStorageBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says what the problem means and what to do, with the detail behind Technical details", () => {
    session.keyStorageWarning = "Secure storage unavailable: falling back to an encrypted file (keyring error 0x80070490)";
    render(<KeyStorageBanner />);
    const banner = screen.getByTestId("key-storage-warning");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This till can't store its key safely. Call support before taking payments.",
    );
    const details = screen.getByText("Details for support").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("keyring error 0x80070490");
    expect(banner).toContainElement(details as HTMLElement);
  });
});
