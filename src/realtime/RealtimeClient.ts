import { Client, type IMessage, type StompSubscription } from "@stomp/stompjs";
import { createBackoff, type Backoff } from "./backoff";
import type { ConnectionState, RealtimeEnvelope } from "./RealtimeEnvelope";
import { destinationOf, type SubscriptionTarget } from "./subscriptions";

export interface RealtimeClientOptions {
  /** Socket factory; injectable so tests can drive a fake backend. */
  createSocket: () => WebSocket;
  /**
   * REST backfill of committed events after a cursor. When set, the client
   * replays the gap before opening the live stream and deduplicates live
   * envelopes whose committed position is already covered.
   */
  backfillEvents?: (after: number) => Promise<RealtimeEnvelope[]>;
  /** Persisted high-water mark of seen positions; survives restarts. */
  cursorStorage?: { get: () => number | null; set: (cursor: number) => void };
  /** App-level liveness window: no inbound frame for this long forces reconnect. */
  livenessWindowMs?: number;
  backoff?: Backoff;
}

const STOMP_HEARTBEAT_MS = 10_000;

export class RealtimeClient {
  private readonly options: RealtimeClientOptions;
  private readonly backoff: Backoff;
  private readonly targets = new Set<string>();
  private readonly targetCounts = new Map<string, number>();
  private readonly subscriptions = new Map<string, StompSubscription>();
  private stomp: Client | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private livenessTimer: ReturnType<typeof setInterval> | null = null;
  private lastFrameAt = 0;
  private attempt = 0;
  private state: ConnectionState = {
    phase: "disconnected",
    attempt: 0,
    lastError: null,
    established: false,
    resyncGeneration: 0,
  };
  private disposed = false;
  /** Highest committed journal position seen (backfill or live); the dedup watermark. */
  private cursor: number;

  /** Callbacks are assignable so the app can wire them after construction. */
  onEvent: (event: RealtimeEnvelope) => void = () => {};
  onStateChange: (state: ConnectionState) => void = () => {};
  onResync: (generation: number) => void = () => {};

  constructor(options: RealtimeClientOptions) {
    this.options = options;
    this.backoff = options.backoff ?? createBackoff();
    this.cursor = this.readCursor();
  }

  private readCursor(): number {
    const stored = this.options.cursorStorage?.get();
    return stored === null || stored === undefined || !Number.isFinite(stored) ? 0 : stored;
  }

  private writeCursor(cursor: number): void {
    this.cursor = Math.max(this.cursor, cursor);
    this.options.cursorStorage?.set(this.cursor);
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  subscribe(target: SubscriptionTarget): void {
    const destination = destinationOf(target);
    const count = (this.targetCounts.get(destination) ?? 0) + 1;
    this.targetCounts.set(destination, count);
    this.targets.add(destination);
    if (count === 1 && this.stomp?.connected) {
      this.subscribeDestination(destination);
    }
  }

  unsubscribe(target: SubscriptionTarget): void {
    const destination = destinationOf(target);
    const remaining = (this.targetCounts.get(destination) ?? 0) - 1;
    if (remaining > 0) {
      this.targetCounts.set(destination, remaining);
      return;
    }
    this.targetCounts.delete(destination);
    this.targets.delete(destination);
    this.subscriptions.get(destination)?.unsubscribe();
    this.subscriptions.delete(destination);
  }

  connect(): void {
    if (this.disposed) return;
    if (this.options.backfillEvents) {
      void this.runBackfill().finally(() => this.activateStomp());
    } else {
      this.activateStomp();
    }
  }

  private async runBackfill(): Promise<void> {
    try {
      const events = await this.options.backfillEvents!(this.cursor);
      events.forEach((event) => {
        this.writeCursor(event.sequenceId);
        this.onEvent(event);
      });
    } catch {
      // Backfill failure must never block the live stream: the cursor stays at
      // its last committed position, so the next reconnect retries the gap.
    }
  }

  private activateStomp(): void {
    if (this.disposed) return;
    this.setState({ phase: "connecting", attempt: this.attempt });
    const stomp = new Client({
      webSocketFactory: () => this.options.createSocket(),
      reconnectDelay: 0,
      heartbeatIncoming: STOMP_HEARTBEAT_MS,
      heartbeatOutgoing: STOMP_HEARTBEAT_MS,
      beforeConnect: () => this.setState({ phase: "connecting" }),
      onConnect: () => {
        this.attempt = 0;
        this.startLivenessWatch();
        this.targets.forEach((destination) => this.subscribeDestination(destination));
        const generation = this.state.resyncGeneration + 1;
        this.setState({
          phase: "connected",
          attempt: 0,
          lastError: null,
          established: true,
          resyncGeneration: generation,
        });
        this.onResync(generation);
      },
      onWebSocketError: (frame) => {
        this.handleLoss(frame?.headers?.message ?? "websocket error");
      },
      onWebSocketClose: (frame) => {
        this.handleLoss(frame?.reason ?? "websocket closed");
      },
      onStompError: (frame) => {
        this.setState({ lastError: frame.headers.message ?? "STOMP error" });
      },
    });
    this.stomp = stomp;
    stomp.activate();
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.livenessTimer) clearInterval(this.livenessTimer);
    this.stomp?.deactivate();
    this.stomp = null;
    this.setState({ phase: "disconnected" });
  }

  private subscribeDestination(destination: string): void {
    const existing = this.subscriptions.get(destination);
    if (existing) existing.unsubscribe();
    const subscription = this.stomp?.subscribe(destination, (message) => {
      this.onMessage(message);
    });
    if (subscription) {
      this.subscriptions.set(destination, subscription);
    }
  }

  private onMessage(message: IMessage): void {
    this.lastFrameAt = Date.now();
    const event = parseEnvelope(message.body);
    if (!event) return;
    if (event.sequenceId <= this.cursor) {
      // Already covered by the REST backfill: the committed position makes the
      // live copy a duplicate, so it is dropped instead of double-applied.
      return;
    }
    this.writeCursor(event.sequenceId);
    this.onEvent(event);
  }

  private handleLoss(reason: string): void {
    if (this.disposed) return;
    this.stopLivenessWatch();
    const nextAttempt = this.attempt + 1;
    this.attempt = nextAttempt;
    this.setState({
      phase: "reconnecting",
      attempt: nextAttempt,
      lastError: reason,
    });
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.disposed) this.connect();
    }, this.backoff.delayMs(nextAttempt));
  }

  private startLivenessWatch(): void {
    this.lastFrameAt = Date.now();
    const windowMs = this.options.livenessWindowMs ?? 30_000;
    this.livenessTimer = setInterval(() => {
      if (Date.now() - this.lastFrameAt > windowMs) {
        this.stomp?.deactivate();
        this.handleLoss(`no frame within ${windowMs} ms`);
      }
    }, windowMs / 2);
  }

  private stopLivenessWatch(): void {
    if (this.livenessTimer) clearInterval(this.livenessTimer);
    this.livenessTimer = null;
  }

  private setState(patch: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...patch };
    this.onStateChange(this.state);
  }
}

function parseEnvelope(body: string): RealtimeEnvelope | null {
  try {
    const raw = JSON.parse(body) as Partial<RealtimeEnvelope>;
    if (
      typeof raw.eventId !== "string" ||
      typeof raw.type !== "string" ||
      typeof raw.sequenceId !== "number"
    ) {
      return null;
    }
    return raw as RealtimeEnvelope;
  } catch {
    return null;
  }
}