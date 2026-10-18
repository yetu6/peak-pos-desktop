import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RealtimeClient } from "../realtime/RealtimeClient";
import { RealtimeProvider } from "../realtime/RealtimeProvider";
import { ActiveOrders } from "./ActiveOrders";
import { ORDERS_REFRESH_SECONDS } from "../orders/ordersSettings";
import { idleLockHeld } from "../lib/idleLock";
import { clockTime } from "../lib/words";
import { clearOperationalSession, setOperationalSession } from "../lib/operationalSession";
import type { POSCatalog, POSOrder, POSReceipt, POSShift, POSStationTicket } from "../lib/posContracts";

vi.mock("../lib/env", () => ({
  devIdentityFromEnv: () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    propertyId: "property-1",
    outletId: "outlet-1",
  }),
}));

type Result = { data?: unknown; error?: unknown };

const ordersStore = new Map<string, POSOrder>();
const ticketsStore: POSStationTicket[] = [];
const receiptsStore = new Map<string, POSReceipt>();
let catalogStore: POSCatalog;

const SHIFT: POSShift = {
  id: "shift-1",
  status: "OPEN",
  openingCashMinor: 5_000_000,
  expectedCashMinor: 5_000_000,
  businessDate: new Date().toISOString().slice(0, 10),
  openedAt: new Date().toISOString(),
};

const spies = vi.hoisted(() => ({
  // Yetu's two views, one page each (fbc-peak orders_list.go): open = not paid or voided; paid = paid that day.
  listOrderPage: vi.fn(async ({ view }: { view: "open" | "paid"; businessDate?: string; cursor?: string }): Promise<Result> => ({
    data: {
      items: Array.from(ordersStore.values()).filter((order) =>
        view === "paid" ? order.status === "CLOSED" : order.status !== "CLOSED" && order.status !== "VOIDED",
      ),
      nextCursor: null,
    },
    error: null,
  })),
  getOrder: vi.fn(async (orderId: string): Promise<Result> => {
    const order = ordersStore.get(orderId);
    return order ? { data: order, error: null } : { data: undefined, error: { code: "NOT_FOUND" } };
  }),
  sendOrder: vi.fn(async (..._args: unknown[]): Promise<Result> => ({ data: undefined, error: null })),
  // Yetu answers a removal with the order as it is now (operations.go RemoveItem).
  removeItem: vi.fn(async (orderId: string, itemId: string, ..._rest: unknown[]): Promise<Result> => {
    const order = ordersStore.get(orderId)!;
    const updated = { ...order, version: order.version + 1, items: order.items.filter((item) => item.id !== itemId) };
    ordersStore.set(orderId, updated);
    return { data: updated, error: null };
  }),
  getCatalog: vi.fn(async (): Promise<Result> => ({ data: catalogStore, error: null })),
  listStationTickets: vi.fn(async (): Promise<Result> => ({ data: { items: ticketsStore }, error: null })),
  getCurrentShift: vi.fn(async (): Promise<Result> => ({ data: SHIFT, error: null })),
  getShift: vi.fn(async (): Promise<Result> => ({ data: SHIFT, error: null })),
  getReceipt: vi.fn(async (orderId: string): Promise<Result> => ({ data: receiptsStore.get(orderId), error: null })),
  voidOrder: vi.fn(async (..._args: unknown[]): Promise<Result> => ({ data: undefined, error: null })),
  reprintReceipt: vi.fn(async (orderId: string, ..._rest: unknown[]): Promise<Result> => {
    const receipt = receiptsStore.get(orderId)!;
    receiptsStore.set(orderId, { ...receipt, reprintCount: receipt.reprintCount + 1 });
    return { data: { ...receipt, id: `copy-${receipt.reprintCount + 1}` }, error: null };
  }),
  // S8a: Yetu's copies of a round's kitchen tickets.
  reprintKitchenTickets: vi.fn(async (..._args: unknown[]): Promise<Result> => ({ data: { roundNumber: 2, printJobs: [] }, error: null })),
  processPendingPrintJobs: vi.fn(async (..._args: unknown[]): Promise<{ ok: boolean; error?: string }[]> => [{ ok: false, error: "No printer is configured" }]),
}));

