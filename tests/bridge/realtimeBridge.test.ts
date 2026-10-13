// @vitest-environment node
/**
 * The dev realtime bridge (scripts/realtime-bridge.mjs) in front of a stand-in
 * for Yetu's POS socket that keeps Yetu's own rules (fbc-peak
 * internal/pos/websocket.go readWebSocketCommands): only text frames, and a
 * binary frame closes the connection with 1003 "text messages required".
 */
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { startRealtimeBridge, type RealtimeBridge } from "../../scripts/realtime-bridge.mjs";

const quiet = { log: () => undefined, error: () => undefined };

interface StandIn {
  url: string;
  texts: string[];
  closes: Array<{ code: number; reason: string }>;
  close: () => Promise<void>;
}

/** Yetu's socket rules, and a delay before it accepts (Yetu checks the session first). */
async function standInYetu(acceptAfterMs: number): Promise<StandIn> {
  const texts: string[] = [];
  const closes: Array<{ code: number; reason: string }> = [];
  const server = new WebSocketServer({
    port: 0,
    verifyClient: (_info, done) => setTimeout(() => done(true), acceptAfterMs),
  });
  await once(server, "listening");
  server.on("connection", (socket) => {
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        closes.push({ code: 1003, reason: "text messages required" });
        socket.close(1003, "text messages required");
        return;
      }
      texts.push(String(data));
    });
  });
  const address = server.address() as { port: number };
  return {
    url: `ws://127.0.0.1:${address.port}/api/v1/pos/realtime/ws`,
    texts,
    closes,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

const until = async (check: () => boolean, ms = 2_000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

let bridge: RealtimeBridge | null = null;
let yetu: StandIn | null = null;
afterEach(async () => {
  await bridge?.close();
  await yetu?.close();
  bridge = null;
  yetu = null;
});

describe("the dev realtime bridge", () => {
  it("passes a subscription sent the moment the till's socket opens on to Yetu, as text", async () => {
    yetu = await standInYetu(150);
    bridge = await startRealtimeBridge({ backendUrl: yetu.url, port: 0, opsToken: "x".repeat(40), log: quiet });
    const till = new WebSocket(`ws://127.0.0.1:${bridge.port}/bridge`);
    await once(till, "open");
    till.send(JSON.stringify({ action: "subscribe", topic: "pos.outlet.outlet-1" }));
    await until(() => yetu!.texts.length > 0);
    expect(yetu.texts).toEqual([JSON.stringify({ action: "subscribe", topic: "pos.outlet.outlet-1" })]);
    till.close();
  });

  it("keeps the connection when the till changes its subscriptions later", async () => {
    yetu = await standInYetu(0);
    bridge = await startRealtimeBridge({ backendUrl: yetu.url, port: 0, opsToken: "x".repeat(40), log: quiet });
    const till = new WebSocket(`ws://127.0.0.1:${bridge.port}/bridge`);
    await once(till, "open");
    let tillClosed = false;
    till.on("close", () => (tillClosed = true));
    till.send(JSON.stringify({ action: "subscribe", topic: "pos.outlet.outlet-1" }));
    await until(() => yetu!.texts.length === 1);
    till.send(JSON.stringify({ action: "unsubscribe", topic: "pos.outlet.outlet-1" }));
    till.send(JSON.stringify({ action: "subscribe", topic: "pos.outlet.outlet-1" }));
    await until(() => yetu!.texts.length === 3 || yetu!.closes.length > 0);
    expect(yetu.closes).toEqual([]);
    expect(yetu.texts).toHaveLength(3);
    expect(tillClosed).toBe(false);
    till.close();
  });
});
