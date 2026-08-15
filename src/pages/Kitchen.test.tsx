import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RealtimeClient } from "../realtime/RealtimeClient";
import { RealtimeProvider } from "../realtime/RealtimeProvider";
import { Kitchen } from "./Kitchen";
import type { RealtimeEnvelope } from "../realtime/RealtimeEnvelope";

vi.mock("../lib/env", () => ({
  devIdentityFromEnv: () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    propertyId: "property-1",
    outletId: "outlet-1",
  }),
}));

interface MockTicket {
  id: string;
  ticketNumber: string;
  orderId: string;
  status: string;
  sentAt: string;
  items: Array<{ id: string; itemName: string; quantity: number }>;
}

const ticketsStore = new Map<string, MockTicket>();

const { listKitchenTicketsSpy, transitionTicketSpy } = vi.hoisted(() => ({
  listKitchenTicketsSpy: vi.fn(async () => ({
    data: Array.from(ticketsStore.values()),
    error: null,
  })),
  transitionTicketSpy: vi.fn(async () => ({ data: {}, error: null })),
}));

vi.mock("../lib/posApi", () => ({
  createPosApi: () => ({
    listKitchenTickets: listKitchenTicketsSpy,
    transitionTicket: transitionTicketSpy,
  }),
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
      .find((f) => f.startsWith("SUBSCRIBE\n") && f.includes("/kitchen"))
      ?.match(/^id:(.+)$/m)?.[1];
    this.onmessage?.({
      data: `MESSAGE\ndestination:/topic/outlets/outlet-1/kitchen\nsubscription:${subId ?? "sub-0"}\n\n${body}\0`,
    });
  }
}

function announce(sequenceId: number, type: string, ticketId: string): string {
  const event: RealtimeEnvelope = {
    sequenceId,
    eventId: `evt-${sequenceId}`,
    type,
    schemaVersion: 1,
    aggregateType: "KITCHEN_TICKET",
    aggregateId: ticketId,
    aggregateVersion: sequenceId,
    occurredAt: "2026-08-15T08:00:00Z",
    tenantId: "tenant-1",
    propertyId: "property-1",
    outletId: "outlet-1",
    payload: { ticketId },
  };
  return JSON.stringify(event);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function renderKitchen() {
  const socket = new FakeSocket();
  const client = new RealtimeClient({
    createSocket: () => socket as unknown as WebSocket,
    cursorStorage: { get: () => null, set: () => {} },
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider client={client} queryClient={queryClient}>
        <Kitchen />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  return socket;
}

const TICKET: MockTicket = {
  id: "ticket-1",
  ticketNumber: "K-12",
  orderId: "order-1",
  status: "PENDING",
  sentAt: "2026-08-15T08:00:00Z",
  items: [{ id: "line-1", itemName: "Nyama Choma", quantity: 2 }],
};

describe("Kitchen", () => {
  afterEach(() => {
    ticketsStore.clear();
    listKitchenTicketsSpy.mockClear();
    transitionTicketSpy.mockClear();
  });

  it("subscribes to the outlet kitchen topic and refetches REST when a ticket is announced", async () => {
    const socket = renderKitchen();
    await flush();
    socket.open();
    await flush();
    expect(await screen.findByText(/Kitchen is quiet/)).toBeInTheDocument();
    expect(socket.sent.join("")).toContain("/topic/outlets/outlet-1/kitchen");

    ticketsStore.set("ticket-1", TICKET);
    socket.emit(announce(1, "pos.kitchen_ticket.created", "ticket-1"));
    expect(await screen.findByText("K-12")).toBeInTheDocument();
    await waitFor(() => expect(listKitchenTicketsSpy.mock.calls.length).toBeGreaterThan(1));
  });
});
