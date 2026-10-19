import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAIRING_STEPS } from "../access/accessSettings";
import { PairingScreen } from "./PairingScreen";

const session = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSession: () => session.value,
}));

const startPairing = vi.fn(async () => undefined);
const resetPairing = vi.fn(async () => undefined);
const continueAfterApproval = vi.fn(async () => undefined);

function pairingIn(seconds: number) {
  return {
    pairingRequestId: "pr-1",
    pairingCode: "ABCDE-FGHIJ",
    claimToken: "claim",
    fingerprint: "SHA256:3f9a2bc81d",
    expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
    qrPayload: "YETU-POS:1:ABCDE-FGHIJ",
  };
}

function useSession(overrides: Record<string, unknown>) {
  session.value = {
    phase: "unpaired",
    identity: {},
    error: null,
    startPairing,
    resetPairing,
    continueAfterApproval,
    ...overrides,
  };
}

beforeEach(() => {
  startPairing.mockClear();
  resetPairing.mockClear();
  continueAfterApproval.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PairingScreen before a code", () => {
  it("asks to connect this till to the restaurant and gets a code on request", async () => {
    useSession({ phase: "unpaired" });
    render(<PairingScreen />);
    expect(screen.getByRole("heading", { name: "Connect this till to your restaurant" })).toBeInTheDocument();
    expect(screen.getByTestId("pairing-screen")).not.toHaveTextContent(/authority|bind|outlet/i);
    await userEvent.click(screen.getByRole("button", { name: "Get a code" }));
    expect(startPairing).toHaveBeenCalledTimes(1);
  });

  it("says in words that a manager declined, and offers a new code", async () => {
    useSession({ phase: "unpaired", error: "This pairing was denied. Generate a new code." });
    render(<PairingScreen />);
    expect(screen.getByTestId("pairing-error")).toHaveTextContent(
      "A manager declined this till. Ask them why, then get a new code.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Get a new code" }));
    expect(startPairing).toHaveBeenCalledTimes(1);
  });

  it("says a code ran out in words", () => {
    useSession({ phase: "unpaired", error: "This code expired. Generate a new one." });
    render(<PairingScreen />);
    expect(screen.getByTestId("pairing-error")).toHaveTextContent("That code ran out. Get a new code to try again.");
  });
});

describe("PairingScreen with a code", () => {
  it("shows the code large and grouped, a QR code, and three numbered steps", async () => {
    useSession({ phase: "waiting", identity: { pairing: pairingIn(600) } });
    render(<PairingScreen />);
    expect(screen.getByTestId("pairing-code")).toHaveTextContent("ABCDE-FGHIJ");
    const qr = await screen.findByTestId("pairing-qr");
    expect(qr.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(qr).toHaveAttribute("alt", "QR code for pairing code ABCDE-FGHIJ");
    const steps = within(screen.getByRole("list", { name: "How to connect" })).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual(PAIRING_STEPS.map((step, index) => `${index + 1}${step}`));
    // F-225: the hotel app's own words for where a till is approved.
    expect(PAIRING_STEPS[0]).toBe("In Yetu, open Restaurant, then Tills and screens.");
    expect(PAIRING_STEPS[1]).toBe("Press Connect a till.");
  });

  it("keeps the technical fingerprint behind Technical details", () => {
    useSession({ phase: "waiting", identity: { pairing: pairingIn(600) } });
    render(<PairingScreen />);
    expect(screen.getByTestId("pairing-fingerprint").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Details for support")).toBeInTheDocument();
  });

  it("counts down the time left on the code", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    useSession({ phase: "waiting", identity: { pairing: pairingIn(581) } });
    render(<PairingScreen />);
    expect(screen.getByTestId("pairing-expiry")).toHaveTextContent("This code works for 9:41 more");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId("pairing-expiry")).toHaveTextContent("This code works for 8:41 more");
  });

  it("shows the live steps while a manager approves", () => {
    useSession({ phase: "waiting", identity: { pairing: pairingIn(600) } });
    render(<PairingScreen />);
    const live = within(screen.getByTestId("pairing-state")).getAllByRole("listitem");
    expect(live.map((step) => step.textContent)).toEqual([
      "Code shown, done",
      "Waiting for a manager to approve, now",
      "Connected to your restaurant, next",
    ]);
  });

  it("gets a new code: the old one is dropped first", async () => {
    useSession({ phase: "waiting", identity: { pairing: pairingIn(600) } });
    render(<PairingScreen />);
    await userEvent.click(screen.getByRole("button", { name: "New code" }));
    expect(resetPairing).toHaveBeenCalledTimes(1);
    expect(startPairing).toHaveBeenCalledTimes(1);
    expect(resetPairing.mock.invocationCallOrder[0]).toBeLessThan(startPairing.mock.invocationCallOrder[0]);
  });

  it("cancels back to the start", async () => {
    useSession({ phase: "waiting", identity: { pairing: pairingIn(600) } });
    render(<PairingScreen />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(resetPairing).toHaveBeenCalledTimes(1);
    expect(startPairing).not.toHaveBeenCalled();
  });
});
