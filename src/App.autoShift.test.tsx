import { act, render, screen, waitFor } from "@testing-library/react";
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

const yetu = vi.hoisted(() => ({
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
      data: { outletId: "outlet-1", outletName: "Bar", categories: [], products: [], standardFloat: 0, opensShiftAutomatically: yetu.flag },
    }),
    openShiftAutomatically: (key: string) => yetu.openAuto(key),
    listOrderPage: async () => ({ data: { items: yetu.orders, nextCursor: null } }),
    getApprovers: async () => ({ data: { approvers: [] } }),
  }),
}));

vi.mock("./auth/DeviceSessionProvider", () => ({
  DeviceSessionProvider: ({ children }: { children: React.ReactNode }) => children,
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
    // Held in a ref-less way: the latest handler of every caller is enough here.
    yetu.listeners.add(onEvent);
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

function emit(type: string, payload: Record<string, unknown>) {
  const event = { type, outletId: "outlet-1", payload } as unknown as RealtimeEnvelope;
  act(() => yetu.listeners.forEach((listener) => listener(event)));
}

const SENDER = ["pos.order.send", "pos.shift.open"];

beforeEach(() => {
  localStorage.clear();
  forgetClosedShift();
  yetu.shift = null;
  yetu.flag = true;
  yetu.orders = [];
  yetu.listeners.clear();
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
});