function catalogFixture(currency: string): POSCatalog {
  return {
    outletId: "outlet-1",
    outletName: "Main restaurant",
    categories: [],
    products: [{ id: "p1", code: "LUNCH", name: "Lunch", priceMinor: 1000, currency, taxRateBp: 1800, isAvailable: true }],
  };
}

vi.mock("../lib/posApi", () => ({
  createPosApi: () => ({
    listOrderPage: spies.listOrderPage,
    getOrder: spies.getOrder,
    sendOrder: spies.sendOrder,
    removeItem: spies.removeItem,
    getCatalog: spies.getCatalog,
    listStationTickets: spies.listStationTickets,
    getCurrentShift: spies.getCurrentShift,
    getShift: spies.getShift,
    getReceipt: spies.getReceipt,
    reprintReceipt: spies.reprintReceipt,
    reprintKitchenTickets: spies.reprintKitchenTickets,
    voidOrder: spies.voidOrder,
  }),
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSessionOptional: () => ({
    session: { staffId: "staff-1" },
    roster: [
      { fullName: "Amina Hassan", staffNumber: "staff-1" },
      { fullName: "Grace Mushi", staffNumber: "staff-2" },
    ],
  }),
}));

vi.mock("../lib/printJobs", () => ({
  processPendingPrintJobs: spies.processPendingPrintJobs,
}));

// This till's printer settings (Manager, Printers), as the till app holds them.
const tillPrinters = vi.hoisted(() => ({ kitchenTickets: true }));
vi.mock("../print/printerStore", () => ({
  loadPrinterSettings: async () => ({ kitchenTickets: tillPrinters.kitchenTickets, kitchen: null, stations: {} }),
  printRawToPrinter: async () => undefined,
}));

