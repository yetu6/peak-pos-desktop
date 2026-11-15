import * as React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { forgetClosedShift, rememberClosedShift } from "./cash/closedShift";
import { setOperationalSession } from "./lib/operationalSession";
import type { RealtimeEnvelope } from "./realtime/RealtimeEnvelope";

/**
 * Automatic shifts (Task 12): with the outlet's setting on, the till asks Yetu
 * to open the shift by itself instead of asking a cashier for a float, and
 * opens the next one by itself when Yetu closes the shift underneath it.
 * Real hooks and real screens; only Yetu (posApi) and the socket are faked.
 */

const OPEN = { id: "shift-1", status: "OPEN", openingCashMinor: 0, expectedCashMinor: 0, businessDate: "2026-11-15", openedAt: "2026-11-15T08:00:00Z" };
const NEXT = { ...OPEN, id: "shift-2", openedAt: "2026-11-16T02:00:00Z", businessDate: "2026-11-16", takenOverTabs: 1 };
const TAB = { id: "order-1", status: "OPEN", orderNumber: "A-7" };

const NYAMA = { id: "00000000-0000-0000-0000-000000000001", categoryId: "cat-1", code: "NC", name: "Nyama Choma", priceMinor: 1200000, currency: "TZS", taxRateBp: 1800, isAvailable: true };
const CART = {
  id: "order-9", orderNumber: "POS-9", dailyNumber: 9, version: 2, shiftId: "shift-1", status: "OPEN", serviceType: "DINE_IN",
  createdAt: "2026-11-15T20:00:00Z", closedAt: null, payments: [], initiatedById: "staff-1", initiatedByName: "Amina",
  subtotalMinor: 1016949, discountMinor: 0, discountKind: "NONE", discountInput: 0, taxMinor: 183051, totalMinor: 1200000, paidMinor: 0, remainingMinor: 1200000,
  items: [{ id: "item-1", productId: NYAMA.id, name: "Nyama Choma", quantity: 1, unitPriceMinor: 1200000, taxMinor: 183051, totalMinor: 1200000, status: "ADDED" }],
};

const yetu = vi.hoisted(() => ({
  sentOrder: false,
  beforeClose: null as null | (() => Promise<void>),
  onClose: null as null | (() => void),
  shift: null as null | Record<string, unknown>,
  flag: true as boolean | undefined,
  orders: [] as Array<{ id: string; orderNumber: string }>,
  openAuto: vi.fn(),
  listeners: new Set<(event: unknown) => void>(),
}));

vi.mock("./lib/posApi", () => ({
  createPosApi: () => ({
    getCurrentShift: async () =>
      yetu.shift && yetu.shift.status === "OPEN" ? { data: yetu.shift } : { data: null, error: { status: 404 } },
    getShift: async () => (yetu.shift ? { data: yetu.shift } : { data: null, error: { status: 404 } }),
    getCatalog: async () => ({
      data: {
        outletId: "outlet-1", outletName: "Bar", standardFloat: 0, opensShiftAutomatically: yetu.flag,
        categories: [{ id: "cat-1", outletId: "outlet-1", code: "M", name: "Mains", sortOrder: 1, isActive: true }],
        products: [{ ...NYAMA }],
      },
    }),
    createOrder: async () => ({ data: { ...CART, items: [], totalMinor: 0, remainingMinor: 0 } }),
    addItem: async () => ({ data: yetu.sentOrder ? { ...CART, status: "SENT", roundsSent: 1, items: [{ ...CART.items[0], status: "SENT" }] } : CART }),
    previewPapers: async () => {
      throw new TypeError("Failed to fetch");
    },
    getOrder: async () => ({ data: CART }),
    closeShift: async () => {
      await yetu.beforeClose?.();
      yetu.shift = { ...OPEN, status: "CLOSED", countedCashMinor: 0, varianceMinor: 0 };
      // Yetu's closed event reaches the till before the answer to the close does.
      yetu.onClose?.();
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { data: yetu.shift };
    },
    openShiftAutomatically: (key: string) => yetu.openAuto(key),
    listOrderPage: async () => ({ data: { items: yetu.orders, nextCursor: null } }),
    getApprovers: async () => ({ data: { approvers: [] } }),
  }),
}));

