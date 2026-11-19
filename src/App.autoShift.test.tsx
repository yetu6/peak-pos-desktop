import * as React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { PaySheet } from "./register/PaySheet";
import { AUTOMATIC_OPEN_MAX_WAITS, AUTOMATIC_OPEN_RETRY_MS } from "./cash/autoShiftWords";
import { endClosingHere, forgetClosedShift, rememberClosedShift } from "./cash/closedShift";
import { setShiftReopening } from "./cash/shiftReopening";
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
const NYAMA_TAX = 183051;

interface ServerLine {
  id: string; productId: string; name: string; quantity: number; unitPriceMinor: number; taxMinor: number; totalMinor: number; status: "ADDED" | "SENT";
}
/** The one order Yetu holds in these tests, kept as Yetu keeps it: every change moves its version on. */
interface ServerOrder {
  id: string; orderNumber: string; dailyNumber: number; version: number; shiftId: string; status: string; serviceType: string;
  createdAt: string; closedAt: string | null; initiatedById: string; initiatedByName: string;
  subtotalMinor: number; discountMinor: number; discountKind: string; discountInput: number; taxMinor: number; totalMinor: number;
  paidMinor: number; remainingMinor: number; roundsSent: number; items: ServerLine[];
  payments: Array<{ id: string; paymentMethod: string; amountMinor: number; createdAt: string; recordedByName: string }>;
  /** Handed over by a closed shift and not yet taken over by the next (fbc-peak tabs.go). */
  waiting: boolean;
}

function newOrder(shiftId: string): ServerOrder {
  return {
    id: "order-9", orderNumber: "POS-9", dailyNumber: 9, version: 1, shiftId, status: "OPEN", serviceType: "DINE_IN",
    createdAt: "2026-11-15T20:00:00Z", closedAt: null, initiatedById: "staff-1", initiatedByName: "Amina",
    subtotalMinor: 0, discountMinor: 0, discountKind: "NONE", discountInput: 0, taxMinor: 0, totalMinor: 0, paidMinor: 0, remainingMinor: 0,
    roundsSent: 0, items: [], payments: [], waiting: false,
  };
}

const yetu = vi.hoisted(() => ({
  sentOrder: false,
  beforeClose: null as null | (() => Promise<void>),
  onClose: null as null | (() => void),
  shift: null as null | Record<string, unknown>,
  flag: true as boolean | undefined,
  orders: [] as Array<{ id: string; orderNumber: string }>,
  openAuto: vi.fn(),
  listeners: new Set<(event: unknown) => void>(),
  // Yetu's order, and its answer to each write: the code it refused with, or what it did.
  order: null as null | ServerOrder,
  calls: { getOrder: 0, add: [] as string[], send: [] as string[], tender: [] as string[] },
  // The next read of the order waits for this; its answer is still the order as it was when asked.
  holdGetOrder: null as null | Promise<void>,
  // How many of the next reads of the shift fail on the connection.
  shiftReadFails: 0,
  // Something another till does just before Yetu takes each add.
  beforeAdd: null as null | (() => void),
  mode: "POS",
  staffId: "staff-1",
}));

/** Yetu's refusals of a write on the order (operations.go): a tab waiting for the next shift, then an older version. */
function refusal(version: number) {
  const order = yetu.order;
  if (!order) return { error: { status: 404, code: "NOT_FOUND", title: "Not found" } };
  if (order.waiting) return problem("TAB_WAITING_FOR_SHIFT", "This tab was handed over to the next shift. Take it over on this till, then carry on.");
  if (version !== order.version) {
    return { error: { status: 409, code: "STALE_VERSION", title: "This was changed by someone else in the meantime.", detail: "The resource has moved on to a newer version than the one this request supplied." } };
  }
  return null;
}

function priced(order: ServerOrder): void {
  order.totalMinor = order.items.reduce((sum, line) => sum + line.totalMinor, 0);
  order.taxMinor = order.items.reduce((sum, line) => sum + line.taxMinor, 0);
  order.subtotalMinor = order.totalMinor - order.taxMinor;
  order.remainingMinor = Math.max(order.totalMinor - order.paidMinor, 0);
}

