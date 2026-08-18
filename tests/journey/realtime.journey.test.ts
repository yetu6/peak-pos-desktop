/**
 * End-to-end journey: the real desktop RealtimeClient against the live backend,
 * through the real dev bridge (the same path main.tsx wires up).
 *
 * Run with the backend up (PEAK_ALLOW_HEADER_IDENTITY=true) and an
 * outlet without an open session:
 *
 *   VITE_PEAK_TENANT_ID=... VITE_PEAK_USER_ID=... \
 *   PEAK_JOURNEY_TENANT_ID=... PEAK_JOURNEY_USER_ID=... \
 *   PEAK_JOURNEY_PROPERTY_ID=... PEAK_JOURNEY_OUTLET_ID=... \
 *   bun run test:journey
 *
 * Without those credentials the suite skips itself, so the regular
 * `bun run test` stays green without a backend.
 */
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RealtimeClient } from "../../src/realtime/RealtimeClient";
import type {
  ConnectionState,
  RealtimeEnvelope,
} from "../../src/realtime/RealtimeEnvelope";

const baseUrl = process.env.PEAK_JOURNEY_BASE_URL ?? "http://localhost:8080";
const tenantId = process.env.PEAK_JOURNEY_TENANT_ID;
const userId = process.env.PEAK_JOURNEY_USER_ID;
const propertyId = process.env.PEAK_JOURNEY_PROPERTY_ID;
const outletId = process.env.PEAK_JOURNEY_OUTLET_ID;
const bridgePort = Number(process.env.PEAK_BRIDGE_PORT ?? 5174);
const enabled = Boolean(tenantId && userId && propertyId && outletId);

const projectRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../..",
);

function apiHeaders(): Record<string, string> {
  return {
    "X-Peak-Tenant-Id": tenantId!,
    "X-Peak-Tenant-User-Id": userId!,
    "Content-Type": "application/json",
  };
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`bridge did not listen on :${port} within ${timeoutMs} ms`));
        } else {
          setTimeout(attempt, 150);
        }
      });
    };
    attempt();
  });
}

async function backfill(after: number): Promise<RealtimeEnvelope[]> {
  const response = await fetch(
    `${baseUrl}/api/v1/properties/${propertyId}/realtime/events?after=${after}`,
    { headers: apiHeaders() },
  );
  if (!response.ok) {
    throw new Error(`backfill failed with HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    events: RealtimeEnvelope[];
    nextCursor: number | null;
  };
  return body.events;
}

describe.skipIf(!enabled)("realtime journey against the live backend", () => {
  let bridge: ChildProcess | null = null;

  beforeAll(async () => {
    bridge = spawn("node", ["scripts/realtime-bridge.mjs"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        VITE_PEAK_TENANT_ID: tenantId,
        VITE_PEAK_USER_ID: userId,
        PEAK_BRIDGE_PORT: String(bridgePort),
      },
      stdio: "ignore",
    });
    await waitForPort(bridgePort, 15_000);
  }, 30_000);

  afterAll(() => {
    bridge?.kill();
  });

  it(
    "delivers a committed session open live, replays it on backfill and resumes past it after reconnect",
    async () => {
      const liveEvents: RealtimeEnvelope[] = [];
      const states: ConnectionState[] = [];
      const firstClient = new RealtimeClient({
        createSocket: () => new WebSocket(`ws://localhost:${bridgePort}/bridge`),
        backfillEvents: async (after) => backfill(after),
        cursorStorage: { get: () => null, set: () => {} },
        backoff: { delayMs: () => 500 },
      });
      firstClient.onEvent = (event) => liveEvents.push(event);
      firstClient.onStateChange = (state) => states.push(state);
      firstClient.subscribe({ kind: "propertyOperations", propertyId: propertyId! });
      firstClient.connect();

      await waitFor(() => states.some((s) => s.phase === "connected"), 15_000);

      const operationId = crypto.randomUUID();
      const sessionResponse = await fetch(
        `${baseUrl}/api/v1/properties/${propertyId}/pos-sessions/open`,
        {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({
            outletId,
            openingFloat: 10_000,
            clientOperationId: operationId,
            operatorId: userId,
          }),
        },
      );
      if (!sessionResponse.ok) {
        throw new Error(
          `session open failed with HTTP ${sessionResponse.status}: ${await sessionResponse.text()}`,
        );
      }

      await waitFor(
        () => liveEvents.some((e) => e.type === "pos.session.opened"),
        15_000,
      );
      const opened = liveEvents.find((e) => e.type === "pos.session.opened")!;
      expect(typeof opened.sequenceId).toBe("number");
      expect(opened.tenantId).toBe(tenantId);
      expect(opened.propertyId).toBe(propertyId);

      const replayed = await backfill(0);
      expect(replayed.some((e) => e.sequenceId === opened.sequenceId)).toBe(true);
      expect(
        replayed.find((e) => e.sequenceId === opened.sequenceId)?.type,
      ).toBe("pos.session.opened");

      const resumedEvents: RealtimeEnvelope[] = [];
      const secondClient = new RealtimeClient({
        createSocket: () => new WebSocket(`ws://localhost:${bridgePort}/bridge`),
        backfillEvents: async (after) => backfill(after),
        cursorStorage: { get: () => opened.sequenceId, set: () => {} },
        backoff: { delayMs: () => 500 },
      });
      secondClient.onEvent = (event) => resumedEvents.push(event);
      secondClient.subscribe({ kind: "propertyOperations", propertyId: propertyId! });
      secondClient.connect();
      await waitFor(
        () => secondClient.connectionState.phase === "connected",
        15_000,
      );
      // Resumed past the committed position: nothing before the cursor re-delivers.
      expect(resumedEvents).toHaveLength(0);

      firstClient.dispose();
      secondClient.dispose();

      const openedSession = (await sessionResponse.json()) as { id?: string };
      if (openedSession.id) {
        const closed = await fetch(
          `${baseUrl}/api/v1/properties/${propertyId}/pos-sessions/${openedSession.id}/close`,
          {
            method: "POST",
            headers: { ...apiHeaders(), "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify({ actualCash: 10_000 }),
          },
        );
        if (!closed.ok) {
          throw new Error(
            `session close failed with HTTP ${closed.status}: ${await closed.text()}`,
          );
        }
      }
    },
    60_000,
  );
});

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() > deadline) {
        return reject(new Error(`condition not met within ${timeoutMs} ms`));
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}