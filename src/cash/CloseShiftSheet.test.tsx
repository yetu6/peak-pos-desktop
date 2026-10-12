import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { POSShift } from "../lib/posContracts";
import { CloseShiftSheet } from "./CloseShiftSheet";
import { lastClosedShift, forgetClosedShift } from "./closedShift";

const { closeAsync } = vi.hoisted(() => ({ closeAsync: vi.fn() }));

vi.mock("../hooks/usePosData", () => ({
  usePosShift: () => ({ close: { mutateAsync: closeAsync, isPending: false } }),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
}));

const SHIFT: POSShift = {
  id: "shift-1",
  status: "OPEN",
  openingCashMinor: 5_000_000,
  expectedCashMinor: 7_400_000,
  businessDate: "2026-10-12",
  openedAt: "2026-10-12T04:02:00Z",
};

const ROSTER = [
  { fullName: "Amina Hassan", staffNumber: "staff-amina" },
  { fullName: "Grace Mushi", staffNumber: "staff-grace" },
];

function renderSheet() {
  return render(
    <CloseShiftSheet open onOpenChange={vi.fn()} shift={SHIFT} currency="TZS" requesterId="staff-amina" roster={ROSTER} />,
  );
}

function problem(code: string, detail: string): Error {
  return new Error(JSON.stringify({ code, detail }));
}

async function count(amount: string) {
  await userEvent.type(screen.getByTestId("counted-cash"), amount);
  await userEvent.click(screen.getByRole("button", { name: "Check the count" }));
}

beforeEach(() => {
  closeAsync.mockReset();
  forgetClosedShift();
});

describe("CloseShiftSheet: count first, blind", () => {
  it("never shows the expected figure before the count is entered", () => {
    renderSheet();
    const sheet = screen.getByRole("dialog", { name: "Close the shift" });
    expect(within(sheet).getByTestId("close-step-count")).toBeInTheDocument();
    expect(sheet).not.toHaveTextContent("74,000");
    expect(sheet).not.toHaveTextContent(/expected/i);
  });

  it("moves to the check only once a count is entered", async () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "Check the count" })).toBeDisabled();
    await count("74000");
    expect(screen.getByTestId("close-step-check")).toBeInTheDocument();
    expect(screen.getByTestId("close-expected")).toHaveTextContent("TSh 74,000");
    expect(screen.getByTestId("close-counted")).toHaveTextContent("TSh 74,000");
  });
});

describe("CloseShiftSheet: check", () => {
  it("closes a balanced drawer without a supervisor, sending the count in minor units", async () => {
    closeAsync.mockResolvedValue({ ...SHIFT, status: "CLOSED", countedCashMinor: 7_400_000, varianceMinor: 0 });
    renderSheet();
    await count("74000");
    expect(screen.getByTestId("close-outcome")).toHaveTextContent("Balanced. The drawer matches what Yetu expects.");
    expect(screen.queryByRole("group", { name: "Supervisor PIN" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("close-shift"));
    expect(closeAsync).toHaveBeenCalledWith({ countedCashMinor: 7_400_000, idempotencyKey: "key-1" });
  });

  it("asks a different manager to approve when the drawer is over, as the backend requires", async () => {
    closeAsync.mockResolvedValue({ ...SHIFT, status: "CLOSED", countedCashMinor: 7_450_000, varianceMinor: 50_000 });
    renderSheet();
    await count("74500");
    expect(screen.getByTestId("close-outcome")).toHaveTextContent("Over. You counted more than Yetu expects.");
    const closeButton = screen.getByTestId("close-shift");
    expect(closeButton).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: /Amina Hassan/ }));
    expect(screen.getByText("You can't approve your own request. Ask another supervisor.")).toBeInTheDocument();
    for (const digit of "736251") await userEvent.click(screen.getByTestId(`close-pin-key-${digit}`));
    expect(closeButton).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    for (const digit of "736251") await userEvent.click(screen.getByTestId(`close-pin-key-${digit}`));
    expect(closeButton).not.toBeDisabled();
    await userEvent.click(closeButton);
    expect(closeAsync).toHaveBeenCalledWith({
      countedCashMinor: 7_450_000,
      supervisorStaffId: "staff-grace",
      supervisorPin: "736251",
      idempotencyKey: "key-1",
    });
  });

  it("with no staff list, a difference can't be approved and it says why", async () => {
    render(<CloseShiftSheet open onOpenChange={vi.fn()} shift={SHIFT} currency="TZS" requesterId="staff-amina" roster={[]} />);
    await count("74500");
    expect(screen.queryByRole("textbox", { name: /staff number/i })).not.toBeInTheDocument();
    expect(screen.getByText(/can't show its staff list right now/)).toBeInTheDocument();
    expect(screen.getByTestId("close-shift")).toBeDisabled();
  });

  it("says a short drawer in words", async () => {
    renderSheet();
    await count("73500");
    expect(screen.getByTestId("close-outcome")).toHaveTextContent("Short. You counted less than Yetu expects.");
  });

  it("lets the count be changed before closing", async () => {
    renderSheet();
    await count("73500");
    await userEvent.click(screen.getByRole("button", { name: "Change the count" }));
    expect(screen.getByTestId("close-step-count")).toBeInTheDocument();
  });

  it("asks for a manager when Yetu finds a difference the till did not see", async () => {
    closeAsync.mockRejectedValueOnce(problem("CONFLICT", "supervisor approval failed"));
    renderSheet();
    await count("74000");
    await userEvent.click(screen.getByTestId("close-shift"));
    expect(await screen.findByTestId("close-shift-error")).toHaveTextContent(/a manager must approve/);
    expect(screen.getByRole("group", { name: "Supervisor PIN" })).toBeInTheDocument();
    expect(screen.getByTestId("close-shift")).toBeDisabled();
  });

  it("says why Yetu would not close it, in words", async () => {
    closeAsync.mockRejectedValueOnce(problem("CONFLICT", "shift has open orders"));
    renderSheet();
    await count("74000");
    await userEvent.click(screen.getByTestId("close-shift"));
    expect(await screen.findByTestId("close-shift-error")).toHaveTextContent(
      "Some orders on this till are still open. Take payment for them or void them, then close the shift.",
    );
  });

  it("keeps Yetu's result for the Done summary after the shift closes", async () => {
    const closed = { ...SHIFT, status: "CLOSED" as const, countedCashMinor: 7_450_000, varianceMinor: 50_000 };
    closeAsync.mockResolvedValue(closed);
    renderSheet();
    await count("74500");
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    for (const digit of "736251") await userEvent.click(screen.getByTestId(`close-pin-key-${digit}`));
    await userEvent.click(screen.getByTestId("close-shift"));
    expect(lastClosedShift()).toMatchObject({ shift: closed, currency: "TZS" });
  });
});
