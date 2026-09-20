import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RealtimeClient } from "../realtime/RealtimeClient";
import { RealtimeProvider } from "../realtime/RealtimeProvider";
import { Kitchen } from "./Kitchen";
import type { POSOrder } from "../lib/posContracts";

vi.mock("../lib/env", () => ({
  devIdentityFromEnv: () => ({ tenantId: "tenant-1", userId: "user-1", propertyId: "property-1", outletId: "outlet-1" }),
}));

const ordersStore = new Map<string, POSOrder>();

const { listOrdersSpy, transitionStatusSpy, getOrderSpy } = vi.hoisted(() => ({
  listOrdersSpy: vi.fn(async () => ({ data: Array.from(ordersStore.values()), error: null })),
  transitionStatusSpy: vi.fn(async () => ({ data: undefined, error: null })),
  getOrderSpy: vi.fn(async (orderId: string) => ({ data: ordersStore.get(orderId), error: null })),
}));

vi.mock("../lib/posApi", () => ({
  createPosApi: () => ({
    listOrders: listOrdersSpy,
    transitionStatus: transitionStatusSpy,
    getOrder: getOrderSpy,
  }),
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSession: () => ({
    identity: { mode: "POS", terminalName: "Kitchen peek" },
    phase: "ready",
    switchStaff: vi.fn(),
  }),
}));

class FakeSocket {
  binaryType = "blob";
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  send(data: string | ArrayBuffer): void {
    this.sent.push(String(data));
  }
  close(): void {}
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
    resource_type: "POS_ORDER",
    resource_id: orderId,
    occurred_at: "2026-08-15T08:00:00Z",
    organization_id: "tenant-1",
    property_id: "property-1",
    data: { outletId: "outlet-1" },
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function renderKitchen() {
  const socket = new FakeSocket();
  const client = new RealtimeClient({ createSocket: () => socket as unknown as WebSocket, cursorStorage: { get: () => null, set: () => {} } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider client={client} queryClient={queryClient}>
        <Kitchen />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  return socket;
}

const SENT_ORDER: POSOrder = {
  id: "order-1",
  shiftId: "shift-1",
  orderNumber: "K-12",
  status: "SENT",
  serviceType: "DINE_IN",
  tableLabel: "T4",
  initiatedById: "staff-1",
  initiatedByName: "Amina Hassan",
  subtotalMinor: 1000,
  discountMinor: 0,
  discountKind: "NONE",
  discountInput: 0,
  taxMinor: 180,
  totalMinor: 1180,
  paidMinor: 0,
  remainingMinor: 1180,
  version: 2,
  items: [{ id: "line-1", productId: "p1", name: "Nyama Choma", quantity: 2, unitPriceMinor: 500, taxMinor: 90, totalMinor: 1180, status: "SENT" }],
};

describe("Kitchen", () => {
  afterEach(() => {
    ordersStore.clear();
    listOrdersSpy.mockClear();
    transitionStatusSpy.mockClear();
  });

  it("subscribes to the outlet kitchen topic and refetches REST when an order is sent", async () => {
    const socket = renderKitchen();
    expect(await screen.findByText(/No kitchen tickets right now/)).toBeInTheDocument();

    ordersStore.set("order-1", SENT_ORDER);
    socket.open();
    await flush();
    socket.emit(announce(1, "pos.order.sent", "order-1"));
    expect(await screen.findByText("K-12")).toBeInTheDocument();
    expect(screen.getByTestId("waiter-order-1")).toHaveTextContent("Amina Hassan");
    await waitFor(() => expect(listOrdersSpy.mock.calls.length).toBeGreaterThan(1));
  });

  it("advances a sent order to PREPARING using the current order version, never a per-ticket void", async () => {
    ordersStore.set("order-1", SENT_ORDER);
    renderKitchen();
    await screen.findByText("K-12");
    expect(screen.queryByTestId("void-order-1")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("bump-order-1"));
    await waitFor(() => expect(transitionStatusSpy).toHaveBeenCalledWith("order-1", "PREPARING", 2, expect.any(String)));
  });
});
