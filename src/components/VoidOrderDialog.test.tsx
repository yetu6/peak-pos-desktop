import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render as renderInDom, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { idleLockHeld } from "../lib/idleLock";
import { VoidOrderDialog } from "./VoidOrderDialog";
import type { POSOrder } from "../lib/posContracts";
import { giveReason } from "../../tests/reasons";
import { VOID_REASONS } from "../orders/ordersSettings";

// The outlet's reasons (useTillReasons): the till's own lists, unless a test sets the ones its managers keep.
const tillReasons = vi.hoisted(() => ({ kept: null as null | Record<string, string[]> }));
vi.mock("../fnb/useTillReasons", async () => {
  const { DISCOUNT_REASONS, VOID_REASONS, REFUND_REASONS } = await import("../orders/ordersSettings");
  const { CASH_IN_REASONS, CASH_OUT_REASONS } = await import("../cash/cashSettings");
  const own: Record<string, readonly string[]> = { discount: DISCOUNT_REASONS, void: VOID_REASONS, refund: REFUND_REASONS, cashIn: CASH_IN_REASONS, cashOut: CASH_OUT_REASONS };
  return { useTillReasons: (kind: string) => tillReasons.kept?.[kind] ?? own[kind] };
});

/** The app's query provider, fresh for each render: the approval sheets ask Yetu who may approve (F-249). */
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderInDom(ui, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

const { voidOrderMutate, sessionRef, voidState, voidReset, printAfter } = vi.hoisted(() => ({
  voidReset: vi.fn(),
  // fbc-peak 00125: what Yetu made for the order prints after the void (the kitchen's slips).
  printAfter: vi.fn(async (_orderId: string) => [{ ok: true }] as Array<{ ok: boolean; error?: string }>),
  voidOrderMutate: vi.fn(
    (_vars: unknown, opts?: { onSuccess?: () => void; onError?: (error: Error) => void }) => opts?.onSuccess?.(),
  ),
  sessionRef: { roster: [] as Array<{ fullName: string; staffNumber: string }>, staffId: "staff-amina" },
  voidState: { error: null as unknown, isPending: false },
}));

vi.mock("../hooks/usePosData", () => ({
  useOutletMoneySettings: () => ({ standardFloat: 0, quickCashNotes: [1000,2000,5000,10000] }),
  useVoidOrder: () => ({ mutate: voidOrderMutate, reset: voidReset, ...voidState }),
  useIdempotencyKey: () => ({ current: "key-1", next: () => "key-1" }),
  usePropertyId: () => "prop-1",
  usePrintAfter: () => printAfter,
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSessionOptional: () => ({ session: { staffId: sessionRef.staffId }, roster: sessionRef.roster }),
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
  tillReasons.kept = null;
  voidOrderMutate.mockClear();
  sessionRef.roster = ROSTER;
  sessionRef.staffId = "staff-amina";
  voidState.error = null;
  voidState.isPending = false;
});

describe("VoidOrderDialog", () => {
  // F-264 (to check, 2026-10-20): did an open sheet keep the person who opened
  // it as "You" after someone else signed in? A lock or Switch person closes
  // the shell (App.tsx); were a sheet still open, it follows who is signed in now.
  it("marks whoever is signed in now as You, not the person who opened it", async () => {
    const { rerender } = render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
    const you = () => screen.getAllByRole("radio").find((radio) => radio.textContent?.includes("You"))?.textContent;
    expect(you()).toContain("Amina Hassan");
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    expect(screen.getByText("Grace Mushi, enter your PIN")).toBeInTheDocument();

    sessionRef.staffId = "staff-grace";
    rerender(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
    expect(you()).toContain("Grace Mushi");
    expect(screen.getByRole("radio", { name: /Grace Mushi/ })).toBeDisabled();
    // Grace was chosen to approve; signed in, she is the one asking, and can't approve it herself.
    expect(screen.getByRole("alert")).toHaveTextContent("You can't approve your own request. Ask another supervisor.");
    expect(screen.queryByText("Grace Mushi, enter your PIN")).toBeNull();
  });

  it("offers the reasons the outlet's managers keep, when they keep their own", () => {
    tillReasons.kept = { void: ["Wrong table"] };
    render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
    const offered = within(screen.getByRole("radiogroup", { name: "Reason" })).getAllByRole("radio").map((radio) => radio.textContent);
    expect(offered).toEqual(["Wrong table", "Another reason"]);
  });

  it("offers the place's void reasons in one tap, and sends the words tapped", async () => {
    render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
    const reasons = within(screen.getByRole("radiogroup", { name: "Reason" }));
    expect(reasons.getAllByRole("radio").map((radio) => radio.textContent)).toEqual([...VOID_REASONS, "Another reason"]);
    await userEvent.click(reasons.getByRole("radio", { name: VOID_REASONS[0] }));
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    await typePin("123456");
    await userEvent.click(screen.getByTestId("confirm-void-order"));
    expect(voidOrderMutate).toHaveBeenCalledWith(expect.objectContaining({ reason: VOID_REASONS[0] }), expect.anything());
  });

  it("needs a reason and a different supervisor's 6-digit PIN before voiding", async () => {
    render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
    const submit = screen.getByTestId("confirm-void-order");
    expect(submit).toBeDisabled();
    await giveReason("void-reason", "Wrong table");
    expect(screen.getByText("Cancel order 42 (TSh 24,000): Wrong table")).toBeInTheDocument();
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
    await giveReason("void-reason", "Wrong table");
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
    await giveReason("void-reason", "Wrong table");
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    await typePin("123456");
    await giveReason("void-reason", " 4");
    expect(screen.getByRole("radio", { name: /Grace Mushi/ })).not.toBeChecked();
    expect(screen.getByTestId("confirm-void-order")).toBeDisabled();
  });

  it("asks again when the order changes (a new version): a PIN typed for one version never voids another", async () => {
    const view = render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
    await giveReason("void-reason", "Wrong table");
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    await typePin("123456");
    expect(screen.getByTestId("confirm-void-order")).toBeEnabled();
    view.rerender(<VoidOrderDialog order={{ ...ORDER, version: 5, status: "PREPARING" }} currency="TZS" onClose={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /Grace Mushi/ })).not.toBeChecked();
    expect(screen.getByTestId("pin-dots")).toHaveAccessibleName("0 digits entered");
    expect(screen.getByTestId("confirm-void-order")).toBeDisabled();
    expect(screen.getByTestId("void-reason-text")).toHaveValue("Wrong table");
  });

  it("asks for the order again when Yetu says it changed on another till", async () => {
    const onStale = vi.fn();
    voidOrderMutate.mockImplementationOnce((_vars: unknown, opts?: { onSuccess?: () => void; onError?: (error: Error) => void }) =>
      opts?.onError?.(new Error(JSON.stringify({ code: "STALE_VERSION", detail: "resource has changed" }))),
    );
    render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} onStale={onStale} />);
    await giveReason("void-reason", "Wrong table");
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    await typePin("123456");
    await userEvent.click(screen.getByTestId("confirm-void-order"));
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it("prints the kitchen's void slips once Yetu has voided it, and says when they don't print", async () => {
    const onPrintProblem = vi.fn();
    printAfter.mockResolvedValueOnce([{ ok: false, error: "The bar printer didn't answer." }]);
    render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} onPrintProblem={onPrintProblem} />);
    await giveReason("void-reason", "Wrong table");
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    await typePin("123456");
    await userEvent.click(screen.getByTestId("confirm-void-order"));
    expect(printAfter).toHaveBeenCalledWith("order-1");
    await waitFor(() => expect(onPrintProblem).toHaveBeenCalledWith(expect.stringContaining("The cancel slip didn't print: the bar printer didn't answer")));
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
      "A different supervisor must approve this. Their PIN wasn't accepted, or they can't approve cancellations.",
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
    await giveReason("void-reason", "Guest left");
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

// F-249: the void sheet at Bahari offered Zawadi, a cashier; Yetu refused her twice.
describe("VoidOrderDialog: only those who can approve voids (F-249)", () => {
  it("offers only those Yetu says can approve voids, and says who chooses when no one can", async () => {
    const { clearOperationalSession, setOperationalSession } = await import("../lib/operationalSession");
    setOperationalSession({ token: "t".repeat(40), expiresAt: "2099-01-01T00:00:00Z", tenantId: "t1", propertyId: "p1", outletId: "o1", terminalId: "d1", staffId: "staff-amina", assurance: "RESTRICTED" });
    sessionRef.roster = [...ROSTER, { fullName: "Zawadi Said", staffNumber: "staff-zawadi" }];
    let approvers: Array<{ staffId: string; approves: string[] }> = [
      { staffId: "staff-grace", approves: ["VOID"] },
      { staffId: "staff-zawadi", approves: ["REFUND"] },
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/v1/pos/approvers")
        ? new Response(JSON.stringify({ approvers }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } }),
    ));
    try {
      const view = render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
      // Zawadi approves refunds, not voids; Amina, who asks, approves nothing.
      await waitFor(() => expect(screen.queryByRole("radio", { name: /Zawadi Said/ })).toBeNull());
      expect(screen.getByRole("radio", { name: /Grace Mushi/ })).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: /Amina Hassan/ })).toBeNull();
      view.unmount();

      approvers = [];
      render(<VoidOrderDialog order={ORDER} currency="TZS" onClose={vi.fn()} />);
      expect(await screen.findByTestId("approval-no-one")).toHaveTextContent(
        "No one is set to approve cancellations here yet. The owner chooses in Team rules.",
      );
    } finally {
      clearOperationalSession();
      vi.unstubAllGlobals();
    }
  });
});
