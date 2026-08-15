import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeClient } from "./RealtimeClient";
import type { RealtimeEnvelope } from "./RealtimeEnvelope";
import { createBackoff } from "./backoff";

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
  /** Test helper: open the socket and complete the STOMP handshake. */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
    this.onmessage?.({ data: "CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\0" });
  }
  emitStompMessage(body: string): void {
    const subId = this.sent
      .find((f) => f.startsWith("SUBSCRIBE\n"))
      ?.match(/^id:(.+)$/m)?.[1];
    this.onmessage?.({
      data: `MESSAGE\ndestination:/topic/outlets/o1/orders\nsubscription:${subId ?? "sub-0"}\n\n${body}\0`,
    });
  }
  drop(): void {
    this.onclose?.();
  }
  error(): void {
    this.onerror?.();
  }
  sentFrames(): string[] {
    return this.sent;
  }
}

function subscribeFrames(frames: string[]): string[] {
  return frames.filter((f) => f.startsWith("SUBSCRIBE\n"));
}

/** @stomp/stompjs activates asynchronously; flush microtasks before asserting. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("RealtimeClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects, subscribes to requested destinations and delivers parsed envelopes", async () => {
    const sockets: FakeSocket[] = [];
    const events: unknown[] = [];
    const states: string[] = [];
    let resyncs = 0;
    const client = new RealtimeClient({ createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as unknown as WebSocket;
    } });
    client.onEvent = (e) => events.push(e);
    client.onStateChange = (s) => states.push(s.phase);
    client.onResync = () => resyncs++;

    client.subscribe({ kind: "outletOrders", outletId: "o1" });
    client.subscribe({ kind: "outletKitchen", outletId: "o1" });
    client.connect();
    await flush();
    expect(sockets).toHaveLength(1);

    sockets[0].open();
    await flush();
    expect(states).toContain("connected");
    expect(resyncs).toBe(1);

    const subs = subscribeFrames(sockets[0].sentFrames());
    expect(subs).toHaveLength(2);
    expect(subs.join("")).toContain("/topic/outlets/o1/orders");
    expect(subs.join("")).toContain("/topic/outlets/o1/kitchen");

    sockets[0].emitStompMessage(
      JSON.stringify({
        sequenceId: 1,
        eventId: "e1",
        type: "order.created",
        schemaVersion: 1,
        aggregateType: "POS_ORDER",
        aggregateId: "o1",
        aggregateVersion: 1,
        occurredAt: "2026-08-15T00:00:00Z",
        tenantId: "t1",
        propertyId: "p1",
        outletId: "o1",
        payload: { orderNumber: "ORD-1" },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "order.created", aggregateId: "o1" });

    client.dispose();
  });

  it("keeps a shared destination subscribed until the last subscriber leaves", async () => {
    const sockets: FakeSocket[] = [];
    const client = new RealtimeClient({
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s as unknown as WebSocket;
      },
    });
    const target = { kind: "propertyOperations" as const, propertyId: "p1" };
    client.subscribe(target);
    client.subscribe(target);
    client.connect();
    await flush();
    sockets[0].open();
    await flush();
    expect(subscribeFrames(sockets[0].sentFrames())).toHaveLength(1);

    client.unsubscribe(target);
    expect(subscribeFrames(sockets[0].sentFrames())).toHaveLength(1);
    expect(sockets[0].sentFrames().some((f) => f.startsWith("UNSUBSCRIBE\n"))).toBe(false);

    client.unsubscribe(target);
    expect(sockets[0].sentFrames().some((f) => f.startsWith("UNSUBSCRIBE\n"))).toBe(true);
    client.dispose();
  });

  it("resubscribes every target after a drop and reconnect", async () => {
    const sockets: FakeSocket[] = [];
    const client = new RealtimeClient({
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s as unknown as WebSocket;
      },
      backoff: createBackoff({ baseMs: 10, maxMs: 10, random: () => 0 }),
    });
    client.subscribe({ kind: "order", orderId: "ord-1" });
    client.connect();
    await flush();
    sockets[0].open();
    await flush();
    expect(subscribeFrames(sockets[0].sentFrames())).toHaveLength(1);

    sockets[0].drop();
    expect(client.connectionState.phase).toBe("reconnecting");
    expect(client.connectionState.attempt).toBe(1);

    vi.advanceTimersByTime(20);
    await flush();
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    await flush();
    expect(subscribeFrames(sockets[1].sentFrames())).toHaveLength(1);
    expect(subscribeFrames(sockets[1].sentFrames())[0]).toContain("/topic/orders/ord-1");

    client.dispose();
  });

  it("forces a reconnect when no inbound frame arrives within the liveness window", async () => {
    const sockets: FakeSocket[] = [];
    const errors: string[] = [];
    const phases: string[] = [];
    const client = new RealtimeClient({
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s as unknown as WebSocket;
      },
      livenessWindowMs: 100,
      backoff: createBackoff({ baseMs: 10, maxMs: 10, random: () => 0 }),
    });
    client.onStateChange = (s) => {
      phases.push(s.phase);
      if (s.lastError) errors.push(s.lastError);
    };
    client.connect();
    await flush();
    sockets[0].open();
    await flush();

    vi.advanceTimersByTime(250);
    expect(errors.join()).toContain("no frame");
    expect(phases).toContain("reconnecting");
    // The forced reconnect already opened a fresh socket.
    await flush();
    expect(sockets.length).toBeGreaterThanOrEqual(2);

    await flush();
    sockets[1].open();
    await flush();
    expect(client.connectionState.phase).toBe("connected");
    client.dispose();
  });

  it("denies nothing at the client and forwards STOMP errors to state", async () => {
    const sockets: FakeSocket[] = [];
    const client = new RealtimeClient({
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s as unknown as WebSocket;
      },
    });
    client.connect();
    await flush();
    sockets[0].open();
    await flush();
    // A STOMP ERROR frame must surface but not kill the connection.
    sockets[0].onmessage?.({
      data: "ERROR\nmessage:access denied for realtime subscription destination\n\n\0",
    });
    expect(client.connectionState.lastError).toContain("access denied");
    client.dispose();
  });

  it("backfills the gap before the live stream and deduplicates overlaps by position", async () => {
    const sockets: FakeSocket[] = [];
    const events: unknown[] = [];
    const backfillCalls: number[] = [];
    const stored: string[] = [];
    const client = new RealtimeClient({
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s as unknown as WebSocket;
      },
      backfillEvents: async (after) => {
        backfillCalls.push(after);
        return [
          JSON.parse(envelope(5, "pos.order.created", "order-9")) as RealtimeEnvelope,
          JSON.parse(envelope(6, "pos.order.updated", "order-9")) as RealtimeEnvelope,
        ];
      },
      cursorStorage: {
        get: () => null,
        set: (cursor) => stored.push(String(cursor)),
      },
    });
    client.onEvent = (e) => events.push(e);
    client.subscribe({ kind: "outletOrders", outletId: "o1" });
    client.connect();
    await flush();

    expect(backfillCalls).toEqual([0]);
    // Backfilled events are emitted before the socket is even opened.
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ sequenceId: 5, aggregateId: "order-9" });
    expect(stored.at(-1)).toBe("6");

    sockets[0].open();
    await flush();
    expect(client.connectionState.phase).toBe("connected");
    

    // The live copy of an already-backfilled position is dropped as a duplicate.
    sockets[0].emitStompMessage(envelope(6, "pos.order.updated", "order-9"));
    // A genuinely new committed position passes through.
    sockets[0].emitStompMessage(envelope(7, "pos.order.settled", "order-9"));
    expect(events).toHaveLength(3);
    expect(events[2]).toMatchObject({ sequenceId: 7, type: "pos.order.settled" });
    expect(stored.at(-1)).toBe("7");
    client.dispose();
  });

  it("resumes from the persisted cursor and re-backfills the gap on reconnect", async () => {
    const sockets: FakeSocket[] = [];
    const events: unknown[] = [];
    const backfillCalls: number[] = [];
    const client = new RealtimeClient({
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s as unknown as WebSocket;
      },
      backoff: createBackoff({ baseMs: 10, maxMs: 10, random: () => 0 }),
      backfillEvents: async (after) => {
        backfillCalls.push(after);
        return after === 0
          ? [JSON.parse(envelope(1, "pos.order.created", "order-1")) as RealtimeEnvelope]
          : [];
      },
      cursorStorage: { get: () => 1, set: () => {} },
    });
    client.onEvent = (e) => events.push(e);
    client.connect();
    await flush();
    sockets[0].open();
    await flush();
    expect(backfillCalls).toEqual([1]);
    expect(events).toHaveLength(0);

    sockets[0].drop();
    expect(client.connectionState.phase).toBe("reconnecting");
    vi.advanceTimersByTime(20);
    await flush();
    expect(backfillCalls).toEqual([1, 1]);
    expect(events).toHaveLength(0);
    client.dispose();
  });

  it("still opens the live stream when backfill fails", async () => {
    const sockets: FakeSocket[] = [];
    const client = new RealtimeClient({
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s as unknown as WebSocket;
      },
      backfillEvents: async () => {
        throw new Error("journal unavailable");
      },
      cursorStorage: { get: () => 0, set: () => {} },
    });
    client.connect();
    await flush();
    sockets[0].open();
    await flush();
    expect(client.connectionState.phase).toBe("connected");
    client.dispose();
  });
});

function envelope(sequenceId: number, type: string, aggregateId: string): string {
  return JSON.stringify({
    sequenceId,
    eventId: `evt-${sequenceId}`,
    type,
    schemaVersion: 1,
    aggregateType: "POS_ORDER",
    aggregateId,
    aggregateVersion: sequenceId,
    occurredAt: "2026-08-15T08:00:00Z",
    tenantId: "t1",
    propertyId: "p1",
    outletId: "o1",
    payload: {},
  });
}