function nyamaLine(order: ServerOrder, quantity: number, status: ServerLine["status"]): ServerLine {
  return {
    id: `item-${order.items.length + 1}`, productId: NYAMA.id, name: NYAMA.name, quantity, unitPriceMinor: NYAMA.priceMinor,
    taxMinor: NYAMA_TAX * quantity, totalMinor: NYAMA.priceMinor * quantity, status,
  };
}

/** Another till rings one more Nyama Choma onto the order: Yetu's version moves on without this till. */
function anotherTillAdds(): void {
  const order = yetu.order!;
  order.items.push(nyamaLine(order, 1, "ADDED"));
  order.version += 1;
  priced(order);
}

/** Yetu closes the shift by itself at night and hands the open order over: version + 1 (tabs.go handOverTabs). */
function yetuClosesTheShift(): void {
  const order = yetu.order;
  const open = order !== null && order.status !== "CLOSED" && order.status !== "VOIDED";
  yetu.shift = { ...(yetu.shift ?? OPEN), status: "CLOSED", handedOverTabs: open ? 1 : 0 };
  if (order && open) {
    order.version += 1;
    order.waiting = true;
  }
}

/** The next shift opens and takes the waiting order over: version + 1 again (tabs.go takeOverTabs, via insertShift). */
function opens(shift: Record<string, unknown>) {
  yetu.shift = shift;
  const order = yetu.order;
  const taken = order?.waiting ? 1 : 0;
  if (order?.waiting) {
    order.waiting = false;
    order.shiftId = String(shift.id);
    order.version += 1;
  }
  return { data: { ...shift, openedAutomatically: true, takenOverTabs: taken } };
}

