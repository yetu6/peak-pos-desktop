import { act, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { POSShift } from "../lib/posContracts";
import { idleLockHeld } from "../lib/idleLock";
import { CloseShiftSheet } from "./CloseShiftSheet";
import { lastClosedShift, forgetClosedShift } from "./closedShift";

const { closeAsync, closeState, tabs } = vi.hoisted(() => ({
  closeAsync: vi.fn(),
  closeState: { isPending: false },
  // S17b: the shift's tabs still open, as the outlet's open orders say.
  tabs: { count: 0, owedMinor: 0, tabs: [] as unknown[] },
}));

vi.mock("../hooks/usePosData", () => ({
  usePosShift: () => ({ close: { mutateAsync: closeAsync, isPending: closeState.isPending } }),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  useOpenTabsOf: () => tabs,
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

function withClient(ui: ReactNode, client = new QueryClient()) {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function renderSheet() {
  return render(
    withClient(
      <CloseShiftSheet open onOpenChange={vi.fn()} shift={SHIFT} currency="TZS" requesterId="staff-amina" roster={ROSTER} />,
    ),
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
  tabs.count = 0;
  tabs.owedMinor = 0;
  tabs.tabs = [];
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

describe("CloseShiftSheet: from Count to Check", () => {
  it("a double click on Check the count can't also close the shift", async () => {
    renderSheet();
    await userEvent.type(screen.getByTestId("counted-cash"), "74000");
    await userEvent.dblClick(screen.getByRole("button", { name: "Check the count" }));
    expect(screen.getByTestId("close-step-check")).toBeInTheDocument();
    expect(closeAsync).not.toHaveBeenCalled();
  });

  it("moves focus to the Check heading, so a second Enter can't close the shift", async () => {
    renderSheet();
    await userEvent.type(screen.getByTestId("counted-cash"), "74000");
    screen.getByRole("button", { name: "Check the count" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Check the count" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(closeAsync).not.toHaveBeenCalled();
  });

  it("announces Balanced, Over or Short from a live region that is there before the result", async () => {
    renderSheet();
    const live = screen.getByTestId("close-outcome");
    expect(live).toHaveAttribute("role", "status");
    expect(live).toBeEmptyDOMElement();
    await count("73500");
    expect(screen.getByTestId("close-outcome")).toBe(live);
    expect(live).toHaveTextContent("Short. You counted less than Yetu expects.");
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

    const own = screen.getByRole("radio", { name: /Amina Hassan/ });
    expect(own).toBeDisabled();
    expect(own).toHaveAccessibleDescription("You can't approve your own request.");
    await userEvent.click(own);
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
    render(
      withClient(
        <CloseShiftSheet open onOpenChange={vi.fn()} shift={SHIFT} currency="TZS" requesterId="staff-amina" roster={[]} />,
      ),
    );
    await count("74500");
    expect(screen.queryByRole("textbox", { name: /staff number/i })).not.toBeInTheDocument();
    expect(screen.getByText(/can't show its staff list right now/)).toBeInTheDocument();
    expect(screen.getByTestId("close-shift")).toBeDisabled();
  });

  describe("an approval holds only for the count it was given", () => {
    async function approveAsGrace() {
      await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
      for (const digit of "736251") await userEvent.click(screen.getByTestId(`close-pin-key-${digit}`));
      expect(screen.getByTestId("close-shift")).not.toBeDisabled();
    }

    it("asks again after the count changes", async () => {
      renderSheet();
      await count("73500");
      await approveAsGrace();
      await userEvent.click(screen.getByRole("button", { name: "Change the count" }));
      await userEvent.clear(screen.getByTestId("counted-cash"));
      await count("70000");
      expect(screen.getByRole("radio", { name: /Grace Mushi/ })).not.toBeChecked();
      expect(screen.getByTestId("pin-dots")).toHaveAccessibleName("0 digits entered");
      expect(screen.getByTestId("close-shift")).toBeDisabled();
      await userEvent.click(screen.getByTestId("close-shift"));
      expect(closeAsync).not.toHaveBeenCalled();
    });

    it("asks again after leaving the check, even with the same count", async () => {
      renderSheet();
      await count("73500");
      await approveAsGrace();
      await userEvent.click(screen.getByRole("button", { name: "Change the count" }));
      await userEvent.click(screen.getByRole("button", { name: "Check the count" }));
      expect(screen.getByRole("radio", { name: /Grace Mushi/ })).not.toBeChecked();
      expect(screen.getByTestId("close-shift")).toBeDisabled();
    });
  });

  it("keeps asking for a manager once the check has shown a difference, even if the count is changed to match", async () => {
    closeAsync.mockResolvedValue({ ...SHIFT, status: "CLOSED", countedCashMinor: 7_400_000, varianceMinor: 0 });
    renderSheet();
    await count("70000");
    expect(screen.getByTestId("close-expected")).toHaveTextContent("TSh 74,000");
    await userEvent.click(screen.getByRole("button", { name: "Change the count" }));
    await userEvent.clear(screen.getByTestId("counted-cash"));
    await count("74000");
    expect(screen.getByTestId("close-outcome")).toHaveTextContent("Balanced");
    expect(screen.getByTestId("close-approval-reason")).toHaveTextContent(
      "The count changed after Yetu showed its figure, so a manager must approve this close.",
    );
    expect(screen.getByRole("group", { name: "Supervisor PIN" })).toBeInTheDocument();
    expect(screen.getByTestId("close-shift")).toBeDisabled();
    await userEvent.click(screen.getByTestId("close-shift"));
    expect(closeAsync).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    for (const digit of "736251") await userEvent.click(screen.getByTestId(`close-pin-key-${digit}`));
    await userEvent.click(screen.getByTestId("close-shift"));
    expect(closeAsync).toHaveBeenCalledWith({
      countedCashMinor: 7_400_000,
      supervisorStaffId: "staff-grace",
      supervisorPin: "736251",
      idempotencyKey: "key-1",
    });
  });

  it("asks for a manager when Yetu's figure changes while the Check is on screen", async () => {
    const client = new QueryClient();
    const sheet = (shift: POSShift) =>
      withClient(
        <CloseShiftSheet open onOpenChange={vi.fn()} shift={shift} currency="TZS" requesterId="staff-amina" roster={ROSTER} />,
        client,
      );
    const view = render(sheet(SHIFT));
    await count("74000");
    expect(screen.queryByRole("group", { name: "Supervisor PIN" })).not.toBeInTheDocument();
    view.rerender(sheet({ ...SHIFT, expectedCashMinor: 7_350_000 }));
    expect(screen.getByTestId("close-outcome")).toHaveTextContent("Over. You counted more than Yetu expects.");
    expect(screen.getByRole("group", { name: "Supervisor PIN" })).toBeInTheDocument();
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

  it("when Yetu finds a difference in a Balanced count, gets Yetu's figure again and shows it before asking for a manager", async () => {
    const client = new QueryClient();
    const sheet = (shift: POSShift) =>
      withClient(
        <CloseShiftSheet open onOpenChange={vi.fn()} shift={shift} currency="TZS" requesterId="staff-amina" roster={ROSTER} />,
        client,
      );
    const view = render(sheet(SHIFT));
    let finishRefresh = () => {};
    const refresh = vi.spyOn(client, "invalidateQueries").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = () => {
            view.rerender(sheet({ ...SHIFT, expectedCashMinor: 7_350_000 }));
            resolve();
          };
        }),
    );
    closeAsync.mockRejectedValueOnce(problem("CONFLICT", "supervisor approval failed"));
    await count("74000");
    expect(screen.getByTestId("close-outcome")).toHaveTextContent("Balanced");
    await userEvent.click(screen.getByTestId("close-shift"));

    expect(refresh).toHaveBeenCalledWith({ queryKey: ["pos", "shift"] });
    expect(screen.getByTestId("close-outcome")).not.toHaveTextContent("Balanced");
    expect(screen.getByTestId("close-outcome")).toHaveTextContent("Getting Yetu's latest figure");
    expect(screen.queryByRole("group", { name: "Supervisor PIN" })).not.toBeInTheDocument();

    await act(async () => finishRefresh());
    expect(screen.getByTestId("close-expected")).toHaveTextContent("TSh 73,500");
    expect(screen.getByTestId("close-outcome")).toHaveTextContent("Over. You counted more than Yetu expects.");
    expect(screen.getByRole("group", { name: "Supervisor PIN" })).toBeInTheDocument();
    expect(screen.getByTestId("close-shift-error")).toHaveTextContent(
      "Yetu's figure changed since this screen opened, so a manager must approve the difference.",
    );
  });

  it("can't be dismissed while the close is being sent", async () => {
    closeAsync.mockReturnValue(new Promise(() => {}));
    const onOpenChange = vi.fn();
    render(
      withClient(
        <CloseShiftSheet open onOpenChange={onOpenChange} shift={SHIFT} currency="TZS" requesterId="staff-amina" roster={ROSTER} />,
      ),
    );
    await count("74000");
    await userEvent.click(screen.getByTestId("close-shift"));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Change the count" })).toBeDisabled();
  });

  it("keeps the till from locking while the close is with Yetu (the mutation's own status)", () => {
    renderSheet();
    expect(idleLockHeld()).toBe(false);
    closeState.isPending = true;
    const second = renderSheet();
    expect(idleLockHeld()).toBe(true);
    second.unmount();
    closeState.isPending = false;
  });

  it("says why Yetu would not close it, in words", async () => {
    closeAsync.mockRejectedValueOnce(problem("SHIFT_HAS_OPEN_ORDERS", "shift has open orders"));
    renderSheet();
    await count("74000");
    await userEvent.click(screen.getByTestId("close-shift"));
    expect(await screen.findByTestId("close-shift-error")).toHaveTextContent(
      "Some orders on this shift are still open. Hand them over to the next shift, or take payment for them first.",
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

describe("CloseShiftSheet after too many attempts (429)", () => {
  it("says so and holds the close until Yetu's wait is over", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    closeAsync.mockRejectedValueOnce(new Error(JSON.stringify({ type: "about:blank", title: "Too many requests.", status: 429, code: "RATE_LIMITED", detail: "Too many requests. Try again in 41 seconds.", request_id: "req-9", retryAfterSeconds: 41 })));
    renderSheet();
    await count("74000");
    await userEvent.click(screen.getByTestId("close-shift"));
    expect(await screen.findByTestId("close-shift-error")).toHaveTextContent("Too many attempts. Wait a minute and try again.");
    expect(screen.getByTestId("close-shift")).toBeDisabled();
    try {
      act(() => vi.advanceTimersByTime(41_000));
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByTestId("close-shift")).toBeEnabled();
    expect(screen.queryByTestId("close-shift-error")).not.toBeInTheDocument();
  });
});

describe("CloseShiftSheet for a role that can't close it (403)", () => {
  it("says who can, as a permission notice", async () => {
    closeAsync.mockRejectedValueOnce(
      new Error(JSON.stringify({ type: "about:blank", title: "Forbidden.", status: 403, code: "FORBIDDEN", detail: "POS permission denied", request_id: "req-3" })),
    );
    renderSheet();
    await count("74000");
    await userEvent.click(screen.getByTestId("close-shift"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass("y-permission");
    expect(alert).toHaveTextContent("Only a cashier or manager can close the shift. Ask one to close it.");
  });
});

describe("CloseShiftSheet: tabs go to the next shift (S17b)", () => {
  it("says the open tabs and what they owe, and hands them over with the close", async () => {
    tabs.count = 2;
    tabs.owedMinor = 4_500_000;
    // The two tabs as the outlet's open orders list them.
    tabs.tabs = [
      { id: "o41", dailyNumber: 41, orderNumber: "POS-41", serviceType: "ROOM_SERVICE", tableLabel: "204", remainingMinor: 2_500_000 },
      { id: "o42", dailyNumber: 42, orderNumber: "POS-42", serviceType: "DINE_IN", tableLabel: "12", remainingMinor: 2_000_000 },
    ];
    closeAsync.mockResolvedValue({ ...SHIFT, status: "CLOSED", countedCashMinor: 7_400_000, varianceMinor: 0, handedOverTabs: 2, handedOverOwedMinor: 4_500_000 });
    renderSheet();
    await count("74000");
    expect(screen.getByTestId("close-open-tabs")).toHaveTextContent(
      "2 tabs are still open, owing TSh 45,000. Closing hands them over to the next shift: whoever opens it carries them on.",
    );
    const list = within(screen.getByTestId("close-tabs-list")).getAllByRole("listitem").map((item) => item.textContent);
    expect(list).toEqual(["Order 41 · Room 204TSh 25,000", "Order 42 · Table 12TSh 20,000"]);
    await userEvent.click(screen.getByRole("button", { name: "Hand over 2 tabs and close" }));
    expect(closeAsync).toHaveBeenCalledWith(expect.objectContaining({ countedCashMinor: 7_400_000, handOver: true }));
    expect(lastClosedShift()?.shift.handedOverTabs).toBe(2);
  });

  it("with no tabs open, closes as before, handing nothing over", async () => {
    closeAsync.mockResolvedValue({ ...SHIFT, status: "CLOSED", countedCashMinor: 7_400_000, varianceMinor: 0 });
    renderSheet();
    await count("74000");
    expect(screen.queryByTestId("close-open-tabs")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Close shift" }));
    expect(closeAsync.mock.calls[0][0]).not.toHaveProperty("handOver");
  });

  it("when Yetu finds tabs this till didn't know of, offers to hand them over too", async () => {
    closeAsync
      .mockRejectedValueOnce(problem("SHIFT_HAS_OPEN_ORDERS", "Orders on this shift are still open."))
      .mockResolvedValueOnce({ ...SHIFT, status: "CLOSED", countedCashMinor: 7_400_000, varianceMinor: 0, handedOverTabs: 1, handedOverOwedMinor: 1_180_000 });
    renderSheet();
    await count("74000");
    await userEvent.click(screen.getByRole("button", { name: "Close shift" }));
    expect(await screen.findByTestId("close-shift-error")).toHaveTextContent("Hand them over to the next shift, or take payment for them first.");
    await userEvent.click(screen.getByTestId("close-hand-over-found"));
    await userEvent.click(screen.getByRole("button", { name: "Hand over and close" }));
    expect(closeAsync.mock.calls[1][0]).toMatchObject({ handOver: true });
    expect(closeAsync.mock.calls[0][0]).not.toHaveProperty("handOver");
  });
});
