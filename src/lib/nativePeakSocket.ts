type SocketEvent = {
  kind: "open" | "message" | "error" | "close";
  data?: string;
};

/**
 * WebSocket-shaped adapter over the Tauri Peak handshake. Authorization and
 * Origin remain native handshake headers and never enter a URL or browser log.
 * The native side answers on a channel made before it connects.
 */
export class NativePeakSocket {
  readonly url: string;
  readyState = 0;
  binaryType: BinaryType = "arraybuffer";
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent<string>) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  private id: number | null = null;
  private closed = false;
  private opened: Promise<void>;

  constructor(
    url: string,
    private readonly headers: { Authorization: string; Origin: string },
  ) {
    this.url = url;
    this.opened = this.connect();
  }

  private async connect(): Promise<void> {
    const { Channel, invoke } = await import("@tauri-apps/api/core");
    // The channel is listening before the handshake starts: the native side
    // says "open" before the command returns the connection's number, and an
    // event listened for by that number missed it every time (the till sat
    // at "connecting" and never subscribed).
    const events = new Channel<SocketEvent>();
    events.onmessage = (event) => this.onNativeEvent(event);
    let id: number;
    try {
      id = await invoke<number>("open_peak_socket", {
        url: this.url,
        authorization: this.headers.Authorization,
        origin: this.headers.Origin,
        events,
      });
    } catch {
      // Refused or unreachable: closed, so the realtime client tries again.
      this.finish();
      return;
    }
    this.id = id;
    // Closed while the handshake ran: close what arrived.
    if (this.closed) void invoke("close_peak_socket", { id });
  }

  private onNativeEvent(event: SocketEvent): void {
    if (this.closed) return;
    if (event.kind === "open") {
      this.readyState = 1;
      this.onopen?.(new Event("open"));
      return;
    }
    if (event.kind === "message") {
      this.onmessage?.(
        new MessageEvent("message", { data: event.data ?? "" }),
      );
      return;
    }
    if (event.kind === "error") {
      this.onerror?.(new Event("error"));
      return;
    }
    this.finish();
  }

  /** Closed, said once whichever way it ends. */
  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }

  send(data: string): void {
    if (this.closed) return;
    if (this.id == null) {
      void this.opened.then(() => this.send(data));
      return;
    }
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("send_peak_socket", { id: this.id, data }),
    );
  }

  close(): void {
    if (this.closed) return;
    this.readyState = 2;
    if (this.id != null) {
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("close_peak_socket", { id: this.id }),
      );
    }
    this.finish();
  }
}