vi.mock("./lib/posApi", () => ({
  createPosApi: () => ({
    getCurrentShift: async () => {
      if (yetu.shiftReadFails > 0) {
        yetu.shiftReadFails -= 1;
        throw new TypeError("Failed to fetch");
      }
      return yetu.shift && yetu.shift.status === "OPEN" ? { data: yetu.shift } : { data: null, error: { status: 404 } };
    },
    getShift: async () => (yetu.shift ? { data: yetu.shift } : { data: null, error: { status: 404 } }),
    getCatalog: async () => ({
      data: {
        outletId: "outlet-1", outletName: "Bar", standardFloat: 0, opensShiftAutomatically: yetu.flag,
        categories: [{ id: "cat-1", outletId: "outlet-1", code: "M", name: "Mains", sortOrder: 1, isActive: true }],
        products: [{ ...NYAMA }],
      },
    }),
    createOrder: async (body: { shiftId: string }) => {
      yetu.order = newOrder(body.shiftId);
      return { data: structuredClone(yetu.order) };
    },
    addItem: async (_orderId: string, body: { quantity: number; version: number }) => {
      yetu.beforeAdd?.();
      const refused = refusal(body.version);
      yetu.calls.add.push(refused?.error.code ?? "added");
      if (refused) return refused;
      const order = yetu.order!;
      order.items.push(nyamaLine(order, body.quantity, yetu.sentOrder ? "SENT" : "ADDED"));
      if (yetu.sentOrder) {
        order.status = "SENT";
        order.roundsSent = 1;
      }
      order.version += 1;
      priced(order);
      return { data: structuredClone(order) };
    },
    previewPapers: async () => {
      throw new TypeError("Failed to fetch");
    },
    getOrder: async () => {
      yetu.calls.getOrder += 1;
      if (!yetu.order) return { data: null, error: { status: 404, code: "NOT_FOUND", title: "Not found" } };
      // Yetu reads the order when asked; a slow answer still carries what it read then.
      const read = structuredClone(yetu.order);
      const hold = yetu.holdGetOrder;
      yetu.holdGetOrder = null;
      if (hold) await hold;
      return { data: read };
    },
    sendOrder: async (_orderId: string, version: number) => {
      const refused = refusal(version);
      yetu.calls.send.push(refused?.error.code ?? "sent");
      if (refused) return refused;
      const order = yetu.order!;
      order.items = order.items.map((line) => ({ ...line, status: "SENT" }));
      order.status = "SENT";
      order.roundsSent += 1;
      order.version += 1;
      return { data: undefined };
    },
    recordTender: async (_orderId: string, body: { paymentMethod: string; amountMinor: number; version: number }) => {
      const refused = refusal(body.version);
      yetu.calls.tender.push(refused?.error.code ?? "recorded");
      if (refused) return refused;
      const order = yetu.order!;
      order.payments.push({ id: `pay-${order.payments.length + 1}`, paymentMethod: body.paymentMethod, amountMinor: body.amountMinor, createdAt: "2026-11-16T02:10:00Z", recordedByName: "Amina" });
      order.paidMinor += body.amountMinor;
      priced(order);
      if (order.remainingMinor <= 0) {
        order.status = "CLOSED";
        order.closedAt = "2026-11-16T02:10:00Z";
      }
      order.version += 1;
      return { data: { orderId: order.id } };
    },
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
  useDeviceSessionOptional: () => ({ session: { staffId: yetu.staffId }, roster: [] }),
  useDeviceSession: () => ({
    shell: "OPERATIONAL",
    phase: "ready",
    session: { token: `ops-${yetu.staffId}`, staffId: yetu.staffId, propertyId: "property-1", outletId: "outlet-1" },
    identity: { mode: yetu.mode, terminalName: "Main Bar" },
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

vi.mock("./pages/Kitchen", () => ({ Kitchen: () => <div data-testid="kitchen-screen" /> }));

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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

/** The till locks and someone signs in at the PIN screen: a new session, the shift screens start again. */
function signIn(staffId: string, permissions: string[]): void {
  yetu.staffId = staffId;
  setOperationalSession({
    token: `ops-${staffId}`, expiresAt: "2099-01-01T00:00:00Z", tenantId: "t", propertyId: "property-1", outletId: "outlet-1",
    terminalId: "terminal-1", staffId, assurance: "RESTRICTED", permissions, capabilities: ["POS"],
  });
}

function problem(code: string, detail: string) {
  return { error: { status: 409, code, detail, title: "Conflict" } };
}

const CATCHING_UP = problem("POS_DAY_CATCHING_UP", "Yetu is bringing the business date up to today. Try again in a minute.");

function emit(type: string, payload: Record<string, unknown>, aggregateId: string | null = null) {
  const event = { type, outletId: "outlet-1", aggregateId, payload } as unknown as RealtimeEnvelope;
  act(() => yetu.listeners.forEach((listener) => listener(event)));
}

const SENDER = ["pos.order.send", "pos.payment.record", "pos.shift.open", "pos.shift.close", "pos.report.manager"];
// A waiter takes orders and payments, and opens no shift by hand (fbc-peak #327).
const WAITER = ["pos.order.create", "pos.order.send", "pos.payment.record"];

beforeEach(() => {
  localStorage.clear();
  forgetClosedShift();
  endClosingHere();
  setShiftReopening(false);
  yetu.order = null;
  yetu.calls = { getOrder: 0, add: [], send: [], tender: [] };
  yetu.holdGetOrder = null;
  yetu.shiftReadFails = 0;
  yetu.beforeAdd = null;
  yetu.mode = "POS";
  yetu.staffId = "staff-1";
  yetu.shift = null;
  yetu.flag = true;
  yetu.orders = [];
  yetu.listeners.clear();
  yetu.onClose = null;
  yetu.sentOrder = false;
  yetu.beforeClose = null;
  yetu.openAuto.mockReset();
  yetu.openAuto.mockImplementation(async () => opens(OPEN));
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
    act(() => rememberClosedShift({ shift: OPEN as never, currency: "TZS", at: new Date() }, "staff-1"));
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

  it("'catching up' for longer than the cap stops with Yetu's words and Try again, even for a waiter; Try again asks once more", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    signIn("staff-1", WAITER);
    yetu.openAuto.mockResolvedValue(CATCHING_UP);
    renderApp();
    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));
    for (let wait = 1; wait <= AUTOMATIC_OPEN_MAX_WAITS; wait += 1) {
      await act(async () => void (await vi.advanceTimersByTimeAsync(AUTOMATIC_OPEN_RETRY_MS)));
      await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(wait + 1));
    }
    await waitFor(() => expect(screen.getByTestId("open-shift-screen")).toBeInTheDocument());
    // Never a loop: nothing more by itself.
    await act(async () => void (await vi.advanceTimersByTimeAsync(AUTOMATIC_OPEN_RETRY_MS * 5)));
    expect(yetu.openAuto).toHaveBeenCalledTimes(AUTOMATIC_OPEN_MAX_WAITS + 1);
    expect(screen.getByTestId("open-shift-error")).toHaveTextContent("Yetu is bringing the business date up to today.");

    // Try again starts the waits afresh: Yetu is still catching up once more, so the till waits again rather than stop.
    yetu.openAuto.mockReset();
    yetu.openAuto.mockResolvedValueOnce(CATCHING_UP).mockImplementation(async () => opens(OPEN));
    act(() => screen.getByRole("button", { name: "Try again" }).click());
    await waitFor(() => expect(screen.getByTestId("opening-shift-screen")).toHaveTextContent("Yetu is bringing the business date up to today."));
    await act(async () => void (await vi.advanceTimersByTimeAsync(AUTOMATIC_OPEN_RETRY_MS)));
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
    expect(yetu.openAuto).toHaveBeenCalledTimes(2);
  });

  it("when Yetu closes the shift underneath a running till, the next opens by itself and the open bill stays", async () => {
    yetu.shift = OPEN;
    yetu.orders = [{ id: TAB.id, orderNumber: TAB.orderNumber }];
    renderApp();
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toHaveTextContent("A-7"));
    expect(yetu.openAuto).not.toHaveBeenCalled();

    // Yetu closes the shift at night and hands the tab over; the next open takes it over.
    yetuClosesTheShift();
    yetu.openAuto.mockImplementation(async () => opens(NEXT));
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
    yetuClosesTheShift();
    emit("pos.shift.closed", { outletId: "outlet-1", automatic: true, handedOverTabs: 1 });

    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText("One moment: Yetu is opening the next shift.").length).toBeGreaterThan(0);
    // The menu says the same, never "open a shift".
    expect(screen.queryByText("Open a shift before taking orders.")).not.toBeInTheDocument();
    expect(screen.getByTestId("send-order")).toBeDisabled();
    expect(screen.queryByTestId("open-shift-screen")).not.toBeInTheDocument();
    expect(screen.queryByTestId("opening-shift-screen")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Nyama Choma/).length).toBeGreaterThan(0);

    await act(async () => answer(opens(NEXT)));
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
    yetuClosesTheShift();
    emit("pos.shift.closed", { outletId: "outlet-1", automatic: true, handedOverTabs: 1 }, OPEN.id);
    await waitFor(() => expect(screen.getByTestId("pay-reopening")).toHaveTextContent("One moment: Yetu is opening the next shift."));
    expect(screen.getByTestId("confirm-settle")).toBeDisabled();
    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));

    await act(async () => answer(opens(NEXT)));
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
    yetuClosesTheShift();
    emit("pos.shift.closed", { outletId: "outlet-1", automatic: true, handedOverTabs: 1 }, OPEN.id);
    await waitFor(() => expect(screen.getByTestId("paper-reopening")).toBeInTheDocument());
    expect(screen.getByTestId("paper-print")).toBeDisabled();
    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));

    await act(async () => answer(opens(NEXT)));
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

