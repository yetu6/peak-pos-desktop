import { QueryClient } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import { RealtimeClient } from "./RealtimeClient";
import { RealtimeProvider, useRealtime } from "./RealtimeProvider";

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { reason: string }) => void) | null = null;
  send(value: string) {
    this.sent.push(value);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ reason: "closed" });
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

function Phase() {
  return <p data-testid="phase">{useRealtime().state.phase}</p>;
}

function setup() {
  const sockets: FakeSocket[] = [];
  const client = new RealtimeClient({
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    // Catch-up runs before the socket opens; it resolves on a later tick, as a fetch would.
    backfillEvents: () => new Promise((resolve) => setTimeout(() => resolve([]), 0)),
  });
  return { client, sockets };
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));

describe("RealtimeProvider", () => {
  it("opens exactly one socket under React StrictMode, and it stays open and connected", async () => {
    const { client, sockets } = setup();
    render(
      <StrictMode>
        <RealtimeProvider client={client} queryClient={new QueryClient()}>
          <Phase />
        </RealtimeProvider>
      </StrictMode>,
    );
    await settle();
    expect(sockets).toHaveLength(1);
    act(() => sockets[0].open());
    expect(sockets[0].readyState).toBe(1);
    expect(screen.getByTestId("phase")).toHaveTextContent("connected");
  });

  it("closes the socket for good when the till leaves", async () => {
    const { client, sockets } = setup();
    const view = render(
      <RealtimeProvider client={client} queryClient={new QueryClient()}>
        <Phase />
      </RealtimeProvider>,
    );
    await settle();
    act(() => sockets[0].open());
    view.unmount();
    await settle();
    expect(sockets[0].readyState).toBe(3);
    expect(sockets).toHaveLength(1);
  });
});
