import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { POSOrder } from "../lib/posContracts";
import { RealtimeClient } from "../realtime/RealtimeClient";
import { RealtimeProvider } from "../realtime/RealtimeProvider";
import { PAID_LIST_REFRESH_SECONDS } from "./ordersSettings";
import { usePaidOrders } from "./usePaidOrders";

vi.mock("../lib/env", () => ({
  devIdentityFromEnv: () => ({ tenantId: "tenant-1", userId: "user-1", propertyId: "property-1", outletId: "outlet-1" }),
}));

const { listOrders } = vi.hoisted(() => ({
  listOrders: vi.fn(async (_active?: boolean) => ({ data: [] as POSOrder[], error: null })),
}));

vi.mock("../lib/posApi", () => ({ createPosApi: () => ({ listOrders }) }));

class FakeSocket {
  binaryType = "blob";
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  send(): void {}
  close(): void {}
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(sequence: number, type: string): void {
    this.onmessage?.({
      data: JSON.stringify({
        sequence_id: sequence,
        id: `evt-${sequence}`,
        type,
        version: 1,
        resource_type: "pos_order",
        resource_id: `order-${sequence}`,
        occurred_at: new Date().toISOString(),
        organization_id: "tenant-1",
        property_id: "property-1",
        data: { outletId: "outlet-1" },
      }),
    });
  }
}

function Probe({ enabled }: { enabled: boolean }) {
  const paid = usePaidOrders("shift-1", enabled);
  return <p data-testid="probe">{paid.isSuccess ? "loaded" : "waiting"}</p>;
}

async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function renderProbe(enabled = true) {
  const socket = new FakeSocket();
  const client = new RealtimeClient({ createSocket: () => socket as unknown as WebSocket, cursorStorage: { get: () => null, set: () => {} } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider client={client} queryClient={queryClient}>
        <Probe enabled={enabled} />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  return { socket, view, queryClient, client };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  listOrders.mockClear();
});

afterEach(() => vi.useRealTimers());

describe("usePaidOrders", () => {
  it("is the named setting: 30 seconds", () => {
    expect(PAID_LIST_REFRESH_SECONDS).toBe(30);
  });

  it("asks Yetu only when the Paid tab is open", async () => {
    renderProbe(false);
    await flush();
    expect(listOrders).not.toHaveBeenCalled();
  });

  it("a payment at the outlet marks the list out of date; it is asked for again on the next refresh, once", async () => {
    const { socket } = renderProbe();
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("loaded"));
    expect(listOrders).toHaveBeenCalledWith(false);
    socket.open();
    // A (re)connection asks for everything again (the realtime provider's resync).
    await flush();
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("loaded"));
    const before = listOrders.mock.calls.length;
    socket.emit(1, "pos.order.payment_recorded");
    socket.emit(2, "pos.order.closed");
    socket.emit(3, "pos.order.payment_recorded");
    await flush();
    expect(listOrders).toHaveBeenCalledTimes(before);
    await act(async () => vi.advanceTimersByTime(PAID_LIST_REFRESH_SECONDS * 1000));
    await waitFor(() => expect(listOrders).toHaveBeenCalledTimes(before + 1));
    await act(async () => vi.advanceTimersByTime(PAID_LIST_REFRESH_SECONDS * 1000));
    await flush();
    expect(listOrders).toHaveBeenCalledTimes(before + 1);
  });

  it("doesn't ask again on a refresh when nothing was paid meanwhile", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("loaded"));
    await act(async () => vi.advanceTimersByTime(PAID_LIST_REFRESH_SECONDS * 1000 * 3));
    await flush();
    expect(listOrders).toHaveBeenCalledTimes(1);
  });
});
