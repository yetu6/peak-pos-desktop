import { createBackoff, type Backoff } from "./backoff";
import type { ConnectionState, RealtimeEnvelope } from "./RealtimeEnvelope";
import { destinationOf, type SubscriptionTarget } from "./subscriptions";

export interface RealtimeClientOptions {
  createSocket: () => WebSocket;
  backfillEvents?: (after: number) => Promise<RealtimeEnvelope[]>;
  cursorStorage?: { get: () => number | null; set: (cursor: number) => void };
  /** Retained for caller compatibility; protocol ping/pong is handled natively. */
  livenessWindowMs?: number;
  backoff?: Backoff;
}

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private readonly backoff: Backoff;
  private readonly targets = new Map<string, number>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private disposed = false;
  // Each connect is one attempt; a later connect or a dispose makes the earlier
  // attempt's late catch-up, socket and close count for nothing.
  private generation = 0;
  private starting = false;
  private cursor: number;
  private state: ConnectionState = { phase: "disconnected", attempt: 0, lastError: null, established: false, resyncGeneration: 0 };
  onEvent: (event: RealtimeEnvelope) => void = () => {};
  onStateChange: (state: ConnectionState) => void = () => {};
  onResync: (generation: number) => void = () => {};

  constructor(private readonly options: RealtimeClientOptions) {
    this.backoff = options.backoff ?? createBackoff();
    this.cursor = options.cursorStorage?.get() ?? 0;
  }

  get connectionState(): ConnectionState { return this.state; }

  subscribe(target: SubscriptionTarget): void {
    const topic = destinationOf(target);
    if (!topic) return;
    const count = (this.targets.get(topic) ?? 0) + 1;
    this.targets.set(topic, count);
    if (count === 1 && this.socket?.readyState === WebSocket.OPEN) this.command("subscribe", topic);
  }

  unsubscribe(target: SubscriptionTarget): void {
    const topic = destinationOf(target);
    if (!topic) return;
    const count = (this.targets.get(topic) ?? 0) - 1;
    if (count > 0) { this.targets.set(topic, count); return; }
    this.targets.delete(topic);
    if (this.socket?.readyState === WebSocket.OPEN) this.command("unsubscribe", topic);
  }

  /**
   * Opens the connection. Safe to call again after dispose(): React's
   * StrictMode runs an effect, its cleanup, then the effect again, and the
   * till must end up with exactly one open socket.
   */
  connect(): void {
    if (this.socket || this.starting) return;
    this.disposed = false;
    this.starting = true;
    const generation = ++this.generation;
    void this.runBackfill().finally(() => {
      if (generation !== this.generation) return;
      this.starting = false;
      this.open(generation);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.starting = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setState({ phase: "disconnected" });
  }

  private async runBackfill(): Promise<void> {
    if (!this.options.backfillEvents) return;
    try { (await this.options.backfillEvents(this.cursor)).forEach((event) => this.deliver(event)); } catch { /* snapshots recover on connect */ }
  }

  private open(generation: number): void {
    if (this.disposed || generation !== this.generation) return;
    this.setState({ phase: this.state.established ? "reconnecting" : "connecting", attempt: this.attempt });
    const socket = this.options.createSocket();
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.targets.forEach((_count, topic) => this.command("subscribe", topic));
      const generation = this.state.resyncGeneration + 1;
      this.setState({ phase: "connected", attempt: 0, lastError: null, established: true, resyncGeneration: generation });
      this.onResync(generation);
    };
    socket.onmessage = (message) => {
      const event = parseEnvelope(String(message.data));
      if (event) this.deliver(event);
    };
    socket.onerror = () => this.setState({ lastError: "websocket error" });
    socket.onclose = (event) => {
      if (this.socket === socket) this.socket = null;
      if (!this.disposed && generation === this.generation) this.scheduleReconnect(event.reason || "websocket closed");
    };
  }

  private command(action: "subscribe" | "unsubscribe", topic: string): void { this.socket?.send(JSON.stringify({ action, topic })); }
  private deliver(event: RealtimeEnvelope): void {
    if (event.sequenceId <= this.cursor) return;
    this.cursor = event.sequenceId;
    this.options.cursorStorage?.set(this.cursor);
    this.onEvent(event);
  }
  private scheduleReconnect(reason: string): void {
    this.attempt += 1;
    this.setState({ phase: "reconnecting", attempt: this.attempt, lastError: reason });
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, this.backoff.delayMs(this.attempt));
  }
  private setState(patch: Partial<ConnectionState>): void { this.state = { ...this.state, ...patch }; this.onStateChange(this.state); }
}

export function parseEnvelope(body: string): RealtimeEnvelope | null {
  try {
    const raw = JSON.parse(body) as Record<string, any>;
    if (typeof raw.id !== "string" || typeof raw.type !== "string" || typeof raw.sequence_id !== "number") return null;
    const data = raw.data && typeof raw.data === "object" ? raw.data : {};
    return { sequenceId: raw.sequence_id, eventId: raw.id, type: raw.type, schemaVersion: raw.version ?? 1, aggregateType: typeof raw.resource_type === "string" ? raw.resource_type.toUpperCase() : null, aggregateId: raw.resource_id ?? null, aggregateVersion: raw.version ?? null, occurredAt: raw.occurred_at, tenantId: raw.organization_id, propertyId: raw.property_id, outletId: data.outletId ?? null, payload: data };
  } catch { return null; }
}