/** A moment for Yetu's answers (the mock's promises) to land. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));
const ticketLines = () => screen.queryAllByTestId("cart-Nyama Choma");
const STALE_WORDS = "This order changed on another till. We've reloaded it.";

/** On Sell with one Nyama Choma on the ticket, Yetu closes the shift at night and opens the next: the order's version is two on. */
async function nightReopenOnSell(beforeTheAnswer?: () => void) {
  let answer: (value: unknown) => void = () => undefined;
  yetu.openAuto.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
  yetuClosesTheShift();
  emit("pos.shift.closed", { outletId: "outlet-1", automatic: true, handedOverTabs: 1 }, OPEN.id);
  await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));
  beforeTheAnswer?.();
  await act(async () => answer(opens(NEXT)));
  await waitFor(() => expect(screen.queryByText("One moment: Yetu is opening the next shift.")).not.toBeInTheDocument());
}

describe("an open ticket carries on across the night's reopen (C1)", () => {
  it("Send after the reopen goes to the kitchen on the first press", async () => {
    yetu.shift = OPEN;
    renderApp();
    await userEvent.click(await screen.findByTestId("nav-new"));
    await userEvent.click(await screen.findByTestId("menu-Nyama Choma"));
    await waitFor(() => expect(screen.getByTestId("send-order")).toBeEnabled());
    expect(yetu.order?.version).toBe(2);

    await nightReopenOnSell();
    expect(yetu.order?.version).toBe(4);
    await settle();

    await userEvent.click(screen.getByTestId("send-order"));
    await userEvent.click(await screen.findByTestId("paper-print"));
    await waitFor(() => expect(yetu.order?.status).toBe("SENT"));
    expect(yetu.calls.send).toEqual(["sent"]);
    expect(screen.queryByText(new RegExp(STALE_WORDS))).not.toBeInTheDocument();
  });

  it("the first tap after the reopen lands on the ticket, even before the ticket's own read comes back", async () => {
    yetu.shift = OPEN;
    renderApp();
    await userEvent.click(await screen.findByTestId("nav-new"));
    await userEvent.click(await screen.findByTestId("menu-Nyama Choma"));
    await waitFor(() => expect(ticketLines()).toHaveLength(1));

    let release: () => void = () => undefined;
    const reads = yetu.calls.getOrder;
    // The ticket's read after the reopen is slow: the waiter taps before it is back.
    await nightReopenOnSell(() => (yetu.holdGetOrder = new Promise<void>((resolve) => (release = resolve))));
    await waitFor(() => expect(yetu.calls.getOrder).toBeGreaterThan(reads));

    await userEvent.click(screen.getByTestId("menu-Nyama Choma"));
    await waitFor(() => expect(yetu.order?.items).toHaveLength(2));
    await waitFor(() => expect(ticketLines()).toHaveLength(2));
    // The slow read, older than the add's answer, then lands: the ticket keeps the newer order.
    await act(async () => release());
    await settle();
    expect(ticketLines()).toHaveLength(2);
    expect(yetu.calls.add).toEqual(["added", "STALE_VERSION", "added"]);
  });

  it("one Take cash press after the reopen records the payment", async () => {
    yetu.shift = OPEN;
    yetu.sentOrder = true;
    renderApp();
    await userEvent.click(await screen.findByTestId("nav-new"));
    await userEvent.click(await screen.findByTestId("menu-Nyama Choma"));
    await userEvent.click(await screen.findByTestId("pay-order"));
    await waitFor(() => expect(screen.getByTestId("confirm-settle")).toBeEnabled());

    await nightReopenOnSell();
    await waitFor(() => expect(screen.queryByTestId("pay-reopening")).not.toBeInTheDocument());
    await settle();

    await userEvent.click(screen.getByTestId("confirm-settle"));
    await waitFor(() => expect(yetu.order?.status).toBe("CLOSED"));
    expect(yetu.calls.tender).toEqual(["recorded"]);
  });

  it("a Pay sheet whose page does not read the order again (Orders) takes Yetu's latest when the reopen ends", async () => {
    yetu.shift = OPEN;
    yetu.order = { ...newOrder(OPEN.id), status: "SENT", roundsSent: 1, version: 2 };
    yetu.order.items.push({ ...nyamaLine(yetu.order, 1, "SENT") });
    priced(yetu.order);
    const onPaid = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PaySheet order={structuredClone(yetu.order) as never} currency="TZS" onClose={() => undefined} onPaid={onPaid} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("confirm-settle")).toBeEnabled());

    act(() => setShiftReopening(true));
    yetuClosesTheShift();
    opens(NEXT);
    expect(yetu.order.version).toBe(4);
    act(() => setShiftReopening(false));
    await settle();

    await userEvent.click(screen.getByTestId("confirm-settle"));
    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1));
    expect(yetu.calls.tender).toEqual(["recorded"]);
  });

  it("a tap refused twice because the order keeps changing elsewhere is asked for once more only, and says so", async () => {
    yetu.shift = OPEN;
    renderApp();
    await userEvent.click(await screen.findByTestId("nav-new"));
    await userEvent.click(await screen.findByTestId("menu-Nyama Choma"));
    await waitFor(() => expect(ticketLines()).toHaveLength(1));
    yetu.beforeAdd = anotherTillAdds;

    await userEvent.click(screen.getByTestId("menu-Nyama Choma"));
    await waitFor(() => expect(screen.getByText("This order changed on another till, so the item wasn't added. Check the ticket, then tap it again.")).toBeInTheDocument());
    await settle();
    expect(yetu.calls.add).toEqual(["added", "STALE_VERSION", "STALE_VERSION"]);
    // The ticket shows Yetu's order: the other till's two lines with this till's first.
    expect(ticketLines()).toHaveLength(3);
  });

  it("a Send refused because another till changed the order reads it again, so the words are true and the next press sends", async () => {
    yetu.shift = OPEN;
    renderApp();
    await userEvent.click(await screen.findByTestId("nav-new"));
    await userEvent.click(await screen.findByTestId("menu-Nyama Choma"));
    await waitFor(() => expect(screen.getByTestId("send-order")).toBeEnabled());
    anotherTillAdds();

    await userEvent.click(screen.getByTestId("send-order"));
    await userEvent.click(await screen.findByTestId("paper-print"));
    await waitFor(() => expect(screen.getByText(new RegExp(STALE_WORDS))).toBeInTheDocument());
    // Reloaded, as the words say: the other till's line is on the ticket.
    await waitFor(() => expect(ticketLines()).toHaveLength(2));

    await userEvent.click(screen.getByTestId("send-order"));
    await userEvent.click(await screen.findByTestId("paper-print"));
    await waitFor(() => expect(yetu.order?.status).toBe("SENT"));
    expect(yetu.calls.send).toEqual(["STALE_VERSION", "sent"]);
  });
});