class FakeSocket {
  binaryType = "blob";
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  send(data: string | ArrayBuffer): void {
    this.sent.push(String(data));
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(body: string): void {
    this.onmessage?.({ data: body });
  }
}

function announce(sequenceId: number, type: string, orderId: string): string {
  return JSON.stringify({
    sequence_id: sequenceId,
    id: `evt-${sequenceId}`,
    type,
    version: 1,
    resource_type: "pos_order",
    resource_id: orderId,
    occurred_at: new Date().toISOString(),
    organization_id: "tenant-1",
    property_id: "property-1",
    data: { orderId, outletId: "outlet-1" },
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function renderOrders(onNewOrder = vi.fn()) {
  const socket = new FakeSocket();
  const client = new RealtimeClient({
    createSocket: () => socket as unknown as WebSocket,
    cursorStorage: { get: () => null, set: () => {} },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider client={client} queryClient={queryClient}>
        <ActiveOrders onNewOrder={onNewOrder} />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  return { socket, onNewOrder };
}

function signIn(permissions: string[]) {
  setOperationalSession({
    token: "t",
    expiresAt: "2099-01-01T00:00:00Z",
    tenantId: "tenant-1",
    propertyId: "property-1",
    outletId: "outlet-1",
    terminalId: "terminal-1",
    staffId: "staff-1",
    assurance: "RESTRICTED",
    capabilities: ["CORE", "POS"],
    permissions,
  });
}

const EVERYTHING = ["pos.order.read", "pos.order.create", "pos.order.item.add", "pos.order.item.remove", "pos.order.send", "pos.payment.record"];

const OPEN_ORDER: POSOrder = {
  id: "order-1",
  shiftId: "shift-1",
  orderNumber: "1042",
  dailyNumber: 42,
  createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  closedAt: null,
  payments: [],
  status: "OPEN",
  serviceType: "DINE_IN",
  initiatedById: "staff-1",
  initiatedByName: "Amina Hassan",
  tableLabel: "12",
  subtotalMinor: 100_000,
  discountMinor: 0,
  discountKind: "NONE",
  discountInput: 0,
  taxMinor: 18_000,
  totalMinor: 118_000,
  paidMinor: 0,
  remainingMinor: 118_000,
  version: 1,
  items: [{ id: "item-1", productId: "p1", name: "Lunch", quantity: 1, unitPriceMinor: 100_000, taxMinor: 18_000, totalMinor: 118_000, status: "ADDED" }],
};

const PAID_AT = new Date(Date.now() - 5 * 60_000).toISOString();
const PAID_ORDER: POSOrder = {
  ...OPEN_ORDER,
  id: "order-0",
  orderNumber: "1041",
  dailyNumber: 41,
  status: "CLOSED",
  paidMinor: 118_000,
  remainingMinor: 0,
  closedAt: PAID_AT,
  payments: [{ id: "pay-0", paymentMethod: "CASH", amountMinor: 118_000, createdAt: PAID_AT, recordedByName: "Grace Mushi" }],
  version: 5,
};

function receiptFor(order: POSOrder): POSReceipt {
  return {
    id: `receipt-${order.id}`,
    orderId: order.id,
    status: "PRINTED",
    reprintCount: 0,
    createdAt: new Date().toISOString(),
    document: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      businessDate: SHIFT.businessDate,
      propertyName: "Mama Rose",
      outletId: "outlet-1",
      outletName: "Main restaurant",
      terminalId: "terminal-1",
      initiatedById: "staff-1",
      initiatedByName: "Amina Hassan",
      operatorId: "staff-2",
      operatorName: "Grace Mushi",
      serviceType: order.serviceType,
      tableLabel: order.tableLabel,
      items: [],
      subtotalMinor: order.subtotalMinor,
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
      currency: "TZS",
      tenderMethod: "CASH",
      settledAt: new Date().toISOString(),
    },
  };
}

beforeEach(() => {
  catalogStore = catalogFixture("TZS");
  signIn(EVERYTHING);
});

afterEach(() => {
  ordersStore.clear();
  ticketsStore.length = 0;
  receiptsStore.clear();
  vi.clearAllMocks();
  clearOperationalSession();
});

async function openDetail(orderId: string) {
  await userEvent.click(await screen.findByTestId(`order-row-${orderId}`));
  return screen.findByRole("dialog", { name: /^Order / });
}

describe("Orders", () => {
  it("writes a non-TZS outlet's amounts in its own currency, never a hardcoded TZS", async () => {
    catalogStore = catalogFixture("KES");
    ordersStore.set("order-1", OPEN_ORDER);
    renderOrders();
    const row = await screen.findByTestId("order-row-order-1");
    await waitFor(() => expect(row).toHaveTextContent("KES"));
    expect(row).not.toHaveTextContent("TZS");
  });

  it("says there are no open orders and offers a new sale", async () => {
    const { onNewOrder } = renderOrders();
    expect(await screen.findByText("No open orders")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New sale" }));
    expect(onNewOrder).toHaveBeenCalled();
  });

  it("shows an order from Yetu and asks again when the stream says it changed", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    const { socket } = renderOrders();
    expect(await screen.findByTestId("order-row-order-1")).toHaveTextContent("Table 12");
    socket.open();
    await flush();
    socket.emit(announce(1, "pos.order.item_added", "order-1"));
    await waitFor(() => expect(spies.listOrderPage.mock.calls.filter(([query]) => query.view === "open").length).toBeGreaterThan(1));
  });

  it("follows a kitchen display: when a station ticket moves, the open orders reload, row and open detail alike", async () => {
    ordersStore.set("order-1", { ...OPEN_ORDER, status: "SENT", version: 2 });
    const { socket } = renderOrders();
    const sheet = await openDetail("order-1");
    expect(within(sheet).getByTestId("order-detail-status")).toHaveTextContent("Sent to kitchen");
    socket.open();
    await flush();
    // The display moved the order's only station ticket: Yetu put the order at Preparing, version 3,
    // and says only that a station ticket changed.
    ordersStore.set("order-1", { ...OPEN_ORDER, status: "PREPARING", version: 3 });
    socket.emit(
      JSON.stringify({
        sequence_id: 5,
        id: "evt-5",
        type: "pos.station_ticket.status_changed",
        version: 1,
        resource_type: "pos_station_ticket",
        resource_id: "ticket-1",
        occurred_at: new Date().toISOString(),
        organization_id: "tenant-1",
        property_id: "property-1",
        data: { outletId: "outlet-1", orderId: "order-1", station: "GENERAL", status: "PREPARING" },
      }),
    );
    await waitFor(() => expect(within(sheet).getByTestId("order-detail-status")).toHaveTextContent("Preparing"));
    expect(screen.getByTestId("order-row-order-1")).toHaveTextContent("Preparing");
  });

  it("asks Yetu again every few seconds while open, so a missed update still shows (orders.refreshSeconds)", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      ordersStore.set("order-1", { ...OPEN_ORDER, status: "SENT", version: 2 });
      renderOrders();
      await screen.findByTestId("order-row-order-1");
      await flush();
      ordersStore.set("order-1", { ...OPEN_ORDER, status: "READY", version: 4 });
      await act(async () => vi.advanceTimersByTime(ORDERS_REFRESH_SECONDS * 1000));
      await waitFor(() => expect(screen.getByTestId("order-row-order-1")).toHaveTextContent("Ready"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("empties the open list when Yetu says the shift closed", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    const { socket } = renderOrders();
    await screen.findByTestId("order-row-order-1");
    socket.open();
    await flush();
    ordersStore.clear();
    socket.emit(announce(2, "pos.shift.closed", "shift-1"));
    expect(await screen.findByText("No open orders")).toBeInTheDocument();
  });

  it("asks Yetu for paid orders only when the Paid tab is opened: the shift's business day, every till at the outlet", async () => {
    ordersStore.set("order-0", PAID_ORDER);
    // Paid on another till's shift the same day: listed too (a refund or a copy can be given from any till).
    ordersStore.set("order-9", { ...PAID_ORDER, id: "order-9", orderNumber: "POS-MR-261012-9", dailyNumber: 9, shiftId: "shift-0" });
    ordersStore.set("order-1", OPEN_ORDER);
    renderOrders();
    await screen.findByTestId("order-row-order-1");
    expect(spies.listOrderPage.mock.calls.some(([query]) => query.view === "paid")).toBe(false);
    await userEvent.click(screen.getByRole("tab", { name: /Paid today/ }));
    expect(await screen.findByTestId("order-row-order-0")).toHaveTextContent("Paid");
    expect(screen.getByTestId("order-row-order-9")).toBeInTheDocument();
    expect(spies.listOrderPage).toHaveBeenCalledWith({ view: "paid", businessDate: SHIFT.businessDate });
  });

  it("an open order's detail: lines, totals, and Send, Pay and Void", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    renderOrders();
    const sheet = await openDetail("order-1");
    expect(sheet).toHaveAccessibleName("Order 42");
    expect(within(sheet).getByTestId("order-detail-lines")).toHaveTextContent("Lunch");
    expect(within(sheet).getByTestId("detail-pay")).toHaveTextContent("Pay TSh 1,180");
    expect(within(sheet).getByTestId("detail-pay")).toHaveFocus();
    expect(within(sheet).getByRole("button", { name: "Void order" })).toBeEnabled();
  });

  it("shows Pay as closed, with who can, to a person without pos.payment.record; Send and Void stay", async () => {
    signIn(["pos.order.read", "pos.order.send"]);
    ordersStore.set("order-1", OPEN_ORDER);
    renderOrders();
    const sheet = await openDetail("order-1");
    expect(within(sheet).queryByTestId("detail-pay")).toBeNull();
    expect(within(sheet).getByRole("note")).toHaveTextContent("Only a cashier or manager can take payment.");
    expect(within(sheet).getByTestId("detail-send")).toBeEnabled();
    expect(within(sheet).getByRole("button", { name: "Void order" })).toBeEnabled();
  });

  it("sends it to the kitchen with its version, prints the tickets, says so and moves focus to Pay", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    spies.sendOrder.mockImplementationOnce(async () => {
      ordersStore.set("order-1", { ...OPEN_ORDER, status: "SENT", version: 2, items: OPEN_ORDER.items.map((item) => ({ ...item, status: "SENT" as const })) });
      return { data: undefined, error: null };
    });
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByTestId("detail-send"));
    await waitFor(() => expect(spies.sendOrder).toHaveBeenCalledWith("order-1", 1, expect.any(String)));
    expect(await within(sheet).findByTestId("order-detail-result")).toHaveTextContent("Sent to the kitchen.");
    await waitFor(() => expect(spies.processPendingPrintJobs).toHaveBeenCalledWith("property-1", "order-1", undefined, expect.objectContaining({ settings: expect.any(Object) })));
    await waitFor(() => expect(within(sheet).queryByTestId("detail-send")).toBeNull());
    await waitFor(() => expect(within(sheet).getByTestId("detail-pay")).toHaveFocus());
  });

  it("asks again with the same key after a lost answer, and holds the idle lock while it waits", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    spies.sendOrder.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    let answer: (value: Result) => void = () => undefined;
    spies.sendOrder.mockImplementationOnce(() => new Promise<Result>((resolve) => (answer = resolve)));
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByTestId("detail-send"));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Can't reach Yetu.");
    await userEvent.click(within(sheet).getByTestId("detail-send"));
    await waitFor(() => expect(spies.sendOrder).toHaveBeenCalledTimes(2));
    expect(spies.sendOrder.mock.calls[1][2]).toBe(spies.sendOrder.mock.calls[0][2]);
    expect(idleLockHeld()).toBe(true);
    await act(async () => answer({ data: undefined, error: null }));
    await waitFor(() => expect(idleLockHeld()).toBe(false));
  });

  it("takes a refused send (a 500 today) to mean the order changed: reloads it, says so, and the next press is a new request", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    spies.sendOrder.mockResolvedValueOnce({ data: undefined, error: { code: "INTERNAL_ERROR", detail: "only a non-empty open order can be sent" } });
    renderOrders();
    const sheet = await openDetail("order-1");
    const listedBefore = spies.listOrderPage.mock.calls.filter(([query]) => query.view === "open").length;
    await userEvent.click(within(sheet).getByTestId("detail-send"));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "This order changed on another till, or was already sent. It's been reloaded: check it before sending it again.",
    );
    await waitFor(() => expect(spies.listOrderPage.mock.calls.filter(([query]) => query.view === "open").length).toBeGreaterThan(listedBefore));
    await userEvent.click(within(sheet).getByTestId("detail-send"));
    await waitFor(() => expect(spies.sendOrder).toHaveBeenCalledTimes(2));
    expect(spies.sendOrder.mock.calls[1][2]).not.toBe(spies.sendOrder.mock.calls[0][2]);
  });

  it("removes a line not yet sent, with its own key and the order's version", async () => {
    ordersStore.set("order-1", { ...OPEN_ORDER, items: [...OPEN_ORDER.items, { ...OPEN_ORDER.items[0], id: "item-2", name: "Tea" }] });
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByRole("button", { name: /1 × Tea/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Remove Tea" }));
    await waitFor(() => expect(spies.removeItem).toHaveBeenCalledWith("order-1", "item-2", 1, expect.any(String)));
    expect(await within(sheet).findByTestId("order-detail-result")).toHaveTextContent("Tea removed.");
  });

  it("a refused remove reloads the order when it changed, and the next press is a new request", async () => {
    ordersStore.set("order-1", { ...OPEN_ORDER, items: [...OPEN_ORDER.items, { ...OPEN_ORDER.items[0], id: "item-2", name: "Tea" }] });
    spies.removeItem.mockResolvedValueOnce({ data: undefined, error: { code: "STALE_VERSION" } });
    renderOrders();
    const sheet = await openDetail("order-1");
    const listedBefore = spies.listOrderPage.mock.calls.filter(([query]) => query.view === "open").length;
    await userEvent.click(within(sheet).getByRole("button", { name: /1 × Tea/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Remove Tea" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("It's been reloaded");
    await waitFor(() => expect(spies.listOrderPage.mock.calls.filter(([query]) => query.view === "open").length).toBeGreaterThan(listedBefore));
    await userEvent.click(within(sheet).getByRole("button", { name: "Remove Tea" }));
    await waitFor(() => expect(spies.removeItem).toHaveBeenCalledTimes(2));
    expect(spies.removeItem.mock.calls[1][3]).not.toBe(spies.removeItem.mock.calls[0][3]);
  });

  it("opens Pay over the order and comes back to it on Cancel", async () => {
    ordersStore.set("order-1", { ...OPEN_ORDER, status: "SENT", version: 2 });
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByTestId("detail-pay"));
    const pay = await screen.findByTestId("settle-dialog");
    expect(within(pay).getByTestId("amount-due")).toHaveTextContent("TSh 1,180");
    await userEvent.click(within(pay).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("dialog", { name: "Order 42" })).toBeInTheDocument();
  });

  it("opens Void with a supervisor and comes back to the order on Cancel", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByRole("button", { name: "Void order" }));
    const voiding = await screen.findByTestId("void-order-dialog");
    await userEvent.click(within(voiding).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("dialog", { name: "Order 42" })).toBeInTheDocument();
  });

  it("a void refused because the order changed reloads it, and the supervisor is asked again for the order as it is now", async () => {
    ordersStore.set("order-1", { ...OPEN_ORDER, status: "SENT", version: 2 });
    spies.voidOrder.mockImplementationOnce(async () => {
      // A kitchen display moved it meanwhile.
      ordersStore.set("order-1", { ...OPEN_ORDER, status: "PREPARING", version: 3 });
      return { data: undefined, error: { code: "STALE_VERSION", detail: "resource has changed" } };
    });
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByRole("button", { name: "Void order" }));
    const voiding = await screen.findByTestId("void-order-dialog");
    await userEvent.type(within(voiding).getByTestId("void-reason"), "Wrong table");
    await userEvent.click(within(voiding).getByRole("radio", { name: /Grace Mushi/ }));
    for (const digit of "123456") await userEvent.click(within(voiding).getByTestId(`void-pin-key-${digit}`));
    await userEvent.click(within(voiding).getByTestId("confirm-void-order"));
    expect(spies.voidOrder).toHaveBeenCalledWith("order-1", expect.objectContaining({ version: 2 }), expect.any(String));
    expect(await within(voiding).findByRole("alert")).toHaveTextContent("This order changed on another till. It's been reloaded");
    await waitFor(() => expect(within(voiding).getByRole("radio", { name: /Grace Mushi/ })).not.toBeChecked());
    expect(screen.getByTestId("order-row-order-1")).toHaveTextContent("Preparing");
  });

  it("prints a copy of a paid order's receipt, reusing the key after a lost answer and a new one for the next copy", async () => {
    ordersStore.set("order-0", PAID_ORDER);
    receiptsStore.set("order-0", receiptFor(PAID_ORDER));
    spies.reprintReceipt.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderOrders();
    await screen.findByText("No open orders");
    await userEvent.click(screen.getByRole("tab", { name: /Paid today/ }));
    const sheet = await openDetail("order-0");
    expect(await within(sheet).findByTestId("order-detail-payment")).toHaveTextContent(`Cash · TSh 1,180Taken by Grace Mushi at ${clockTime(PAID_AT)}`);
    const print = within(sheet).getByTestId("detail-reprint");
    await waitFor(() => expect(print).toBeEnabled());
    await userEvent.click(print);
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Can't reach Yetu.");
    await userEvent.click(print);
    expect(await within(sheet).findByTestId("order-detail-result")).toHaveTextContent("A copy of the receipt was sent to the printer.");
    await waitFor(() => expect(within(sheet).getByTestId("order-detail-payment")).toHaveTextContent("Printed again 1 time"));
    await userEvent.click(print);
    await waitFor(() => expect(spies.reprintReceipt).toHaveBeenCalledTimes(3));
    const keys = spies.reprintReceipt.mock.calls.map((call) => call[1]);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
    // The copy is printed here: its jobs are the order's (the copy's own id found none).
    expect(spies.processPendingPrintJobs).toHaveBeenCalledWith("property-1", "order-0", undefined, expect.objectContaining({ settings: expect.any(Object) }));
  });

  it("keeps an open order's detail when another till takes payment for it, now showing it paid", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    receiptsStore.set("order-1", receiptFor(OPEN_ORDER));
    const { socket } = renderOrders();
    const sheet = await openDetail("order-1");
    socket.open();
    await flush();
    ordersStore.set("order-1", { ...OPEN_ORDER, status: "CLOSED", paidMinor: 118_000, remainingMinor: 0, version: 3 });
    socket.emit(announce(3, "pos.order.payment_recorded", "order-1"));
    await waitFor(() => expect(within(sheet).getByTestId("order-detail-status")).toHaveTextContent("Paid"));
    expect(screen.getByRole("dialog", { name: "Order 42" })).toBe(sheet);
    expect(await within(sheet).findByTestId("detail-reprint")).toBeInTheDocument();
  });

  it("a refused copy is never asked for again under its key", async () => {
    ordersStore.set("order-0", PAID_ORDER);
    receiptsStore.set("order-0", receiptFor(PAID_ORDER));
    spies.reprintReceipt.mockResolvedValueOnce({ data: undefined, error: { code: "FORBIDDEN" } });
    renderOrders();
    await screen.findByText("No open orders");
    await userEvent.click(screen.getByRole("tab", { name: /Paid today/ }));
    const sheet = await openDetail("order-0");
    const print = within(sheet).getByTestId("detail-reprint");
    await waitFor(() => expect(print).toBeEnabled());
    await userEvent.click(print);
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Only a cashier or manager can print a copy of the receipt.");
    await userEvent.click(print);
    await waitFor(() => expect(spies.reprintReceipt).toHaveBeenCalledTimes(2));
    expect(spies.reprintReceipt.mock.calls[1][1]).not.toBe(spies.reprintReceipt.mock.calls[0][1]);
  });

  it("gives focus back to the order's row when its detail closes", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    renderOrders();
    await openDetail("order-1");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("order-row-order-1")).toHaveFocus());
  });
});

