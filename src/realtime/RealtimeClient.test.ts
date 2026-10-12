import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("connect after dispose (a StrictMode remount)", () => {
  it("connects again with one socket: the first attempt's late catch-up opens nothing", async () => {
    const sockets: FakeSocket[] = [];
    let finishFirst: () => void = () => {};
    let calls = 0;
    const client = new RealtimeClient({
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      backfillEvents: () => {
        calls += 1;
        if (calls === 1) return new Promise((resolve) => (finishFirst = () => resolve([])));
        return Promise.resolve([]);
      },
    });
    client.connect();
    client.dispose();
    client.connect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sockets).toHaveLength(1);
    finishFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sockets).toHaveLength(1);
  });
});

describe("a socket from before a dispose", () => {
  it("closing late doesn't make the current connection look like it is reconnecting", async () => {
    const sockets: FakeSocket[] = [];
    const client = new RealtimeClient({
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });
    client.connect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    sockets[0].open();
    client.dispose();
    client.connect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    sockets[1].open();
    expect(client.connectionState.phase).toBe("connected");
    sockets[0].onclose?.({ reason: "closed late" });
    expect(client.connectionState.phase).toBe("connected");
    client.dispose();
  });
});

describe("after a drop (the reconnect storm)", () => {
  /** A client whose sockets the test opens and drops, on a clock the test moves. */
  function dropping(options: { stableAfterMs?: number } = {}) {
    vi.useFakeTimers();
    let now = 0;
    const sockets: FakeSocket[] = [];
    const attempts: number[] = [];
    const resyncs: number[] = [];
    const client = new RealtimeClient({
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      backoff: {
        delayMs: (attempt) => {
          attempts.push(attempt);
          return 1_000;
        },
      },
      now: () => now,
      ...options,
    });
    client.onResync = (generation) => resyncs.push(generation);
    const advance = async (ms: number) => {
      now += ms;
      await vi.advanceTimersByTimeAsync(ms);
    };
    return { client, sockets, attempts, resyncs, advance };
  }

  afterEach(() => vi.useRealTimers());

  it("keeps backing off while each new connection drops straight after it opens", async () => {
    const { client, sockets, attempts, advance } = dropping({ stableAfterMs: 10_000 });
    client.connect();
    await advance(0);
    for (let round = 0; round < 4; round++) {
      sockets.at(-1)!.open();
      await advance(50);
      sockets.at(-1)!.onclose?.({ reason: "text messages required" });
      await advance(1_000);
    }
    expect(attempts).toEqual([1, 2, 3, 4]);
    client.dispose();
  });

  it("starts the backoff again once a connection has stayed up", async () => {
    const { client, sockets, attempts, advance } = dropping({ stableAfterMs: 10_000 });
    client.connect();
    await advance(0);
    sockets[0].open();
    await advance(50);
    sockets[0].onclose?.({ reason: "dropped" });
    await advance(1_000);
    sockets[1].open();
    await advance(10_000);
    sockets[1].onclose?.({ reason: "dropped" });
    await advance(1_000);
    expect(attempts).toEqual([1, 1]);
    client.dispose();
  });

  it("asks for a snapshot once per real reconnect, never on the first connect", async () => {
    const { client, sockets, resyncs, advance } = dropping();
    client.connect();
    await advance(0);
    sockets[0].open();
    expect(resyncs).toEqual([]);
    sockets[0].onclose?.({ reason: "dropped" });
    await advance(1_000);
    sockets[1].open();
    expect(resyncs).toHaveLength(1);
    client.dispose();
  });
});