vi.mock("./auth/DeviceSessionProvider", () => ({
  DeviceSessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useDeviceSessionOptional: () => ({ session: { staffId: "staff-1" }, roster: [] }),
  useDeviceSession: () => ({
    shell: "OPERATIONAL",
    phase: "ready",
    session: { token: "ops", staffId: "staff-1", propertyId: "property-1", outletId: "outlet-1" },
    identity: { mode: "POS", terminalName: "Main Bar" },
    switchStaff: vi.fn(),
    keyStorageWarning: null,
    roster: [],
  }),
}));

vi.mock("./realtime/RealtimeProvider", () => ({
  RealtimeProvider: ({ children }: { children: React.ReactNode }) => children,
  useRealtime: () => ({ state: { phase: "connected" } }),
  useRealtimeEvents: (_target: unknown, onEvent: (event: unknown) => void) => {
    // Like the real one: the newest handler answers, and the listener goes when its caller does.
    const latest = React.useRef(onEvent);
    latest.current = onEvent;
    React.useEffect(() => {
      const listener = (event: unknown) => latest.current(event);
      yetu.listeners.add(listener);
      return () => void yetu.listeners.delete(listener);
    }, []);
  },
}));

vi.mock("./pages/ActiveOrders", async () => {
  const { useActiveOrders } = await import("./hooks/usePosData");
  return {
    ActiveOrders: () => {
      const { data } = useActiveOrders();
      return <div data-testid="active-orders-screen">{(data ?? []).map((order) => order.orderNumber).join(",")}</div>;
    },
  };
});

function renderApp() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <App />
    </QueryClientProvider>,
  );
}

function problem(code: string, detail: string) {
  return { error: { status: 409, code, detail, title: "Conflict" } };
}

function emit(type: string, payload: Record<string, unknown>, aggregateId: string | null = null) {
  const event = { type, outletId: "outlet-1", aggregateId, payload } as unknown as RealtimeEnvelope;
  act(() => yetu.listeners.forEach((listener) => listener(event)));
}

const SENDER = ["pos.order.send", "pos.payment.record", "pos.shift.open", "pos.shift.close", "pos.report.manager"];

beforeEach(() => {
  localStorage.clear();
  forgetClosedShift();
  yetu.shift = null;
  yetu.flag = true;
  yetu.orders = [];
  yetu.listeners.clear();
  yetu.onClose = null;
  yetu.sentOrder = false;
  yetu.beforeClose = null;
  yetu.openAuto.mockReset();
  yetu.openAuto.mockImplementation(async () => {
    yetu.shift = OPEN;
    return { data: { ...OPEN, openedAutomatically: true, takenOverTabs: 0 } };
  });
  setOperationalSession({
    token: "ops", expiresAt: "2099-01-01T00:00:00Z", tenantId: "t", propertyId: "property-1", outletId: "outlet-1",
    terminalId: "terminal-1", staffId: "staff-1", assurance: "RESTRICTED", permissions: SENDER, capabilities: ["POS"],
  });
});

afterEach(() => {
  vi.useRealTimers();
  setOperationalSession(null);
});

