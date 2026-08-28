import { afterEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEnvelope } from "../realtime/RealtimeEnvelope";
import {
  clearOperationalSession,
  SessionExpiredError,
  setOperationalSession,
} from "./operationalSession";

vi.mock("./env", () => ({
  API_BASE_URL: "http://peak.test",
  getApiBaseUrl: () => "http://peak.test",
  devIdentityFromEnv: () => ({
    tenantId: "t1",
    userId: "u1",
    propertyId: "p1",
    outletId: "o1",
  }),
}));

vi.mock("./peakConfig", () => ({
  getApiBaseUrl: () => "http://peak.test",
}));

import { createRealtimeBackfill } from "./realtimeBackfill";

function envelope(sequenceId: number): RealtimeEnvelope {
  return {
    sequenceId,
    eventId: `e${sequenceId}`,
    type: "pos.order.created",
    schemaVersion: 1,
    aggregateType: "POS_ORDER",
    aggregateId: "order-1",
    aggregateVersion: sequenceId,
    occurredAt: "2026-08-15T00:00:00Z",
    tenantId: "t1",
    propertyId: "p1",
    outletId: "o1",
    payload: {},
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("createRealtimeBackfill", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearOperationalSession();
  });

  it("follows Peak nextCursor until the journal page is empty", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const after = Number(new URL(String(input)).searchParams.get("after"));
      if (after === 0) {
        return jsonResponse({ events: [envelope(1), envelope(2)], nextCursor: 2 });
      }
      if (after === 2) {
        return jsonResponse({ events: [envelope(3)], nextCursor: 3 });
      }
      return jsonResponse({ events: [], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    const events = await createRealtimeBackfill().fetchEvents(0);
    expect(events.map((event) => event.sequenceId)).toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://peak.test/api/v1/properties/p1/realtime/events?after=0&limit=200",
      "http://peak.test/api/v1/properties/p1/realtime/events?after=2&limit=200",
      "http://peak.test/api/v1/properties/p1/realtime/events?after=3&limit=200",
    ]);
  });

  it("sends header identity and never an Authorization bearer", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ events: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    await createRealtimeBackfill().fetchEvents(4);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://peak.test/api/v1/properties/p1/realtime/events?after=4&limit=200",
      {
        headers: {
          "X-Peak-Tenant-Id": "t1",
          "X-Peak-Tenant-User-Id": "u1",
        },
      },
    );
  });

  it("fails closed when Peak refuses the replay", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 403)));
    await expect(createRealtimeBackfill().fetchEvents(0)).rejects.toThrow(/HTTP 403/);
  });

  it("sends the ops bearer alone after PIN so replay matches the socket", async () => {
    setOperationalSession({
      token: "ops_live",
      expiresAt: "2026-08-16T05:00:00Z",
      terminalId: "d1",
      propertyId: "p1",
      tenantId: "t1",
      staffId: "u1",
      outletId: "o1",
      assurance: "RESTRICTED",
    });
    const fetchMock = vi.fn(async () => jsonResponse({ events: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    await createRealtimeBackfill().fetchEvents(4);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://peak.test/api/v1/properties/p1/realtime/events?after=4&limit=200",
      {
        headers: { Authorization: "Bearer ops_live" },
      },
    );
  });

  it("treats a 401 replay as an expired PIN session", async () => {
    setOperationalSession({
      token: "ops_dead",
      expiresAt: "2026-08-15T00:00:00Z",
      terminalId: "d1",
      propertyId: "p1",
      tenantId: "t1",
      staffId: "u1",
      outletId: "o1",
      assurance: "RESTRICTED",
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 401)));
    await expect(createRealtimeBackfill().fetchEvents(0)).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
  });
});
