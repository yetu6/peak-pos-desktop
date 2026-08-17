type SocketEvent = {
  kind: "open" | "message" | "error" | "close";
  data?: string;
};

/**
 * WebSocket-shaped adapter over the Tauri Peak handshake. STOMP talks to this
 * the same way it talks to a browser socket; headers stay on the native side.
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
  private unlisten: (() => void) | null = null;
  private opened: Promise<void>;

  constructor(
    url: string,
    private readonly headers: { Authorization: string; Origin: string },
  ) {
    this.url = url;
    this.opened = this.connect();
  }

  private async connect(): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    const id = await invoke<number>("open_peak_socket", {
      url: this.url,
      authorization: this.headers.Authorization,
      origin: this.headers.Origin,
    });
    this.id = id;
    this.unlisten = await listen<SocketEvent>(`peak-socket://${id}`, (event) => {
      this.onNativeEvent(event.payload);
    });
  }

  private onNativeEvent(event: SocketEvent): void {
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
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
    this.unlisten?.();
    this.unlisten = null;
  }

  send(data: string): void {
    if (this.id == null) {
      void this.opened.then(() => this.send(data));
      return;
    }
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("send_peak_socket", { id: this.id, data }),
    );
  }

  close(): void {
    this.readyState = 2;
    if (this.id != null) {
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("close_peak_socket", { id: this.id }),
      );
    }
    this.unlisten?.();
    this.unlisten = null;
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }
}