describe("Orders: a kitchen ticket printed again (S8a)", () => {
  // Round 2 has gone to the kitchen.
  const SENT_ORDER: POSOrder = {
    ...OPEN_ORDER,
    status: "SENT",
    roundsSent: 2,
    items: [{ ...OPEN_ORDER.items[0], status: "SENT", roundNumber: 2 }],
  };

  it("prints the latest round's ticket again on this till, a new copy each press", async () => {
    ordersStore.set("order-1", SENT_ORDER);
    spies.processPendingPrintJobs.mockResolvedValueOnce([{ ok: true }]).mockResolvedValueOnce([{ ok: true }]);
    renderOrders();
    const sheet = await openDetail("order-1");
    const again = await within(sheet).findByTestId("detail-kitchen-reprint");
    await userEvent.click(again);
    expect(await within(sheet).findByTestId("order-detail-result")).toHaveTextContent("Round 2's kitchen ticket went to the printer again, marked COPY.");
    expect(spies.reprintKitchenTickets).toHaveBeenCalledWith("order-1", expect.any(String), undefined);
    expect(spies.processPendingPrintJobs).toHaveBeenCalledWith("property-1", "order-1", undefined, expect.objectContaining({ settings: expect.objectContaining({ kitchenTickets: true }) }));
    await userEvent.click(again);
    await waitFor(() => expect(spies.reprintKitchenTickets).toHaveBeenCalledTimes(2));
    const keys = spies.reprintKitchenTickets.mock.calls.map((call) => call[1]);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("says so when the printer didn't print the copy", async () => {
    ordersStore.set("order-1", SENT_ORDER);
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(await within(sheet).findByTestId("detail-kitchen-reprint"));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "Round 2's kitchen ticket was made again, but the printer didn't print it: No printer is configured",
    );
  });

  it("says Yetu's refusal in words", async () => {
    ordersStore.set("order-1", SENT_ORDER);
    spies.reprintKitchenTickets.mockResolvedValueOnce({ data: undefined, error: { code: "NOT_FOUND", detail: "This order hasn't gone to the kitchen yet: send it first." } });
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(await within(sheet).findByTestId("detail-kitchen-reprint"));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Nothing of this order has gone to the kitchen yet: send it first.");
    expect(spies.processPendingPrintJobs).not.toHaveBeenCalled();
  });

  it("isn't offered before the order has gone to the kitchen, or to someone who can't send orders", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    renderOrders();
    let sheet = await openDetail("order-1");
    await within(sheet).findByTestId("detail-send");
    expect(within(sheet).queryByTestId("detail-kitchen-reprint")).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
  });

  it("on a till that prints no kitchen tickets, says so and asks Yetu for no copy", async () => {
    tillPrinters.kitchenTickets = false;
    try {
      ordersStore.set("order-1", SENT_ORDER);
      renderOrders();
      const sheet = await openDetail("order-1");
      await userEvent.click(await within(sheet).findByTestId("detail-kitchen-reprint"));
      expect(await within(sheet).findByRole("alert")).toHaveTextContent(
        "This till doesn't print kitchen tickets. A manager can turn them on in Manager, Printers.",
      );
      expect(spies.reprintKitchenTickets).not.toHaveBeenCalled();
    } finally {
      tillPrinters.kitchenTickets = true;
    }
  });

  it("isn't offered to someone who can't send orders", async () => {
    signIn(EVERYTHING.filter((permission) => permission !== "pos.order.send"));
    ordersStore.set("order-1", SENT_ORDER);
    renderOrders();
    const sheet = await openDetail("order-1");
    await within(sheet).findByTestId("order-detail-status");
    expect(within(sheet).queryByTestId("detail-kitchen-reprint")).toBeNull();
  });
});
