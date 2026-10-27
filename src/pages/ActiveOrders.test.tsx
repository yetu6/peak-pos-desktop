import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
import { giveReason } from "../../tests/reasons";

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
  // S17b: a waiting tab taken onto this till's shift.
  takeOverTab: vi.fn(async (orderId: string, ..._rest: unknown[]): Promise<Result> => {
    const order = ordersStore.get(orderId)!;
    const taken = { ...order, waitingForShift: false, shiftId: "shift-1", version: order.version + 1 };
    ordersStore.set(orderId, taken);
    return { data: taken, error: null };
  }),
  // S8a: Yetu's copies of a round's kitchen tickets.
  reprintKitchenTickets: vi.fn(async (..._args: unknown[]): Promise<Result> => ({ data: { roundNumber: 2, printJobs: [] }, error: null })),
  // What Yetu would print. Unanswered unless a test gives papers: the preview then says it can't show
  // them and Print still prints, as every test here was written against.
  previewPapers: vi.fn(async (..._args: unknown[]): Promise<Result> => {
    throw new TypeError("Failed to fetch");
  }),
  processPendingPrintJobs: vi.fn(async (..._args: unknown[]): Promise<{ ok: boolean; error?: string }[]> => [{ ok: false, error: "No printer is configured" }]),
  // fbc-peak #288: the bill before payment, and the one job this till prints for it.
  printBill: vi.fn(async (orderId: string, ..._rest: unknown[]): Promise<Result> => ({
    data: { id: `bill-${orderId}`, sourceType: "POS_ORDER", sourceId: orderId, jobType: "BILL", document: { kind: "BILL" }, status: "PENDING", attempts: 0, createdAt: "2026-10-20T17:20:00Z" },
    error: null,
  })),
  processPrintJob: vi.fn(async (..._args: unknown[]): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  // A payment that pays the order in full.
  recordTender: vi.fn(async (orderId: string, ..._rest: unknown[]): Promise<Result> => {
    const order = ordersStore.get(orderId)!;
    const paid = { ...order, status: "CLOSED" as const, paidMinor: order.totalMinor, remainingMinor: 0, version: order.version + 1 };
    ordersStore.set(orderId, paid);
    return { data: { paymentId: "pay-1", orderClosed: true, paidMinor: paid.paidMinor, remainingMinor: 0, version: paid.version }, error: null };
  }),
  openDrawerForCash: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  listPOSOrderRefunds: vi.fn(async (): Promise<Result> => ({
    data: { status: "CLOSED", refundedMinor: 0, remainingMinor: 118_000, lastRefundDate: "2099-12-31", refunds: [], lines: [] },
    error: null,
  })),
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
    previewPapers: spies.previewPapers,
    removeItem: spies.removeItem,
    getCatalog: spies.getCatalog,
    listStationTickets: spies.listStationTickets,
    getCurrentShift: spies.getCurrentShift,
    getShift: spies.getShift,
    getReceipt: spies.getReceipt,
    reprintReceipt: spies.reprintReceipt,
    printBill: spies.printBill,
    recordTender: spies.recordTender,
    reprintKitchenTickets: spies.reprintKitchenTickets,
    takeOverTab: spies.takeOverTab,
    voidOrder: spies.voidOrder,
    listPOSOrderRefunds: spies.listPOSOrderRefunds,
  }),
}));

