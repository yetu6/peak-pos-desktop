import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RealtimeClient } from "../realtime/RealtimeClient";
import { RealtimeProvider } from "../realtime/RealtimeProvider";
import { ActiveOrders } from "./ActiveOrders";
import { clearOperationalSession, setOperationalSession } from "../lib/operationalSession";
import type { POSOrder } from "../lib/posContracts";

vi.mock("../lib/env", () => ({
  devIdentityFromEnv: () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    propertyId: "property-1",
    outletId: "outlet-1",
  }),
}));

const { listOrdersSpy, sendOrderSpy, getOrderSpy, processPendingPrintJobsSpy } = vi.hoisted(() => ({
  listOrdersSpy: vi.fn(async () => ({ data: Array.from(ordersStore.values()), error: null })),
  getOrderSpy: vi.fn(async (orderId: string) => {
    const order = ordersStore.get(orderId);
    return order ? { data: order, error: null } : { data: undefined, error: { code: "NOT_FOUND" } };
  }),
  sendOrderSpy: vi.fn(async () => ({ data: undefined, error: null })),
  processPendingPrintJobsSpy: vi.fn(async () => [{ ok: false, error: "No printer is configured" }]),
}));

const ordersStore = new Map<string, POSOrder>();

vi.mock("../lib/posApi", () => ({
  createPosApi: () => ({
    listOrders: listOrdersSpy,
    getOrder: getOrderSpy,
    sendOrder: sendOrderSpy,
  }),
}));

vi.mock("../lib/printJobs", () => ({
  processPendingPrintJobs: processPendingPrintJobsSpy,
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
    occurred_at: "2026-08-15T08:00:00Z",
    organization_id: "tenant-1",
    property_id: "property-1",
    data: { orderId, outletId: "outlet-1" },
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function renderActiveOrders() {
  const socket = new FakeSocket();
  const client = new RealtimeClient({
    createSocket: () => socket as unknown as WebSocket,
    cursorStorage: { get: () => null, set: () => {} },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider client={client} queryClient={queryClient}>
        <ActiveOrders />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  return socket;
}

const OPEN_ORDER: POSOrder = {
  id: "order-1",
  shiftId: "shift-1",
  orderNumber: "ORD-1042",
  status: "OPEN",
  serviceType: "DINE_IN",
  tableLabel: "T12",
  subtotalMinor: 1000,
  taxMinor: 180,
  totalMinor: 1180,
  version: 1,
  items: [{ id: "item-1", productId: "p1", name: "Lunch", quantity: 1, unitPriceMinor: 1000, taxMinor: 180, totalMinor: 1180, status: "ADDED" }],
};

describe("ActiveOrders", () => {
  afterEach(() => {
    ordersStore.clear();
    listOrdersSpy.mockClear();
    getOrderSpy.mockClear();
    sendOrderSpy.mockClear();
    processPendingPrintJobsSpy.mockClear();
    clearOperationalSession();
  });

  it("renders the empty state before any order exists", async () => {
    renderActiveOrders();
    expect(await screen.findByText(/No open orders/)).toBeInTheDocument();
  });

  it("hides Settle for a staff account without pos.payment.record, but keeps Send to kitchen and Void", async () => {
    setOperationalSession({
      token: "t", expiresAt: "2099-01-01T00:00:00Z", tenantId: "tenant-1", propertyId: "property-1",
      outletId: "outlet-1", terminalId: "terminal-1", staffId: "staff-1", assurance: "RESTRICTED",
      capabilities: ["CORE", "POS"], permissions: ["pos.order.create", "pos.order.item.add", "pos.order.send"],
    });
    ordersStore.set("order-1", OPEN_ORDER);
    renderActiveOrders();
    await screen.findByText("ORD-1042");
    expect(screen.queryByTestId("settle-order-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("send-order-1")).toBeInTheDocument();
    expect(screen.getByTestId("void-order-order-1")).toBeInTheDocument();
  });

  it("shows Settle for a staff account with pos.payment.record", async () => {
    setOperationalSession({
      token: "t", expiresAt: "2099-01-01T00:00:00Z", tenantId: "tenant-1", propertyId: "property-1",
      outletId: "outlet-1", terminalId: "terminal-1", staffId: "staff-1", assurance: "RESTRICTED",
      capabilities: ["CORE", "POS"], permissions: ["pos.order.create", "pos.order.item.add", "pos.order.send", "pos.payment.record"],
    });
    ordersStore.set("order-1", OPEN_ORDER);
    renderActiveOrders();
    await screen.findByText("ORD-1042");
    expect(screen.getByTestId("settle-order-1")).toBeInTheDocument();
  });

  it("shows an order from REST and refetches when the stream announces a change", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    const socket = renderActiveOrders();
    expect(await screen.findByText("ORD-1042")).toBeInTheDocument();
    expect(screen.getByText(/T12/)).toBeInTheDocument();

    ordersStore.set("order-1", { ...OPEN_ORDER, totalMinor: 1980 });
    socket.open();
    await flush();
    socket.emit(announce(1, "pos.order.item_added", "order-1"));
    await waitFor(() => expect(listOrdersSpy.mock.calls.length).toBeGreaterThan(1));
  });

  it("moves a closed order to the settled strip", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    const socket = renderActiveOrders();
    await screen.findByText("ORD-1042");

    ordersStore.set("order-1", { ...OPEN_ORDER, status: "CLOSED" });
    socket.open();
    await flush();
    socket.emit(announce(2, "pos.order.settled", "order-1"));
    await waitFor(() => {
      expect(screen.queryByTestId("order-order-1")).not.toBeInTheDocument();
      expect(screen.getByTestId("settled-order-1")).toBeInTheDocument();
    });
  });

  it("sends the order to the kitchen from the card action", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    renderActiveOrders();
    const sendButton = await screen.findByTestId("send-order-1");
    await userEvent.click(sendButton);
    await waitFor(() => expect(sendOrderSpy).toHaveBeenCalledWith("order-1", 1, expect.any(String)));
    expect(processPendingPrintJobsSpy).toHaveBeenCalled();
  });

  it("opens the remove-item dialog from an unsent order line", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    renderActiveOrders();
    await screen.findByText("ORD-1042");
    await userEvent.click(screen.getByTestId("remove-item-item-1"));
    expect(await screen.findByTestId("remove-item-dialog")).toBeInTheDocument();
    expect(screen.getByText(/Remove Lunch/)).toBeInTheDocument();
  });

  it("opens the whole-order void dialog", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    renderActiveOrders();
    await screen.findByText("ORD-1042");
    await userEvent.click(screen.getByTestId("void-order-order-1"));
    expect(await screen.findByTestId("void-order-dialog")).toBeInTheDocument();
  });

  it("clears the board when Peak publishes shift closed on the outlet", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    const socket = renderActiveOrders();
    await screen.findByText("ORD-1042");
    socket.open();
    await flush();

    ordersStore.clear();
    socket.emit(announce(2, "pos.shift.closed", "shift-1"));
    await waitFor(() => {
      expect(screen.queryByText("ORD-1042")).not.toBeInTheDocument();
      expect(screen.getByText(/No open orders/)).toBeInTheDocument();
    });
  });
});
