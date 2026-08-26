import { describe, expect, it, vi } from "vitest";
import { RealtimeClient, parseEnvelope } from "./RealtimeClient";

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { reason: string }) => void) | null = null;
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}

const envelope = (sequence = 1) => ({ sequence_id: sequence, id: `e${sequence}`, type: "pos.order.created", occurred_at: "2026-08-25T10:00:00Z", organization_id: "o1", property_id: "p1", resource_type: "pos_order", resource_id: "order-1", version: 1, data: { outletId: "outlet-1" } });

describe("Go POS realtime client", () => {
  it("uses JSON outlet subscriptions and canonical envelopes", async () => {
    const socket = new FakeSocket();
    const client = new RealtimeClient({ createSocket: () => socket as unknown as WebSocket });
    const seen = vi.fn(); client.onEvent = seen;
    client.subscribe({ kind: "outletOrders", outletId: "outlet-1" });
    client.connect(); await Promise.resolve(); socket.open();
    expect(JSON.parse(socket.sent[0]!)).toEqual({ action: "subscribe", topic: "pos.outlet.outlet-1" });
    socket.message(envelope());
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ sequenceId: 1, aggregateId: "order-1", outletId: "outlet-1" }));
  });

  it("deduplicates by committed property-stream sequence", async () => {
    const socket = new FakeSocket(); const seen = vi.fn();
    const client = new RealtimeClient({ createSocket: () => socket as unknown as WebSocket }); client.onEvent = seen;
    client.connect(); await Promise.resolve(); socket.open(); socket.message(envelope(2)); socket.message(envelope(2));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed or legacy STOMP payloads", () => {
    expect(parseEnvelope("CONNECTED\n\n\u0000")).toBeNull();
    expect(parseEnvelope(JSON.stringify({ eventId: "old" }))).toBeNull();
  });
});
