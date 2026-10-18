import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { idleLockHeld } from "../lib/idleLock";
import { VoidOrderDialog } from "./VoidOrderDialog";
import type { POSOrder } from "../lib/posContracts";

const { voidOrderMutate, sessionRef, voidState, voidReset } = vi.hoisted(() => ({
  voidReset: vi.fn(),
  voidOrderMutate: vi.fn(
    (_vars: unknown, opts?: { onSuccess?: () => void; onError?: (error: Error) => void }) => opts?.onSuccess?.(),
  ),
  sessionRef: { roster: [] as Array<{ fullName: string; staffNumber: string }> },
  voidState: { error: null as unknown, isPending: false },
}));

vi.mock("../hooks/usePosData", () => ({
  useVoidOrder: () => ({ mutate: voidOrderMutate, reset: voidReset, ...voidState }),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSessionOptional: () => ({ session: { staffId: "staff-amina" }, roster: sessionRef.roster }),
}));

const ORDER: POSOrder = {
  id: "order-1",
  shiftId: "shift-1",
  orderNumber: "0142",
  dailyNumber: 42,
  createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  closedAt: null,
  payments: [],
  status: "SENT",
  serviceType: "DINE_IN",
  initiatedById: "staff-amina",
  initiatedByName: "Amina Hassan",
  subtotalMinor: 20_000,
  discountMinor: 0,
  discountKind: "NONE",
  discountInput: 0,
  taxMinor: 4_000,
  totalMinor: 2_400_000,
  paidMinor: 0,
  remainingMinor: 2_400_000,
  version: 4,
  items: [],
};

const ROSTER = [
  { fullName: "Amina Hassan", staffNumber: "staff-amina" },
  { fullName: "Grace Mushi", staffNumber: "staff-grace" },
];

async function typePin(digits: string) {
  for (const digit of digits) await userEvent.click(screen.getByTestId(`void-pin-key-${digit}`));
}

beforeEach(() => {
  voidOrderMutate.mockClear();
  sessionRef.roster = ROSTER;
  voidState.error = null;
  voidState.isPending = false;
});

describe("VoidOrderDialog", () => {
  it("needs a reason and a different supervisor's 6-digit PIN before voiding", async () => {
    render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
    const submit = screen.getByTestId("confirm-void-order");
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByTestId("void-reason"), "Wrong table");
    expect(screen.getByText("Void order 42 (TSh 24,000): Wrong table")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Amina Hassan/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    await typePin("12345");
    expect(submit).toBeDisabled();
    await typePin("6");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(voidOrderMutate).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-1", supervisorStaffId: "staff-grace", supervisorPin: "123456", reason: "Wrong table", version: 4 }),
      expect.anything(),
    );
  });

  it("needs a reason, even with an approval", async () => {
    render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    await typePin("123456");
    expect(screen.getByTestId("confirm-void-order")).toBeDisabled();
  });

  it("clears a refused PIN (keeping the supervisor), so a wrong PIN isn't sent again", async () => {
    voidOrderMutate.mockImplementationOnce((_vars: unknown, opts?: { onSuccess?: () => void; onError?: (error: Error) => void }) =>
      opts?.onError?.(new Error(JSON.stringify({ code: "FORBIDDEN", detail: "That approval was not accepted. A different person who may approve this, and is active at this property, must enter their own PIN. Several wrong PINs lock it for a while." }))),
    );
    render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await userEvent.type(screen.getByTestId("void-reason"), "Wrong table");
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    await typePin("123456");
    await userEvent.click(screen.getByTestId("confirm-void-order"));
    expect(screen.getByTestId("pin-dots")).toHaveAccessibleName("0 digits entered");
    expect(screen.getByRole("radio", { name: /Grace Mushi/ })).toBeChecked();
    expect(screen.getByTestId("confirm-void-order")).toBeDisabled();
    expect(voidOrderMutate).toHaveBeenCalledTimes(1);
  });

  it("asks again when the reason changes after approval", async () => {
    render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await userEvent.type(screen.getByTestId("void-reason"), "Wrong table");
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    await typePin("123456");
    await userEvent.type(screen.getByTestId("void-reason"), " 4");
    expect(screen.getByRole("radio", { name: /Grace Mushi/ })).not.toBeChecked();
    expect(screen.getByTestId("confirm-void-order")).toBeDisabled();
  });

  it("asks again when the order changes (a new version): a PIN typed for one version never voids another", async () => {
    const view = render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await userEvent.type(screen.getByTestId("void-reason"), "Wrong table");
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    await typePin("123456");
    expect(screen.getByTestId("confirm-void-order")).toBeEnabled();
    view.rerender(<VoidOrderDialog order={{ ...ORDER, version: 5, status: "PREPARING" }} currency="TZS" onClose={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /Grace Mushi/ })).not.toBeChecked();
    expect(screen.getByTestId("pin-dots")).toHaveAccessibleName("0 digits entered");
    expect(screen.getByTestId("confirm-void-order")).toBeDisabled();
    expect(screen.getByTestId("void-reason")).toHaveValue("Wrong table");
  });

  it("asks for the order again when Yetu says it changed on another till", async () => {
    const onStale = vi.fn();
    voidOrderMutate.mockImplementationOnce((_vars: unknown, opts?: { onSuccess?: () => void; onError?: (error: Error) => void }) =>
      opts?.onError?.(new Error(JSON.stringify({ code: "STALE_VERSION", detail: "resource has changed" }))),
    );
    render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} onStale={onStale} />);
    await userEvent.type(screen.getByTestId("void-reason"), "Wrong table");
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    await typePin("123456");
    await userEvent.click(screen.getByTestId("confirm-void-order"));
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it("with no staff list, the void can't be approved here and it says why", () => {
    sessionRef.roster = [];
    render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
    expect(screen.queryByRole("textbox", { name: /staff number/i })).not.toBeInTheDocument();
    expect(screen.getByText(/can't show its staff list right now/)).toBeInTheDocument();
  });

  it("says a refused void in words", () => {
    voidState.error = new Error(JSON.stringify({ code: "FORBIDDEN", detail: "That approval was not accepted. A different person who may approve this, and is active at this property, must enter their own PIN. Several wrong PINs lock it for a while." }));
    render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
    expect(within(screen.getByTestId("void-order-dialog")).getByRole("alert")).toHaveTextContent(
      "A different supervisor must approve the void. Their PIN wasn't accepted, or they can't approve voids.",
    );
  });

  it("keeps the till from locking while the void is with Yetu", () => {
    voidState.isPending = true;
    render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
    expect(idleLockHeld()).toBe(true);
  });
});

describe("VoidOrderDialog after too many attempts (429)", () => {
  it("says so and holds the next attempt until Yetu's wait is over", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    voidState.error = new Error(JSON.stringify({ type: "about:blank", title: "Too many requests.", status: 429, code: "RATE_LIMITED", detail: "Too many requests. Try again in 41 seconds.", request_id: "req-9", retryAfterSeconds: 41 }));
    render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} onVoided={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts. Wait a minute and try again.");
    await userEvent.type(screen.getByTestId("void-reason"), "Guest left");
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    await typePin("736251");
    expect(screen.getByTestId("confirm-void-order")).toBeDisabled();
    try {
      act(() => vi.advanceTimersByTime(41_000));
      expect(voidReset).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
