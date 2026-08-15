/**
 * Dev-only realtime bridge.
 *
 * Browser WebSockets cannot carry the X-Peak-* identity headers the dev
 * runtime resolves (PEAK_ALLOW_HEADER_IDENTITY=true), so this tiny Node
 * process connects to the backend STOMP endpoint with those headers and
 * re-exposes the socket to the app on ws://localhost:5174/bridge.
 *
 * It forwards STOMP frames verbatim in both directions. Peak's contract is
 * unchanged: HTTP/REST creates truth, STOMP only delivers committed envelopes.
 *
 * Authentication is one of:
 *   - identity headers (default, the existing POS header-identity loop)
 *   - PEAK_OPS_TOKEN=ops_… a device-bound PIN session Peak minted
 * The two must not be combined: Peak refuses identity headers on an
 * authenticated principal.
 *
 * Usage:  VITE_PEAK_TENANT_ID=... VITE_PEAK_USER_ID=... node scripts/realtime-bridge.mjs
 *     or: PEAK_OPS_TOKEN=ops_... node scripts/realtime-bridge.mjs
 */
import { WebSocketServer } from "ws";
import { WebSocket } from "ws";

const BACKEND_WS = process.env.PEAK_REALTIME_URL ?? "ws://localhost:8080/ws-connect";
const PORT = Number(process.env.PEAK_BRIDGE_PORT ?? 5174);
const tenantId = process.env.VITE_PEAK_TENANT_ID;
const userId = process.env.VITE_PEAK_USER_ID;
const opsToken = process.env.PEAK_OPS_TOKEN;

if (opsToken && (tenantId || userId)) {
  console.error(
    "PEAK_OPS_TOKEN cannot be combined with identity headers; Peak refuses both on one handshake",
  );
  process.exit(1);
}

if (!opsToken && (!tenantId || !userId)) {
  console.error(
    "VITE_PEAK_TENANT_ID and VITE_PEAK_USER_ID are required unless PEAK_OPS_TOKEN is set",
  );
  process.exit(1);
}

const handshakeHeaders = opsToken
  ? {
      Authorization: `Bearer ${opsToken}`,
      Origin: "http://localhost:5173",
    }
  : {
      "X-Peak-Tenant-Id": tenantId,
      "X-Peak-Tenant-User-Id": userId,
      Origin: "http://localhost:5173",
    };

const wss = new WebSocketServer({ port: PORT });
console.log(`[bridge] listening on ws://localhost:${PORT}/bridge -> ${BACKEND_WS}`);

wss.on("connection", (client) => {
  const upstream = new WebSocket(BACKEND_WS, {
    headers: handshakeHeaders,
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