// Refund items stands in here: it has its own tests; these are about where Orders goes after it.
vi.mock("../orders/RefundItemsSheet", () => ({
  RefundItemsSheet: ({ onRefunded, onClose }: { onRefunded?: (refund: unknown) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Refund items" data-state="open">
      <button type="button" onClick={() => onRefunded?.({ totalMinor: 118_000, currency: "TZS" })}>
        Give the refund
      </button>
      <button type="button" onClick={onClose}>
        Done
      </button>
    </div>
  ),
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

vi.mock("../print/cashDrawer", () => ({ openDrawerForCash: spies.openDrawerForCash }));

vi.mock("../lib/printJobs", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/printJobs")>(),
  processPendingPrintJobs: spies.processPendingPrintJobs,
  processPrintJob: spies.processPrintJob,
}));

// This till's printer settings (Status, Printers), as the till app holds them.
const tillPrinters = vi.hoisted(() => ({ kitchenTickets: true }));
vi.mock("../print/printerStore", () => ({
  loadPrinterSettings: async () => ({ kitchenTickets: tillPrinters.kitchenTickets, kitchen: null, stations: {}, receipt: null, cashDrawer: false }),
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

/** Print in the preview that every paper shows first (owner, 2026-10-21). */
async function printInPreview() {
  await userEvent.click(await screen.findByTestId("paper-print"));
}

function renderOrders(onNewOrder = vi.fn(), onAddItems?: (order: POSOrder) => void) {
  const socket = new FakeSocket();
  const client = new RealtimeClient({
    createSocket: () => socket as unknown as WebSocket,
    cursorStorage: { get: () => null, set: () => {} },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider client={client} queryClient={queryClient}>
        <ActiveOrders onNewOrder={onNewOrder} onAddItems={onAddItems} />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  return { socket, onNewOrder, unmount: view.unmount };
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

const EVERYTHING = ["pos.order.read", "pos.order.read_all", "pos.order.create", "pos.order.item.add", "pos.order.item.remove", "pos.order.send", "pos.payment.record"];

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
  // A test that gave this till a printer (or another failure) gives it back as it was: none.
  spies.processPendingPrintJobs.mockImplementation(async () => [{ ok: false, error: "No printer is configured" }]);
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

  it("keeps a tab handed over when the shift closes: Yetu still lists it (S17b)", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    const { socket } = renderOrders();
    await screen.findByTestId("order-row-order-1");
    socket.open();
    await flush();
    ordersStore.set("order-1", { ...OPEN_ORDER, waitingForShift: true, handedOverAt: new Date().toISOString() });
    socket.emit(announce(2, "pos.shift.closed", "shift-1"));
    expect(await screen.findByTestId("order-waiting-order-1")).toHaveTextContent("Waiting for a shift");
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

  // The owner, 2026-10-27: a waiter sees only their own orders; Yetu lists only those.
  it("a waiter's Paid tab says it lists the orders they took; a cashier's keeps its words", async () => {
    signIn(["pos.order.read", "pos.order.create", "pos.order.send"]);
    ordersStore.set("order-0", PAID_ORDER);
    ordersStore.set("order-1", OPEN_ORDER);
    const waiter = renderOrders();
    await screen.findByTestId("order-row-order-1");
    await userEvent.click(screen.getByRole("tab", { name: /Your paid today/ }));
    expect(await screen.findByTestId("orders-caption")).toHaveTextContent("The orders you took, latest paid first");
    expect(screen.getByRole("region", { name: "Your paid orders today" })).toBeInTheDocument();
    waiter.unmount();

    signIn(EVERYTHING);
    renderOrders();
    await screen.findByTestId("order-row-order-1");
    await userEvent.click(screen.getByRole("tab", { name: /Paid today/ }));
    expect(await screen.findByTestId("orders-caption")).toHaveTextContent("Latest paid first");
    expect(screen.getByTestId("orders-caption")).not.toHaveTextContent("you took");
  });

  it("a waiter with nothing paid yet is told so in their own words", async () => {
    signIn(["pos.order.read", "pos.order.create", "pos.order.send"]);
    ordersStore.set("order-1", OPEN_ORDER);
    renderOrders();
    await screen.findByTestId("order-row-order-1");
    await userEvent.click(screen.getByRole("tab", { name: /Your paid today/ }));
    expect(await screen.findByText("None of your orders are paid yet today")).toBeInTheDocument();
  });

  it("an open order's detail: lines, totals, and Send, Pay and Void", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    renderOrders();
    const sheet = await openDetail("order-1");
    expect(sheet).toHaveAccessibleName("Order 42");
    expect(within(sheet).getByTestId("order-detail-lines")).toHaveTextContent("Lunch");
    // Not sent yet: Pay sends it to the kitchen first.
    expect(within(sheet).getByTestId("detail-pay")).toHaveTextContent("Send and pay TSh 1,180");
    expect(within(sheet).getByTestId("detail-pay")).toHaveFocus();
    expect(within(sheet).getByRole("button", { name: "Cancel order" })).toBeEnabled();
  });

  it("shows Pay as closed, with who can, to a person without pos.payment.record; Send and Void stay", async () => {
    signIn(["pos.order.read", "pos.order.send"]);
    ordersStore.set("order-1", OPEN_ORDER);
    renderOrders();
    const sheet = await openDetail("order-1");
    expect(within(sheet).queryByTestId("detail-pay")).toBeNull();
    expect(within(sheet).getByRole("note")).toHaveTextContent("Only a cashier or manager can take payment.");
    expect(within(sheet).getByTestId("detail-send")).toBeEnabled();
    expect(within(sheet).getByRole("button", { name: "Cancel order" })).toBeEnabled();
  });

  // The owner, 2026-10-22: Print for bar -- here too; before payment, every paper together.
  it("prints one station's new items from the preview; Pay prints them all", async () => {
    const kitchenPaper = (station: string, name: string) => ({
      jobType: "KITCHEN_TICKET", document: { orderId: "order-1", orderNumber: "0042", station, items: [{ name, quantity: 1, modifiers: [] }] },
    });
    spies.previewPapers.mockImplementation(async () => ({ data: { papers: [kitchenPaper("BAR", "Soda"), kitchenPaper("HOT", "Chips")] }, error: null }));
    try {
      ordersStore.set("order-1", OPEN_ORDER);
      renderOrders();
      const sheet = await openDetail("order-1");
      await userEvent.click(within(sheet).getByTestId("detail-pay"));
      await waitFor(() => expect(screen.getByTestId("paper-print")).toHaveTextContent("Print both"));
      expect(screen.queryByTestId("paper-print-one")).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Back" }));
      await userEvent.click(within(sheet).getByTestId("detail-send"));
      const one = await screen.findByTestId("paper-print-one");
      expect(one).toHaveTextContent("Print for bar");
      await userEvent.click(one);
      await waitFor(() => expect(spies.sendOrder).toHaveBeenCalledWith("order-1", 1, expect.any(String), ["BAR"]));
    } finally {
      spies.previewPapers.mockReset();
      spies.previewPapers.mockImplementation(async () => {
        throw new TypeError("Failed to fetch");
      });
    }
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
    await printInPreview();
    await waitFor(() => expect(spies.sendOrder).toHaveBeenCalledWith("order-1", 1, expect.any(String), undefined));
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
    await printInPreview();
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Can't reach Yetu.");
    await userEvent.click(within(sheet).getByTestId("detail-send"));
    await printInPreview();
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
    await printInPreview();
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "This order changed on another till, or was already sent. It's been reloaded: check it before sending it again.",
    );
    await waitFor(() => expect(spies.listOrderPage.mock.calls.filter(([query]) => query.view === "open").length).toBeGreaterThan(listedBefore));
    await userEvent.click(within(sheet).getByTestId("detail-send"));
    await printInPreview();
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

  // F-260 (fbc-peak #286): the last line off an order never sent, Yetu closes it.
  it("taking off the last line says the order is closed, with nothing on it", async () => {
    const removedAt = new Date().toISOString();
    ordersStore.set("order-1", { ...OPEN_ORDER });
    spies.removeItem.mockImplementationOnce(async (orderId: string) => {
      const order = ordersStore.get(orderId)!;
      const closed: POSOrder = {
        ...order,
        status: "VOIDED",
        closedAt: removedAt,
        version: order.version + 1,
        items: order.items.map((item) => ({ ...item, status: "VOIDED" as const, removedAt })),
      };
      ordersStore.set(orderId, closed);
      return { data: closed, error: null };
    });
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByRole("button", { name: /1 × Lunch/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Remove Lunch" }));
    expect(await within(sheet).findByTestId("order-detail-result")).toHaveTextContent("Lunch removed. Nothing is left on Order 42, so it's closed.");
    expect(await within(sheet).findByTestId("order-detail-status")).toHaveTextContent("Nothing on it");
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

  // The owner, 2026-10-20: the guest gets the bill before paying (fbc-peak #288).
  it("prints the bill for an open order: Yetu makes it, this till prints that one job, and says so", async () => {
    ordersStore.set("order-1", { ...OPEN_ORDER });
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByRole("button", { name: "Print bill" }));
    await printInPreview();
    await waitFor(() => expect(spies.printBill).toHaveBeenCalledWith("order-1", expect.any(String)));
    await waitFor(() => expect(spies.processPrintJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: "bill-order-1", jobType: "BILL" }), undefined, expect.objectContaining({ settings: expect.any(Object) })));
    expect(await within(sheet).findByTestId("order-detail-result")).toHaveTextContent("The bill was sent to the printer.");
    // Only the bill: nothing else waiting for the order is printed with it.
    expect(spies.processPendingPrintJobs).not.toHaveBeenCalled();
  });

  it("isn't offered to a person who can't send an order", async () => {
    signIn(["pos.order.read", "pos.payment.record"]);
    ordersStore.set("order-1", { ...OPEN_ORDER });
    renderOrders();
    const sheet = await openDetail("order-1");
    expect(within(sheet).getByTestId("detail-pay")).toBeInTheDocument();
    expect(within(sheet).queryByTestId("detail-print-bill")).toBeNull();
  });

  it("a cash drawer that didn't open is said on Orders once Paid is done", async () => {
    spies.openDrawerForCash.mockResolvedValueOnce({ ok: false, error: "Printer offline" } as { ok: boolean });
    ordersStore.set("order-1", { ...OPEN_ORDER, status: "SENT", version: 2 });
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByTestId("detail-pay"));
    const pay = await screen.findByTestId("settle-dialog");
    await userEvent.type(within(pay).getByTestId("amount-received"), "2000");
    await userEvent.click(within(pay).getByTestId("confirm-settle"));
    const done = await screen.findByRole("dialog", { name: "Paid" });
    await userEvent.click(within(done).getByRole("button", { name: /Back to orders/ }));
    expect(await screen.findByText(/The cash drawer didn't open: printer offline/)).toBeInTheDocument();
  });

  // 2026-10-20: nothing prints after payment; cash still opens the drawer.
  it("a cash payment from Orders prints nothing and opens the cash drawer", async () => {
    ordersStore.set("order-1", { ...OPEN_ORDER, status: "SENT", version: 2 });
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByTestId("detail-pay"));
    const pay = await screen.findByTestId("settle-dialog");
    await userEvent.type(within(pay).getByTestId("amount-received"), "2000");
    await userEvent.click(within(pay).getByTestId("confirm-settle"));
    expect(await screen.findByRole("dialog", { name: "Paid" })).toBeInTheDocument();
    await waitFor(() => expect(spies.openDrawerForCash).toHaveBeenCalledWith("CASH"));
    expect(spies.openDrawerForCash).toHaveBeenCalledTimes(1);
    expect(spies.processPendingPrintJobs).not.toHaveBeenCalled();
    expect(spies.processPrintJob).not.toHaveBeenCalled();
  });

  it("a bill the printer didn't print says so, and where printers are set up", async () => {
    ordersStore.set("order-1", { ...OPEN_ORDER });
    spies.processPrintJob.mockResolvedValueOnce({ ok: false, error: "No printer is set up on this till" });
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByRole("button", { name: "Print bill" }));
    await printInPreview();
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "The bill didn't print: no printer is set up on this till. Print it again once the printer is ready; a manager sets up printers in Status (F12), under Printers.",
    );
  });

  it("opens Pay over the order and comes back to it on Cancel", async () => {
    ordersStore.set("order-1", { ...OPEN_ORDER, status: "SENT", version: 2 });
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByTestId("detail-pay"));
    const pay = await screen.findByTestId("settle-dialog");
    expect(within(pay).getByTestId("amount-due")).toHaveTextContent("TSh 1,180");
    await userEvent.click(within(pay).getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("dialog", { name: "Order 42" })).toBeInTheDocument();
  });

  it("opens Void with a supervisor and comes back to the order on Cancel", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByRole("button", { name: "Cancel order" }));
    const voiding = await screen.findByTestId("void-order-dialog");
    await userEvent.click(within(voiding).getByRole("button", { name: "Back" }));
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
    await userEvent.click(within(sheet).getByRole("button", { name: "Cancel order" }));
    const voiding = await screen.findByTestId("void-order-dialog");
    await giveReason("void-reason", "Wrong table", voiding);
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
    // This till's printer prints.
    spies.processPendingPrintJobs.mockResolvedValue([{ ok: true }]);
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
    expect(await within(sheet).findByTestId("order-detail-result")).toHaveTextContent("A copy of the bill was sent to the printer.");
    await waitFor(() => expect(within(sheet).getByTestId("order-detail-payment")).toHaveTextContent("Printed again 1 time"));
    await userEvent.click(print);
    await waitFor(() => expect(spies.reprintReceipt).toHaveBeenCalledTimes(3));
    const keys = spies.reprintReceipt.mock.calls.map((call) => call[1]);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
    // The copy is printed here: its jobs are the order's (the copy's own id found none).
    expect(spies.processPendingPrintJobs).toHaveBeenCalledWith("property-1", "order-0", undefined, expect.objectContaining({ settings: expect.any(Object) }));
  });

  // F-233: with no printer the copy failed and the till said it was sent to the printer.
  it("a copy the printer didn't print says so, and why", async () => {
    ordersStore.set("order-0", PAID_ORDER);
    receiptsStore.set("order-0", receiptFor(PAID_ORDER));
    spies.processPendingPrintJobs.mockResolvedValue([{ ok: false, error: "No printer is set up on this till" }]);
    renderOrders();
    await screen.findByText("No open orders");
    await userEvent.click(screen.getByRole("tab", { name: /Paid today/ }));
    const sheet = await openDetail("order-0");
    const print = within(sheet).getByTestId("detail-reprint");
    await waitFor(() => expect(print).toBeEnabled());
    await userEvent.click(print);
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "The copy didn't print: no printer is set up on this till. Yetu has the bill; try again once the printer is ready.",
    );
    expect(within(sheet).queryByText("A copy of the bill was sent to the printer.")).toBeNull();
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
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Only a cashier or manager can print the bill again.");
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
    await printInPreview();
    expect(await within(sheet).findByTestId("order-detail-result")).toHaveTextContent("Round 2's kitchen ticket went to the printer again, marked COPY.");
    expect(spies.reprintKitchenTickets).toHaveBeenCalledWith("order-1", expect.any(String), undefined);
    expect(spies.processPendingPrintJobs).toHaveBeenCalledWith("property-1", "order-1", undefined, expect.objectContaining({ settings: expect.objectContaining({ kitchenTickets: true }) }));
    await userEvent.click(again);
    await printInPreview();
    await waitFor(() => expect(spies.reprintKitchenTickets).toHaveBeenCalledTimes(2));
    const keys = spies.reprintKitchenTickets.mock.calls.map((call) => call[1]);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("says so when the printer didn't print the copy", async () => {
    ordersStore.set("order-1", SENT_ORDER);
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(await within(sheet).findByTestId("detail-kitchen-reprint"));
    await printInPreview();
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
    await printInPreview();
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Nothing of this order has gone to the kitchen yet: send it first.");
    expect(spies.processPendingPrintJobs).not.toHaveBeenCalled();
  });

  it("isn't offered before the order has gone to the kitchen, or to someone who can't send orders", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    renderOrders();
    let sheet = await openDetail("order-1");
    await within(sheet).findByTestId("detail-send");
    expect(within(sheet).queryByTestId("detail-kitchen-reprint")).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: "Back to previous screen" }));
  });

  it("on a till that prints no kitchen tickets, says so and asks Yetu for no copy", async () => {
    tillPrinters.kitchenTickets = false;
    try {
      ordersStore.set("order-1", SENT_ORDER);
      renderOrders();
      const sheet = await openDetail("order-1");
      await userEvent.click(await within(sheet).findByTestId("detail-kitchen-reprint"));
      await printInPreview();
      expect(await within(sheet).findByRole("alert")).toHaveTextContent(
        "This till doesn't print kitchen tickets. A manager can turn them on in Status (F12), under Printers.",
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

describe("Orders: a tab handed over to the next shift (S17b)", () => {
  const WAITING: POSOrder = {
    ...OPEN_ORDER,
    shiftId: "shift-0",
    status: "SENT",
    roundsSent: 1,
    items: [{ ...OPEN_ORDER.items[0], status: "SENT", roundNumber: 1 }],
    handedOverAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    waitingForShift: true,
  };

  it("says it waits for a shift, offers only to take it over, and then carries on here", async () => {
    ordersStore.set("order-1", WAITING);
    renderOrders();
    expect(await screen.findByTestId("order-waiting-order-1")).toHaveTextContent("Waiting for a shift");
    const sheet = await openDetail("order-1");
    const waiting = await within(sheet).findByTestId("detail-waiting");
    // The detail says what the list says.
    expect(within(sheet).getByTestId("order-detail-status")).toHaveTextContent("Waiting for a shift");
    expect(waiting).toHaveTextContent(`Handed over to the next shift at ${clockTime(WAITING.handedOverAt!)}.`);
    expect(within(sheet).queryByTestId("detail-pay")).toBeNull();
    expect(within(sheet).queryByTestId("detail-send")).toBeNull();
    await userEvent.click(within(sheet).getByTestId("detail-take-over"));
    expect(spies.takeOverTab).toHaveBeenCalledWith("order-1", expect.any(String));
    expect(await within(sheet).findByTestId("order-detail-result")).toHaveTextContent("The tab is on this till's shift now.");
    await waitFor(() => expect(within(sheet).queryByTestId("detail-waiting")).toBeNull());
  });

  it("says Yetu's refusal in words: no shift open on this till", async () => {
    ordersStore.set("order-1", WAITING);
    spies.takeOverTab.mockResolvedValueOnce({ data: undefined, error: { code: "SHIFT_NOT_OPEN", detail: "No shift is open on this till." } });
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(await within(sheet).findByTestId("detail-take-over"));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Open a shift on this till, then take the tab over.");
  });

  it("isn't offered to someone who can't take orders", async () => {
    signIn(EVERYTHING.filter((permission) => permission !== "pos.order.send"));
    ordersStore.set("order-1", WAITING);
    renderOrders();
    const sheet = await openDetail("order-1");
    await within(sheet).findByTestId("detail-waiting");
    expect(within(sheet).queryByTestId("detail-take-over")).toBeNull();
  });
});

describe("Orders: Pay sends what isn't sent first (Toast, Square)", () => {
  // Round 1 went; a tart was added after: Send round 2 here, and Pay sends it first.
  const ROUND2: POSOrder = {
    ...OPEN_ORDER,
    status: "SERVED",
    roundsSent: 1,
    items: [
      { ...OPEN_ORDER.items[0], status: "SENT", roundNumber: 1 },
      { id: "item-2", productId: "p1", name: "Chocolate tart", quantity: 1, unitPriceMinor: 50_000, taxMinor: 9_000, totalMinor: 59_000, status: "ADDED" },
    ],
  };

  it("an order with a line added after its round sends round 2 from here", async () => {
    ordersStore.set("order-1", ROUND2);
    renderOrders();
    const sheet = await openDetail("order-1");
    expect(within(sheet).getByTestId("detail-send")).toHaveTextContent(/Print (order|for )/);
    expect(within(sheet).getByTestId("detail-send")).toBeEnabled();
  });

  it("Send and pay sends the round, then opens the payment", async () => {
    ordersStore.set("order-1", ROUND2);
    renderOrders();
    const sheet = await openDetail("order-1");
    const pay = within(sheet).getByTestId("detail-pay");
    expect(pay).toHaveTextContent("Send and pay TSh");
    await userEvent.click(pay);
    await printInPreview();
    await waitFor(() => expect(spies.sendOrder).toHaveBeenCalledWith("order-1", ROUND2.version, expect.any(String), undefined));
    expect(await screen.findByTestId("settle-dialog")).toBeInTheDocument();
  });

  it("when the send is refused, the payment doesn't open and the till says why", async () => {
    ordersStore.set("order-1", ROUND2);
    spies.sendOrder.mockResolvedValueOnce({ data: undefined, error: { code: "FORBIDDEN", detail: "x" } });
    renderOrders();
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByTestId("detail-pay"));
    await printInPreview();
    expect(await within(sheet).findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("settle-dialog")).toBeNull();
  });
});

// F-236, found on Bahari QA Hotel's first day: once the cashier left Sell,
// table 4 could never get a second round or a discount.
describe("Orders: carrying on with an open order (F-236)", () => {
  const TABLE_4: POSOrder = {
    ...OPEN_ORDER,
    status: "SENT",
    roundsSent: 1,
    items: [{ ...OPEN_ORDER.items[0], status: "SENT", roundNumber: 1 }],
  };

  it("Add items hands the order, as Yetu has it, to Sell", async () => {
    ordersStore.set("order-1", TABLE_4);
    const onAddItems = vi.fn();
    renderOrders(vi.fn(), onAddItems);
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByTestId("detail-add-items"));
    expect(onAddItems).toHaveBeenCalledWith(expect.objectContaining({ id: "order-1", roundsSent: 1 }));
  });

  it("a tab waiting for a shift is taken over first: no Add items", async () => {
    ordersStore.set("order-1", { ...TABLE_4, waitingForShift: true, handedOverAt: new Date().toISOString() });
    renderOrders(vi.fn(), vi.fn());
    const sheet = await openDetail("order-1");
    expect(within(sheet).queryByTestId("detail-add-items")).toBeNull();
    expect(within(sheet).queryByTestId("detail-print-bill")).toBeNull();
  });

  it("opens Discount with a supervisor and comes back to the order on Cancel", async () => {
    ordersStore.set("order-1", TABLE_4);
    renderOrders(vi.fn(), vi.fn());
    const sheet = await openDetail("order-1");
    await userEvent.click(within(sheet).getByTestId("detail-discount"));
    const discount = await screen.findByTestId("discount-dialog");
    await userEvent.click(within(discount).getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("dialog", { name: "Order 42" })).toBeInTheDocument();
  });

  it("a void says the kitchen was told only of an order it had (F-243)", async () => {
    async function voidIt() {
      const sheet = await openDetail("order-1");
      await userEvent.click(within(sheet).getByRole("button", { name: "Cancel order" }));
      const voiding = await screen.findByTestId("void-order-dialog");
      await giveReason("void-reason", "Wrong table", voiding);
      await userEvent.click(within(voiding).getByRole("radio", { name: /Grace Mushi/ }));
      for (const digit of "123456") await userEvent.click(within(voiding).getByTestId(`void-pin-key-${digit}`));
      spies.voidOrder.mockImplementationOnce(async () => {
        ordersStore.delete("order-1");
        return { data: undefined, error: null };
      });
      await userEvent.click(within(voiding).getByTestId("confirm-void-order"));
    }
    // Never sent: only ever on this till -- no kitchen told, and no void slip tried (exactly these words).
    ordersStore.set("order-1", OPEN_ORDER);
    renderOrders();
    await voidIt();
    expect(await screen.findByText("Order 42 was cancelled.")).toBeInTheDocument();

    cleanup();
    // Sent: the kitchen is told. Here no printer is set up, so the slip's problem follows
    // the void's words -- it never replaces them.
    ordersStore.set("order-1", TABLE_4);
    renderOrders();
    await voidIt();
    expect(await screen.findByText(/^Order 42 was cancelled\. The kitchen has been told\. The cancel slip didn't print/)).toBeInTheDocument();
  });
});

// F-237: after "Refund given" and Done, the till seemed stuck: Done went back
// to the order's sheet, which holds the rail until it is closed.
describe("Orders: after a refund (F-237)", () => {
  it("Done after a refund goes back to the list, which says what was given back; Cancel goes back to the order", async () => {
    ordersStore.set("order-0", PAID_ORDER);
    receiptsStore.set("order-0", receiptFor(PAID_ORDER));
    renderOrders();
    await screen.findByText("No open orders");
    await userEvent.click(screen.getByRole("tab", { name: /Paid today/ }));
    let sheet = await openDetail("order-0");
    await waitFor(() => expect(within(sheet).getByTestId("detail-refund")).toBeEnabled());

    // Given: back to the list.
    await userEvent.click(within(sheet).getByTestId("detail-refund"));
    const giving = await screen.findByRole("dialog", { name: "Refund items" });
    await userEvent.click(within(giving).getByRole("button", { name: "Give the refund" }));
    await userEvent.click(within(giving).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Order 41: TSh 1,180 refunded.")).toBeInTheDocument();

    // Opened again and left without giving one: back to the order.
    sheet = await openDetail("order-0");
    await waitFor(() => expect(within(sheet).getByTestId("detail-refund")).toBeEnabled());
    await userEvent.click(within(sheet).getByTestId("detail-refund"));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Refund items" })).getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("dialog", { name: /^Order / })).toBeInTheDocument();
  });
});
