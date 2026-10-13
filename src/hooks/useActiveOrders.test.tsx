import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RealtimeClient } from "../realtime/RealtimeClient";
import { RealtimeProvider } from "../realtime/RealtimeProvider";
import { useActiveOrders } from "./usePosData";

/**
 * A kitchen display moving a station ticket changes the order's own status
 * on Yetu (fbc-peak internal/pos/stations.go syncOrderStatusFromStations),
 * but the only news Yetu sends is the ticket's: pos.station_ticket.status_changed.
 * Orders must ask again when it hears that, not wait for its next refresh.
 */

vi.mock("../lib/env", () => ({
  devIdentityFromEnv: () => ({ tenantId: "t1", userId: "u1", propertyId: "property-1", outletId: "outlet-1" }),
}));

const listOrders = vi.hoisted(() => vi.fn(async () => ({ data: [], response: new Response(null, { status: 200 }) })));
vi.mock("../lib/posApi", () => ({ createPosApi: () => ({ listOrders }) }));

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { reason: string }) => void) | null = null;
  send() {}
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

/** The envelope as Yetu's hub writes it for a station ticket step. */
function stationTicketEnvelope(sequence: number) {
  return {
    id: `event-${sequence}`,
    type: "pos.station_ticket.status_changed",
    sequence_id: sequence,
    resource_type: "pos_station_ticket",
    resource_id: "8a6f2c1e-4d0b-4c1a-9a51-0f6b8e2d7c10",
    occurred_at: "2026-10-12T14:05:00Z",
    organization_id: "organization-1",
    property_id: "property-1",
    version: 1,
    data: { outletId: "outlet-1", orderId: "0b1d5f0e-2b8e-4a77-9f3e-5a1c2d3e4f50", station: "KITCHEN", status: "READY" },
  };
}

function Orders() {
  const orders = useActiveOrders();
  return <p data-testid="orders">{orders.isSuccess ? "loaded" : "loading"}</p>;
}

describe("useActiveOrders", () => {
  it("asks Yetu again when a station ticket moves", async () => {
    const socket = new FakeSocket();
    const client = new RealtimeClient({ createSocket: () => socket as unknown as WebSocket });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RealtimeProvider client={client} queryClient={new QueryClient()}>
          <Orders />
        </RealtimeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("orders")).toHaveTextContent("loaded"));
    await act(async () => {
      await Promise.resolve();
      socket.open();
    });
    const before = listOrders.mock.calls.length;
    act(() => socket.onmessage?.({ data: JSON.stringify(stationTicketEnvelope(7)) }));
    await waitFor(() => expect(listOrders.mock.calls.length).toBe(before + 1));
  });
});
