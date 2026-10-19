import { beforeEach, describe, expect, it, vi } from "vitest";
import { NativePeakSocket } from "./nativePeakSocket";

type SocketEvent = { kind: "open" | "message" | "error" | "close"; data?: string };

// The till's native side as src-tauri/src/socket.rs runs it: the command
// connects, says "open" while the handshake is still its own, and only then
// returns the connection's number.
const native = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  duringOpen: [] as SocketEvent[],
  refuse: null as string | null,
  closed: [] as number[],
}));

vi.mock("@tauri-apps/api/core", () => {
  class Channel<T> {
    onmessage: (message: T) => void = () => {};
  }
  return {
    Channel,
    invoke: vi.fn(async (command: string, args: Record<string, unknown>) => {
      if (command === "open_peak_socket") {
        if (native.refuse) throw native.refuse;
        for (const event of native.duringOpen) {
          (args.events as Channel<SocketEvent> | undefined)?.onmessage(event);
          native.listeners.get("peak-socket://7")?.({ payload: event });
        }
        return 7;
      }
      if (command === "close_peak_socket") native.closed.push(args.id as number);
      return undefined;
    }),
  };
});
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    native.listeners.set(name, handler);
    return () => native.listeners.delete(name);
  }),
}));

const URL = "wss://api.example.test/api/v1/pos/realtime/ws";
const HEADERS = { Authorization: `Bearer ${"t".repeat(40)}`, Origin: "tauri://localhost" };

describe("NativePeakSocket", () => {
  beforeEach(() => {
    native.listeners.clear();
    native.duringOpen = [];
    native.refuse = null;
    native.closed = [];
  });

  // Bahari's till sat at "connecting" while Yetu held its connection open:
  // "open" came before the till could listen for it, so it never subscribed
  // to orders or the kitchen board and lived on asking every few seconds.
  it("is open as soon as the native side says so, before it hands over the connection's number", async () => {
    native.duringOpen = [{ kind: "open" }, { kind: "message", data: '{"id":"e1"}' }];
    const socket = new NativePeakSocket(URL, HEADERS);
    const opened = vi.fn();
    const received = vi.fn();
    socket.onopen = opened;
    socket.onmessage = received;
    await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    expect(socket.readyState).toBe(1);
    expect(received.mock.calls[0][0].data).toBe('{"id":"e1"}');
  });

  it("a connection refused says closed, so the till tries again", async () => {
    native.refuse = "Connection refused";
    const socket = new NativePeakSocket(URL, HEADERS);
    const closed = vi.fn();
    socket.onclose = closed;
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
    expect(socket.readyState).toBe(3);
  });

  it("closed while still connecting: what arrives is closed, and it says closed once", async () => {
    native.duringOpen = [{ kind: "open" }];
    const socket = new NativePeakSocket(URL, HEADERS);
    const opened = vi.fn();
    const closed = vi.fn();
    socket.onopen = opened;
    socket.onclose = closed;
    socket.close();
    await vi.waitFor(() => expect(native.closed).toEqual([7]));
    expect(opened).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
