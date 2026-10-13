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
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { WebSocket } from "ws";

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

/**
 * Starts the bridge on `port` (0 picks a free one) in front of `backendUrl`.
 * Resolves once it listens, with the port it took and a way to stop it.
 */
export function startRealtimeBridge({ backendUrl, port, opsToken: initialToken, tenantId: initialTenant, userId: initialUser, log = console }) {
  let tenantId = initialTenant;
  let userId = initialUser;
  let opsToken = initialToken;

  if (opsToken && (tenantId || userId)) {
    throw new Error("PEAK_OPS_TOKEN cannot be combined with identity headers; Peak refuses both on one handshake");
  }

  function handshakeHeaders() {
    if (opsToken) {
      return {
        Authorization: `Bearer ${opsToken}`,
        Origin: "http://localhost:5173",
      };
    }
    if (tenantId && userId) return {
      "X-Peak-Tenant-Id": tenantId,
      "X-Peak-Tenant-User-Id": userId,
      Origin: "http://localhost:5173",
    };
    return { Origin: "http://localhost:5173" };
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
          if (token.length < 32) {
            res.writeHead(400, corsHeaders());
            res.end("token must be a restricted POS session");
            return;
          }
          opsToken = token;
          tenantId = undefined;
          userId = undefined;
          log.log("[bridge] switched to PEAK_OPS_TOKEN handshake");
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

  wss.on("connection", (client) => {
    const upstream = new WebSocket(backendUrl, {
      headers: handshakeHeaders(),
    });

    // The till's socket opens before Yetu has answered the upstream handshake,
    // and the till subscribes as soon as it opens: hold its frames until Yetu
    // is there, then pass them on in order. Each frame keeps its kind: `ws`
    // hands a text frame over as a Buffer, and sending a Buffer as it is makes
    // a binary frame, which Yetu answers by closing (1003 "text messages
    // required") -- every subscription change then dropped the connection.
    const waiting = [];
    client.on("message", (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
      else if (upstream.readyState === WebSocket.CONNECTING) waiting.push({ data, isBinary });
    });
    upstream.on("open", () => {
      for (const frame of waiting.splice(0)) upstream.send(frame.data, { binary: frame.isBinary });
    });
    client.on("close", () => upstream.close());
    client.on("error", () => upstream.close());

    upstream.on("message", (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });
    upstream.on("close", () => client.close());
    upstream.on("error", (err) => {
      log.error("[bridge] upstream error:", err.message);
      client.close();
    });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const address = server.address();
      log.log(`[bridge] listening on ws://localhost:${address.port}/bridge -> ${backendUrl}`);
      resolve({
        port: address.port,
        close: () =>
          new Promise((done) => {
            wss.clients.forEach((socket) => socket.terminate());
            wss.close();
            server.close(() => done());
          }),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await startRealtimeBridge({
      backendUrl: process.env.PEAK_REALTIME_URL ?? "ws://localhost:8080/api/v1/pos/realtime/ws",
      port: Number(process.env.PEAK_BRIDGE_PORT ?? 5174),
      opsToken: process.env.PEAK_OPS_TOKEN,
      tenantId: process.env.VITE_PEAK_TENANT_ID,
      userId: process.env.VITE_PEAK_USER_ID,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
