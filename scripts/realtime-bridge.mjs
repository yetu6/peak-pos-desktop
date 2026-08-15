/**
 * Dev-only realtime bridge.
 *
 * Browser WebSockets cannot carry identity on the handshake, so this Node
 * process connects to Peak's STOMP endpoint and re-exposes the socket on
 * ws://localhost:5174/bridge. Frames are forwarded verbatim.
 *
 * Authentication is one of:
 *   - identity headers (default, the existing POS header-identity loop)
 *   - PEAK_OPS_TOKEN=ops_… a device-bound PIN session Peak minted
 * The two must not be combined: Peak refuses identity headers on an
 * authenticated principal.
 *
 * After PIN the till POSTs { token } to /ops-token (localhost only). That
 * switches subsequent upstream handshakes to the bearer and drops X-Peak-*.
 *
 * Usage:  VITE_PEAK_TENANT_ID=... VITE_PEAK_USER_ID=... node scripts/realtime-bridge.mjs
 *     or: PEAK_OPS_TOKEN=ops_... node scripts/realtime-bridge.mjs
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { WebSocket } from "ws";

const BACKEND_WS = process.env.PEAK_REALTIME_URL ?? "ws://localhost:8080/ws-connect";
const PORT = Number(process.env.PEAK_BRIDGE_PORT ?? 5174);
let tenantId = process.env.VITE_PEAK_TENANT_ID;
let userId = process.env.VITE_PEAK_USER_ID;
let opsToken = process.env.PEAK_OPS_TOKEN;

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

function handshakeHeaders() {
  if (opsToken) {
    return {
      Authorization: `Bearer ${opsToken}`,
      Origin: "http://localhost:5173",
    };
  }
  return {
    "X-Peak-Tenant-Id": tenantId,
    "X-Peak-Tenant-User-Id": userId,
    Origin: "http://localhost:5173",
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function isLocalAddress(address) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === ":ffff:127.0.0.1"
  );
}

const server = createServer((req, res) => {
  if (req.method === "OPTIONS" && req.url === "/ops-token") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  if (req.method === "POST" && req.url === "/ops-token") {
    if (!isLocalAddress(req.socket.remoteAddress ?? "")) {
      res.writeHead(403, corsHeaders());
      res.end("localhost only");
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const token = typeof body?.token === "string" ? body.token : "";
        if (!token.startsWith("ops_")) {
          res.writeHead(400, corsHeaders());
          res.end("token must be an ops_ session");
          return;
        }
        opsToken = token;
        tenantId = undefined;
        userId = undefined;
        console.log("[bridge] switched to PEAK_OPS_TOKEN handshake");
        res.writeHead(204, corsHeaders());
        res.end();
      } catch {
        res.writeHead(400, corsHeaders());
        res.end("invalid json");
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });
console.log(`[bridge] listening on ws://localhost:${PORT}/bridge -> ${BACKEND_WS}`);

wss.on("connection", (client) => {
  const upstream = new WebSocket(BACKEND_WS, {
    headers: handshakeHeaders(),
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

server.listen(PORT);
