import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RealtimeClient } from "../realtime/RealtimeClient";
import { RealtimeProvider } from "../realtime/RealtimeProvider";
import { ActiveOrders } from "./ActiveOrders";
import type { RealtimeEnvelope } from "../realtime/RealtimeEnvelope";

vi.mock("../lib/env", () => ({
  devIdentityFromEnv: () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    propertyId: "property-1",
    outletId: "outlet-1",
  }),
}));

interface MockOrder {
  id: string;
  orderNumber: string;
  orderType: string;
  tableNumber: string | null;
  status: string;
  settlementStatus: string;
  settlementMethod?: string;
  totalAmount: number;
  items: Array<{ id: string; name: string; quantity: number }>;
}

const { getOrderSpy, listOrdersSpy, sendOrderSpy, processPendingPrintJobsSpy } = vi.hoisted(() => ({
  getOrderSpy: vi.fn(async (_propertyId: string, orderId: string) => {
    const order = ordersStore.get(orderId);
    return order
      ? { data: order, error: null }
      : { data: null, error: { status: 404 } };
  }),
  listOrdersSpy: vi.fn(async () => ({ data: Array.from(ordersStore.values()), error: null })),
  sendOrderSpy: vi.fn(async () => ({ data: { id: "ticket-1" }, error: null })),
  processPendingPrintJobsSpy: vi.fn(async () => [
    { ok: false, error: "No kitchen printer is configured" },
  ]),
}));

const ordersStore = new Map<string, MockOrder>();

vi.mock("../lib/posApi", () => ({
  createPosApi: () => ({
    getOrder: getOrderSpy,
    listOrders: listOrdersSpy,
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

function renderActiveOrders(backfill?: (after: number) => Promise<RealtimeEnvelope[]>) {
  const socket = new FakeSocket();
  const client = new RealtimeClient({
    createSocket: () => socket as unknown as WebSocket,
    backfillEvents: backfill,
    cursorStorage: { get: () => null, set: () => {} },
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider client={client} queryClient={queryClient}>
        <ActiveOrders />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  return socket;
}

const OPEN_ORDER: MockOrder = {
  id: "order-1",
  orderNumber: "ORD-1042",
  orderType: "DINE_IN",
  tableNumber: "T12",
  status: "open",
  settlementStatus: "UNSETTLED",
  totalAmount: 1180,
  items: [{ id: "item-1", name: "Lunch", quantity: 1 }],
};

describe("ActiveOrders", () => {
  afterEach(() => {
    ordersStore.clear();
    getOrderSpy.mockClear();
    sendOrderSpy.mockClear();
    processPendingPrintJobsSpy.mockClear();
  });

  it("renders the empty state before any event arrives", async () => {
    const socket = renderActiveOrders();
    await flush();
    socket.open();
    await flush();
    expect(
      await screen.findByText(/No active orders/),
    ).toBeInTheDocument();
  });

  it("fetches an order from REST when the stream announces it and re-renders on updates", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    const socket = renderActiveOrders();
    await flush();
    socket.open();
    await flush();

    socket.emit(announce(1, "pos.order.created", "order-1"));
    expect(await screen.findByText("ORD-1042")).toBeInTheDocument();
    expect(screen.getByText(/T12/)).toBeInTheDocument();
    expect(screen.getByText("1180")).toBeInTheDocument();
    expect(getOrderSpy).toHaveBeenCalledWith("property-1", "order-1");

    ordersStore.set("order-1", {
      ...OPEN_ORDER,
      totalAmount: 1980,
      items: [{ id: "item-1", name: "Lunch", quantity: 2 }],
    });
    socket.emit(announce(2, "pos.order.updated", "order-1"));
    await waitFor(() => expect(screen.getByText("1980")).toBeInTheDocument());
  });

  it("moves the order to the settled strip when the stream announces a settlement", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    const socket = renderActiveOrders();
    await flush();
    socket.open();
    await flush();
    socket.emit(announce(1, "pos.order.created", "order-1"));
    await screen.findByText("ORD-1042");

    ordersStore.set("order-1", {
      ...OPEN_ORDER,
      status: "closed",
      settlementStatus: "CONFIRMED",
      settlementMethod: "cash",
    });
    socket.emit(announce(2, "pos.order.settled", "order-1"));
    await waitFor(() => {
      expect(screen.queryByTestId("order-1")).not.toBeInTheDocument();
      expect(screen.getByTestId("settled-order-1")).toBeInTheDocument();
      expect(screen.getByTestId("settled-order-1")).toHaveTextContent("cash");
    });
  });

  it("sends the order to the kitchen from the card action", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    const socket = renderActiveOrders();
    await flush();
    socket.open();
    await flush();
    socket.emit(announce(1, "pos.order.created", "order-1"));
    const sendButton = await screen.findByTestId("send-order-1");
    await userEvent.click(sendButton);
    await waitFor(() => expect(sendOrderSpy).toHaveBeenCalledWith("property-1", "order-1"));
    expect(processPendingPrintJobsSpy).toHaveBeenCalledWith("property-1", "ticket-1");
    expect(await screen.findByTestId("send-status-order-1")).toHaveTextContent("ORDER SENT");
    expect(await screen.findByTestId("print-fail-order-1")).toHaveTextContent("PRINT FAILURE");
  });

  it("opens the void dialog from an open order line", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    const socket = renderActiveOrders();
    await flush();
    socket.open();
    await flush();
    socket.emit(announce(1, "pos.order.created", "order-1"));
    await screen.findByText("ORD-1042");
    await userEvent.click(screen.getByTestId("void-item-item-1"));
    expect(await screen.findByTestId("void-item-dialog")).toBeInTheDocument();
    expect(screen.getByText(/Void Lunch/)).toBeInTheDocument();
  });

  it("clears the board when Peak publishes shift closed on the outlet", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    const socket = renderActiveOrders();
    await flush();
    socket.open();
    await flush();
    expect(socket.sent.join("")).toContain("pos.outlet.outlet-1");

    socket.emit(announce(1, "pos.order.created", "order-1"));
    expect(await screen.findByText("ORD-1042")).toBeInTheDocument();

    socket.emit(announce(2, "pos.shift.closed", "session-1"));
    await waitFor(() => {
      expect(screen.queryByText("ORD-1042")).not.toBeInTheDocument();
      expect(screen.getByText(/No active orders/)).toBeInTheDocument();
    });
  });

  it("rebuilds the board from backfilled announcements before the socket opens", async () => {
    ordersStore.set("order-1", OPEN_ORDER);
    const socket = renderActiveOrders(async () => [
      JSON.parse(announce(1, "pos.order.created", "order-1")) as RealtimeEnvelope,
    ]);
    await flush();
    expect(await screen.findByText("ORD-1042")).toBeInTheDocument();
    expect(listOrdersSpy).toHaveBeenCalledWith("property-1", true);

    socket.open();
    await flush();
    // The resync invalidates all queries once on connect; the live duplicate of
    // the backfilled announcement is then deduped by position and must not
    // trigger another fetch.
    const callsAfterConnect = getOrderSpy.mock.calls.length;
    socket.emit(announce(1, "pos.order.created", "order-1"));
    await flush();
    expect(getOrderSpy.mock.calls.length).toBeGreaterThanOrEqual(callsAfterConnect);
  });
});