describe("a kitchen or bar display (I1)", () => {
  it.each(["KITCHEN_DISPLAY", "BAR_DISPLAY"])("a %s never asks Yetu to open a shift, at sign-in or when one closes", async (mode) => {
    yetu.mode = mode;
    renderApp();
    await waitFor(() => expect(screen.getByTestId("kitchen-screen")).toBeInTheDocument());
    await settle();
    expect(yetu.openAuto).not.toHaveBeenCalled();
    // A till's shift closing at night: the display still asks for nothing (Yetu would move every waiting bill onto it).
    emit("pos.shift.closed", { outletId: "outlet-1", automatic: true, handedOverTabs: 1 }, OPEN.id);
    await settle();
    expect(yetu.openAuto).not.toHaveBeenCalled();
    expect(screen.getByTestId("shell-state")).toHaveTextContent("OPERATIONAL");
  });
});

describe("a close by hand is the closer's own (I3)", () => {
  it("the same person back after a lock still sees the summary; a waiter signing in gets the shift opened by itself, once", async () => {
    yetu.shift = OPEN;
    const first = renderApp();
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("nav-manager"));
    await userEvent.click(await screen.findByTestId("open-close-shift"));
    await userEvent.type(await screen.findByTestId("counted-cash"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Check the count" }));
    await userEvent.click(await screen.findByTestId("close-shift"));
    await waitFor(() => expect(screen.getByTestId("closed-shift-summary")).toBeInTheDocument());
    first.unmount();

    // The till locked; the cashier who closed it signs back in.
    signIn("staff-1", SENDER);
    const again = renderApp();
    await waitFor(() => expect(screen.getByTestId("closed-shift-summary")).toBeInTheDocument());
    await settle();
    expect(yetu.openAuto).not.toHaveBeenCalled();
    again.unmount();

    // A waiter signs in instead: nothing of the cashier's close holds the till back.
    signIn("staff-2", WAITER);
    renderApp();
    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
    await settle();
    expect(yetu.openAuto).toHaveBeenCalledTimes(1);
  });
});

describe("a failed automatic open is never a dead end (I2)", () => {
  it("'catching up' keeps a waiter on 'Opening the shift', asking each minute until Yetu is ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    signIn("staff-1", WAITER);
    yetu.openAuto.mockResolvedValueOnce(CATCHING_UP).mockResolvedValueOnce(CATCHING_UP).mockResolvedValueOnce(CATCHING_UP);
    renderApp();
    await waitFor(() => expect(screen.getByTestId("opening-shift-screen")).toHaveTextContent("Yetu is bringing the business date up to today."));
    for (let ask = 2; ask <= 4; ask += 1) {
      await act(async () => void (await vi.advanceTimersByTimeAsync(AUTOMATIC_OPEN_RETRY_MS)));
      await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(ask));
      if (ask < 4) expect(screen.getByTestId("opening-shift-screen")).toHaveTextContent("Yetu is bringing the business date up to today.");
    }
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
    expect(screen.queryByTestId("open-shift-screen")).not.toBeInTheDocument();
  });

  it("can't reach Yetu: a waiter is told so, and the till asks again by itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    signIn("staff-1", WAITER);
    yetu.openAuto.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderApp();
    await waitFor(() => expect(screen.getByTestId("opening-shift-screen")).toHaveTextContent("Can't reach Yetu."));
    await act(async () => void (await vi.advanceTimersByTimeAsync(AUTOMATIC_OPEN_RETRY_MS)));
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
    expect(yetu.openAuto).toHaveBeenCalledTimes(2);
  });

  it("a refusal shows its words to a waiter too, with Try again that asks again", async () => {
    signIn("staff-1", WAITER);
    yetu.openAuto.mockResolvedValueOnce(problem("POS_SOMETHING_NEW", "Something Yetu has not told the till about."));
    renderApp();
    await waitFor(() => expect(screen.getByTestId("open-shift-error")).toHaveTextContent("The shift wasn't opened. Try again."));
    expect(screen.queryByTestId("open-shift-unavailable")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
    expect(yetu.openAuto).toHaveBeenCalledTimes(2);
  });

  it("an outlet that counts its cash tells a waiter so, and sends them to a cashier (no Try again)", async () => {
    signIn("staff-1", WAITER);
    yetu.openAuto.mockResolvedValue(problem("POS_SHIFT_COUNTED_OPEN", "This outlet counts its starting cash: a cashier opens the shift."));
    renderApp();
    await waitFor(() => expect(screen.getByTestId("open-shift-error")).toHaveTextContent("This outlet counts its starting cash: a cashier opens the shift."));
    expect(screen.getByTestId("open-shift-unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});

describe("till minors", () => {
  it("a shift gone at a poll (the closed event missed) keeps the order screen while the next opens", async () => {
    yetu.shift = OPEN;
    const { client } = renderApp();
    await userEvent.click(await screen.findByTestId("nav-new"));
    await userEvent.click(await screen.findByTestId("menu-Nyama Choma"));
    await waitFor(() => expect(screen.getByTestId("send-order")).toBeEnabled());

    let answer: (value: unknown) => void = () => undefined;
    yetu.openAuto.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    yetuClosesTheShift(); // no event reaches this till
    await act(() => client.invalidateQueries({ queryKey: ["pos", "shift", "current"] })); // the next read of the shift
    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("opening-shift-screen")).not.toBeInTheDocument();
    expect(ticketLines()).toHaveLength(1);
    expect(screen.getByTestId("send-order")).toBeDisabled();

    await act(async () => answer(opens(NEXT)));
    await waitFor(() => expect(screen.getByTestId("send-order")).toBeEnabled());
    expect(ticketLines()).toHaveLength(1);
  });

  it("after 'already open', a read of the shift that fails is tried again on the timer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let first = true;
    yetu.openAuto.mockImplementation(async () => {
      yetu.shift = OPEN; // this till's shift is open already
      if (first) yetu.shiftReadFails = 1; // and the read that follows fails on the connection, once
      first = false;
      return problem("POS_SHIFT_ALREADY_OPEN", "This till already has an open shift.");
    });
    renderApp();
    await waitFor(() => expect(yetu.openAuto).toHaveBeenCalledTimes(1));
    await settle();
    expect(screen.getByTestId("opening-shift-screen")).toBeInTheDocument();
    await act(async () => void (await vi.advanceTimersByTimeAsync(AUTOMATIC_OPEN_RETRY_MS)));
    await waitFor(() => expect(screen.getByTestId("active-orders-screen")).toBeInTheDocument());
  });
});