describe("the shift opens by itself", () => {
  it("asks Yetu once, says so, and lands on the order screen without the float screen", async () => {
    renderApp();
    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(yetu.shift).toBe(OPEN));
    await waitFor(() => expect(screen.getByTestId("shell-state")).toHaveTextContent("OPERATIONAL"));
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
    expect(yetu.openAuto).toHaveBeenCalledTimes(1);
    expect(yetu.openAuto.mock.calls[0][0]).toMatch(/[0-9a-f-]{36}/);
    expect(screen.queryByTestId("open-shift-screen")).not.toBeInTheDocument();
  });

  it("shows 'Opening the shift' while Yetu answers, never the float screen", async () => {
    let answer: (value: unknown) => void = () => undefined;
    yetu.openAuto.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    renderApp();
    await waitFor(() => expect(screen.getByTestId("opening-shift-screen")).toHaveTextContent("Opening the shift"));
    expect(screen.queryByTestId("open-shift-screen")).not.toBeInTheDocument();
    yetu.shift = OPEN;
    await act(async () => answer({ data: { ...OPEN, openedAutomatically: true, takenOverTabs: 0 } }));
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
  });

  it("with the setting off, today's Open shift screen appears and Yetu is not asked", async () => {
    yetu.flag = false;
    renderApp();
    await waitFor(() => expect(screen.getByTestId("open-shift-screen")).toBeInTheDocument());
    expect(yetu.openAuto).not.toHaveBeenCalled();
  });

  it("a role that takes no orders is never asked for, and sees today's screen", async () => {
    setOperationalSession({ ...(await import("./lib/operationalSession")).getOperationalSession()!, permissions: ["pos.report.manager"] });
    renderApp();
    await waitFor(() => expect(screen.getByTestId("open-shift-screen")).toBeInTheDocument());
    expect(yetu.openAuto).not.toHaveBeenCalled();
  });

  it("an outlet that counts its starting cash falls back to Open shift with Yetu's words", async () => {
    yetu.openAuto.mockResolvedValue(problem("POS_SHIFT_COUNTED_OPEN", "This outlet counts its starting cash: a cashier opens the shift."));
    renderApp();
    await waitFor(() => expect(screen.getByTestId("open-shift-screen")).toBeInTheDocument());
    expect(screen.getByTestId("open-shift-error")).toHaveTextContent("This outlet counts its starting cash: a cashier opens the shift.");
    expect(yetu.openAuto).toHaveBeenCalledTimes(1);
  });

  it("asks once for an absence of a shift, even when the till's state flips back and forth", async () => {
    yetu.openAuto.mockResolvedValue(problem("POS_SHIFT_COUNTED_OPEN", "This outlet counts its starting cash: a cashier opens the shift."));
    renderApp();
    await waitFor(() => expect(screen.getByTestId("open-shift-screen")).toBeInTheDocument());
    // A result of a close is shown, then put away (Switch person): the till is eligible again, but must not ask again.
    act(() => rememberClosedShift({ shift: OPEN as never, currency: "TZS", at: new Date() }));
    act(() => forgetClosedShift());
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(yetu.openAuto).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("open-shift-screen")).toBeInTheDocument();
  });

  it("'already open' only reads the shift again, and never loops", async () => {
    yetu.openAuto.mockImplementation(async () => {
      yetu.shift = OPEN; // another till opened it a moment ago
      return problem("POS_SHIFT_ALREADY_OPEN", "This till already has an open shift.");
    });
    renderApp();
    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(yetu.openAuto).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("open-shift-screen")).not.toBeInTheDocument();
  });

  it("'catching up' shows Yetu's words, then tries once more after the wait", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    yetu.openAuto.mockResolvedValueOnce(problem("POS_DAY_CATCHING_UP", "Yetu is bringing the business date up to today. Try again in a minute."));
    renderApp();
    await waitFor(() => expect(screen.getByTestId("opening-shift-screen")).toHaveTextContent("Yetu is bringing the business date up to today."));
    expect(yetu.openAuto).toHaveBeenCalledTimes(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(59_000)));
    expect(yetu.openAuto).toHaveBeenCalledTimes(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
    expect(yetu.openAuto).toHaveBeenCalledTimes(2);
  });

  it("'catching up' twice stops after the one retry and shows Open shift", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    yetu.openAuto.mockResolvedValue(problem("POS_DAY_CATCHING_UP", "Yetu is bringing the business date up to today. Try again in a minute."));
    renderApp();
    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));
    await act(async () => void (await vi.advanceTimersByTimeAsync(61_000)));
    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(2));
    await act(async () => void (await vi.advanceTimersByTimeAsync(300_000)));
    expect(yetu.openAuto).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("open-shift-screen")).toBeInTheDocument();
  });

  it("when Yetu closes the shift underneath a running till, the next opens by itself and the open bill stays", async () => {
    yetu.shift = OPEN;
    yetu.orders = [{ id: TAB.id, orderNumber: TAB.orderNumber }];
    renderApp();
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toHaveTextContent("A-7"));
    expect(yetu.openAuto).not.toHaveBeenCalled();

    // Yetu closes the shift at night and hands the tab over; the next open takes it over.
    yetu.shift = { ...OPEN, status: "CLOSED", handedOverTabs: 1 };
    yetu.openAuto.mockImplementation(async () => {
      yetu.shift = NEXT;
      return { data: { ...NEXT, openedAutomatically: true } };
    });
    emit("pos.shift.closed", { outletId: "outlet-1", automatic: true, handedOverTabs: 1 });

    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toHaveTextContent("A-7"));
    expect(screen.queryByTestId("open-shift-screen")).not.toBeInTheDocument();
    // A second closing event later opens one more, still one at a time.
    yetu.shift = { ...NEXT, status: "CLOSED" };
    emit("pos.shift.closed", { outletId: "outlet-1", automatic: true, handedOverTabs: 1 });
    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(2));
  });
  it("a manual close here is never reopened under its own summary, even when Yetu's closed event comes first", async () => {
    yetu.shift = OPEN;
    yetu.onClose = () => emit("pos.shift.closed", { outletId: "outlet-1" });
    renderApp();
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("nav-manager"));
    await userEvent.click(await screen.findByTestId("open-close-shift"));
    await userEvent.type(await screen.findByTestId("counted-cash"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Check the count" }));
    await userEvent.click(await screen.findByTestId("close-shift"));
    await waitFor(() => expect(screen.getByTestId("closed-shift-summary")).toBeInTheDocument());
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(yetu.openAuto).not.toHaveBeenCalled();
    expect(screen.getByTestId("open-shift-screen")).toBeInTheDocument();
    expect(screen.getByTestId("closed-shift-summary")).toBeInTheDocument();
  });

  it("keeps the order screen, its cart and open sheets while the next shift opens, with Send waiting", async () => {
    yetu.shift = OPEN;
    renderApp();
    await userEvent.click(await screen.findByTestId("nav-new"));
    await userEvent.click(await screen.findByTestId("menu-Nyama Choma"));
    await waitFor(() => expect(screen.getByTestId("send-order")).toBeEnabled());
    expect(screen.getAllByText(/Nyama Choma/).length).toBeGreaterThan(0);

    let answer: (value: unknown) => void = () => undefined;
    yetu.openAuto.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    yetu.shift = { ...OPEN, status: "CLOSED", handedOverTabs: 1 };
    emit("pos.shift.closed", { outletId: "outlet-1", automatic: true, handedOverTabs: 1 });

    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));
    expect(screen.getByText("One moment: Yetu is opening the next shift.")).toBeInTheDocument();
    expect(screen.getByTestId("send-order")).toBeDisabled();
    expect(screen.queryByTestId("open-shift-screen")).not.toBeInTheDocument();
    expect(screen.queryByTestId("opening-shift-screen")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Nyama Choma/).length).toBeGreaterThan(0);

    yetu.shift = NEXT;
    await act(async () => answer({ data: { ...NEXT, openedAutomatically: true } }));
    await waitFor(() => expect(screen.queryByText("One moment: Yetu is opening the next shift.")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("send-order")).toBeEnabled());
    expect(screen.getAllByText(/Nyama Choma/).length).toBeGreaterThan(0);
  });

  it("a reopen Yetu refuses falls back to today's screen", async () => {
    yetu.shift = OPEN;
    renderApp();
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
    yetu.openAuto.mockResolvedValue(problem("POS_SHIFT_COUNTED_OPEN", "This outlet counts its starting cash: a cashier opens the shift."));
    yetu.shift = { ...OPEN, status: "CLOSED" };
    emit("pos.shift.closed", { outletId: "outlet-1", automatic: true, handedOverTabs: 0 });
    await waitFor(() => expect(screen.getByTestId("open-shift-screen")).toBeInTheDocument());
    expect(screen.getByTestId("open-shift-error")).toHaveTextContent("a cashier opens the shift");
  });

  it("a shift that appears before the minute is up cancels the second ask", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    yetu.openAuto.mockResolvedValueOnce(problem("POS_DAY_CATCHING_UP", "Yetu is bringing the business date up to today. Try again in a minute."));
    renderApp();
    await waitFor(() => expect(screen.getByTestId("opening-shift-screen")).toHaveTextContent("Yetu is bringing the business date"));
    // Another till opened it meanwhile.
    yetu.shift = OPEN;
    emit("pos.shift.opened", { outletId: "outlet-1" });
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
    await act(async () => void (await vi.advanceTimersByTimeAsync(120_000)));
    expect(yetu.openAuto).toHaveBeenCalledTimes(1);
  });

  it("listeners go with their screens: one closing event is one handler's one reopen", async () => {
    yetu.shift = OPEN;
    renderApp();
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
    const before = yetu.listeners.size;
    expect(before).toBeGreaterThan(0);
    yetu.shift = { ...OPEN, status: "CLOSED" };
    emit("pos.shift.closed", { outletId: "outlet-1", automatic: true, handedOverTabs: 0 });
    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(yetu.openAuto).toHaveBeenCalledTimes(1);
    expect(yetu.listeners.size).toBe(before);
  });
  it("a closed event for an OLD shift, when the next is already current, keeps nothing waiting", async () => {
    yetu.shift = NEXT; // the till read the new shift (poll, reconnect) before the old one's event came
    renderApp();
    await userEvent.click(await screen.findByTestId("nav-new"));
    await userEvent.click(await screen.findByTestId("menu-Nyama Choma"));
    await waitFor(() => expect(screen.getByTestId("send-order")).toBeEnabled());
    emit("pos.shift.closed", { outletId: "outlet-1", automatic: true, handedOverTabs: 1 }, OPEN.id);
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(screen.queryByText("One moment: Yetu is opening the next shift.")).not.toBeInTheDocument();
    expect(screen.getByTestId("send-order")).toBeEnabled();
    expect(yetu.openAuto).not.toHaveBeenCalled();
  });

  it("an open Pay sheet cannot confirm while the next shift opens, and can after", async () => {
    yetu.shift = OPEN;
    yetu.sentOrder = true;
    renderApp();
    await userEvent.click(await screen.findByTestId("nav-new"));
    await userEvent.click(await screen.findByTestId("menu-Nyama Choma"));
    await userEvent.click(await screen.findByTestId("pay-order"));
    await waitFor(() => expect(screen.getByTestId("confirm-settle")).toBeEnabled());

    let answer: (value: unknown) => void = () => undefined;
    yetu.openAuto.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    yetu.shift = { ...OPEN, status: "CLOSED" };
    emit("pos.shift.closed", { outletId: "outlet-1", automatic: true, handedOverTabs: 1 }, OPEN.id);
    await waitFor(() => expect(screen.getByTestId("pay-reopening")).toHaveTextContent("One moment: Yetu is opening the next shift."));
    expect(screen.getByTestId("confirm-settle")).toBeDisabled();
    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));

    yetu.shift = NEXT;
    await act(async () => answer({ data: { ...NEXT, openedAutomatically: true } }));
    await waitFor(() => expect(screen.queryByTestId("pay-reopening")).not.toBeInTheDocument());
    expect(screen.getByTestId("confirm-settle")).toBeEnabled();
  });

  it("an open paper preview cannot print while the next shift opens, and can after", async () => {
    yetu.shift = OPEN;
    renderApp();
    await userEvent.click(await screen.findByTestId("nav-new"));
    await userEvent.click(await screen.findByTestId("menu-Nyama Choma"));
    await userEvent.click(await screen.findByTestId("send-order"));
    await waitFor(() => expect(screen.getByTestId("paper-print")).toBeEnabled());

    let answer: (value: unknown) => void = () => undefined;
    yetu.openAuto.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    yetu.shift = { ...OPEN, status: "CLOSED" };
    emit("pos.shift.closed", { outletId: "outlet-1", automatic: true, handedOverTabs: 1 }, OPEN.id);
    await waitFor(() => expect(screen.getByTestId("paper-reopening")).toBeInTheDocument());
    expect(screen.getByTestId("paper-print")).toBeDisabled();
    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));

    yetu.shift = NEXT;
    await act(async () => answer({ data: { ...NEXT, openedAutomatically: true } }));
    await waitFor(() => expect(screen.queryByTestId("paper-reopening")).not.toBeInTheDocument());
    expect(screen.getByTestId("paper-print")).toBeEnabled();
  });

  it("a shift read again with a changed shift during a manual close does not end the close's guard", async () => {
    yetu.shift = OPEN;
    yetu.onClose = () => emit("pos.shift.closed", { outletId: "outlet-1" });
    renderApp();
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
    // Before the close lands, a poll reads the same shift as a changed object.
    yetu.beforeClose = async () => {
      yetu.shift = { ...OPEN, openedAt: "2026-11-15T08:00:01Z" };
      emit("pos.shift.opened", { outletId: "outlet-1" });
      await new Promise((resolve) => setTimeout(resolve, 80));
    };
    await userEvent.click(screen.getByTestId("nav-manager"));
    await userEvent.click(await screen.findByTestId("open-close-shift"));
    await userEvent.type(await screen.findByTestId("counted-cash"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Check the count" }));
    await userEvent.click(await screen.findByTestId("close-shift"));
    await waitFor(() => expect(screen.getByTestId("closed-shift-summary")).toBeInTheDocument());
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(yetu.openAuto).not.toHaveBeenCalled();
  });
});
