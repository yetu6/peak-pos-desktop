/**
 * Dev-only realtime bridge.
 *
 * Browser WebSockets cannot carry the X-Peak-* identity headers the dev
 * runtime resolves (PEAK_ALLOW_HEADER_IDENTITY=true), so this tiny Node
 * process connects to the backend STOMP endpoint with the headers and
 * re-exposes the socket to the app on ws://localhost:5174/bridge.
 *
 * It forwards STOMP frames verbatim in both directions. In production the
 * Tauri shell uses a transport that can authenticate the handshake
 * (token/cookie-capable WebSocket or the Rust-side websocket plugin).
 *
 * Usage:  VITE_PEAK_TENANT_ID=... VITE_PEAK_USER_ID=... node scripts/realtime-bridge.mjs
 */
import { WebSocketServer } from "ws";
import { WebSocket } from "ws";

const BACKEND_WS = process.env.PEAK_REALTIME_URL ?? "ws://localhost:8080/ws-connect";
const PORT = Number(process.env.PEAK_BRIDGE_PORT ?? 5174);
const tenantId = process.env.VITE_PEAK_TENANT_ID;
const userId = process.env.VITE_PEAK_USER_ID;

if (!tenantId || !userId) {
  console.error("VITE_PEAK_TENANT_ID and VITE_PEAK_USER_ID are required");
  process.exit(1);
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[bridge] listening on ws://localhost:${PORT}/bridge -> ${BACKEND_WS}`);

wss.on("connection", (client) => {
  const upstream = new WebSocket(BACKEND_WS, {
    headers: {
      "X-Peak-Tenant-Id": tenantId,
      "X-Peak-Tenant-User-Id": userId,
      "Origin": "http://localhost:5173",
    },
  });

  client.on("message", (data) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
  });
  client.on("close", () => upstream.close());
  client.on("error", () => upstream.close());

  upstream.on("message", (data) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
  upstream.on("close", () => client.close());
  upstream.on("error", (err) => {
    console.error("[bridge] upstream error:", err.message);
    client.close();
  });
});