import { describe, expect, it, vi } from "vitest";
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

const { sendOrderSpy } = vi.hoisted(() => ({
  sendOrderSpy: vi.fn(async () => ({ data: {}, error: null })),
}));

vi.mock("../lib/posApi", () => ({
  createPosApi: () => ({ sendOrder: sendOrderSpy }),
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
    this.onmessage?.({ data: "CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\0" });
  }
  emit(body: string): void {
    const subId = this.sent
      .find((f) => f.startsWith("SUBSCRIBE\n"))
      ?.match(/^id:(.+)$/m)?.[1];
    this.onmessage?.({
      data: `MESSAGE\ndestination:/topic/outlets/outlet-1/orders\nsubscription:${subId ?? "sub-0"}\n\n${body}\0`,
    });
  }
}

function envelope(type: string, aggregateVersion: number, payload: Record<string, unknown>): string {
  const event: RealtimeEnvelope = {
    sequenceId: aggregateVersion,
    eventId: `evt-${aggregateVersion}`,
    type,
    schemaVersion: 1,
    aggregateType: "POS_ORDER",
    aggregateId: payload.id as string,
    aggregateVersion,
    occurredAt: "2026-08-15T08:00:00Z",
    tenantId: "tenant-1",
    propertyId: "property-1",
    outletId: "outlet-1",
    payload,
  };
  return JSON.stringify(event);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
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

describe("ActiveOrders", () => {
  it("renders the empty state before any event arrives", async () => {
    const socket = renderActiveOrders();
    await flush();
    socket.open();
    await flush();
    expect(
      await screen.findByText(/No orders on this connection yet/),
    ).toBeInTheDocument();
  });

  it("shows an order when order.created arrives over the STOMP stream", async () => {
    const socket = renderActiveOrders();
    await flush();
    socket.open();
    await flush();
    socket.emit(
      envelope("pos.order.created", 1, {
        id: "order-1",
        orderNumber: "ORD-1042",
        orderType: "DINE_IN",
        tableNumber: "T12",
        status: "open",
        settlementStatus: "UNSETTLED",
        totalAmount: 1180,
        items: [{ id: "item-1", name: "Lunch", quantity: 1 }],
      }),
    );
    expect(await screen.findByText("ORD-1042")).toBeInTheDocument();
    expect(screen.getByText(/T12/)).toBeInTheDocument();
    expect(screen.getByText("1180")).toBeInTheDocument();
  });

  it("updates an order in place on order.updated and removes it on order.settled", async () => {
    const socket = renderActiveOrders();
    await flush();
    socket.open();
    await flush();
    socket.emit(
      envelope("pos.order.created", 1, {
        id: "order-1",
        orderNumber: "ORD-1042",
        orderType: "DINE_IN",
        status: "open",
        settlementStatus: "UNSETTLED",
        totalAmount: 1180,
        items: [],
      }),
    );
    await screen.findByText("ORD-1042");

    socket.emit(
      envelope("pos.order.updated", 2, {
        id: "order-1",
        orderNumber: "ORD-1042",
        orderType: "DINE_IN",
        status: "open",
        settlementStatus: "PENDING",
        totalAmount: 1770,
        items: [],
      }),
    );
    await waitFor(() => expect(screen.getByText("1770")).toBeInTheDocument());

    socket.emit(
      envelope("pos.order.settled", 3, {
        id: "order-1",
        orderNumber: "ORD-1042",
        orderType: "DINE_IN",
        status: "settled",
        settlementStatus: "SETTLED",
        totalAmount: 1770,
        items: [],
      }),
    );
    await waitFor(() => {
      // The open-order card is gone, the order moved to the settled strip.
      expect(screen.queryByTestId("order-1")).not.toBeInTheDocument();
      expect(screen.getByTestId("settled-order-1")).toBeInTheDocument();
    });
  });

  it("sends the order to the kitchen from the card action", async () => {
    const socket = renderActiveOrders();
    await flush();
    socket.open();
    await flush();
    socket.emit(
      envelope("pos.order.created", 1, {
        id: "order-1",
        orderNumber: "ORD-1042",
        orderType: "DINE_IN",
        status: "open",
        settlementStatus: "UNSETTLED",
        totalAmount: 1000,
        items: [],
      }),
    );
    const sendButton = await screen.findByTestId("send-order-1");
    await userEvent.click(sendButton);
    await waitFor(() => expect(sendOrderSpy).toHaveBeenCalledWith("property-1", "order-1"));
  });

  it("renders backfilled committed orders before the socket opens and applies later live updates", async () => {
    const backfilled = envelope("pos.order.created", 1, {
      id: "order-1",
      orderNumber: "ORD-1042",
      orderType: "DINE_IN",
      tableNumber: "T12",
      status: "open",
      settlementStatus: "UNSETTLED",
      totalAmount: 1180,
      items: [{ id: "item-1", name: "Lunch", quantity: 1 }],
    });
    const socket = renderActiveOrders(async () => [JSON.parse(backfilled) as RealtimeEnvelope]);
    await flush();
    // Backfill is emitted through the same pipeline, so the order is visible
    // without the socket being open at all.
    expect(await screen.findByText("ORD-1042")).toBeInTheDocument();
    expect(screen.getByText(/T12/)).toBeInTheDocument();

    socket.open();
    await flush();
    // The live duplicate of the backfilled position is dropped; the later
    // committed update passes through and re-renders.
    socket.emit(backfilled);
    socket.emit(
      envelope("pos.order.updated", 2, {
        id: "order-1",
        orderNumber: "ORD-1042",
        orderType: "DINE_IN",
        tableNumber: "T12",
        status: "open",
        settlementStatus: "UNSETTLED",
        totalAmount: 1980,
        items: [{ id: "item-1", name: "Lunch", quantity: 1 }],
      }),
    );
    await waitFor(() => expect(screen.getByText("1980")).toBeInTheDocument());
  });
});