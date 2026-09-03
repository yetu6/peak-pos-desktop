import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionExpiredError, type OperationalSession } from "./operationalSession";
import {
  PostLoginBootstrapError,
  bootstrapOperationalSession,
} from "./postLoginBootstrap";

const session: OperationalSession = {
  token: "ops_live_token",
  expiresAt: "2099-01-01T00:00:00Z",
  tenantId: "organization-1",
  propertyId: "property-1",
  outletId: "outlet-1",
  terminalId: "terminal-1",
  staffId: "staff-1",
  assurance: "RESTRICTED",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("production POS post-login bootstrap", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses only current session-bound catalog and active-order routes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/pos/catalog")) {
        return json({ outletId: "outlet-1", outletName: "Main Bar", products: [] });
      }
      if (url.endsWith("/api/v1/pos/orders?active=true")) return json([]);
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await bootstrapOperationalSession("https://peak.example", session);

    expect(result).toEqual({
      catalog: { outletId: "outlet-1", outletName: "Main Bar", products: [] },
      activeOrders: [],
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://peak.example/api/v1/pos/catalog",
      "https://peak.example/api/v1/pos/orders?active=true",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toEqual({ headers: { Authorization: "Bearer ops_live_token" } });
    }
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("onboarding"))).toBe(false);
  });

  it("rejects catalog authority that does not match the authenticated outlet", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/catalog")
      ? json({ outletId: "other-outlet", outletName: "Wrong Bar", products: [] })
      : json([])));

    await expect(bootstrapOperationalSession("https://peak.example", session)).rejects.toThrow(
      /authenticated outlet/i,
    );
  });

  it("maps a refused bootstrap to an expired restricted session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 401)));

    await expect(bootstrapOperationalSession("https://peak.example", session)).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
  });

  it("fails closed when Peak is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 503)));

    await expect(bootstrapOperationalSession("https://peak.example", session)).rejects.toBeInstanceOf(
      PostLoginBootstrapError,
    );
  });

  it("keeps online bootstrap usable when the offline-lease backend contract is absent", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/catalog")) {
        return json({ outletId: "outlet-1", outletName: "Main Bar", products: [] });
      }
      if (url.includes("orders?active=true")) return json([]);
      if (url.endsWith("/terminals/terminal-1/offline-leases")) return json({}, 501);
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const stageOfflineAuthorization = vi.fn();

    const result = await bootstrapOperationalSession("https://peak.example", session, {
      stageOfflineAuthorization,
    });

    expect(result.offlineAuthorization).toEqual({ state: "BACKEND_GAP" });
    expect(stageOfflineAuthorization).not.toHaveBeenCalled();
  });

  it("passes an opaque signed authorization envelope to the native staging boundary", async () => {
    const envelope = { keyId: "key-1", payloadB64: "cGF5bG9hZA", signatureB64: "c2ln" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/catalog")) return json({ outletId: "outlet-1", outletName: "Main Bar", products: [] });
      if (url.includes("orders?active=true")) return json([]);
      return json(envelope, 201);
    }));
    const stageOfflineAuthorization = vi.fn(async () => ({
      state: "STAGED" as const,
      hardExpiresAt: 1_800_007_200_000,
      staffCount: 1,
      prerequisite: "CATALOG_REQUIRED" as const,
    }));

    const result = await bootstrapOperationalSession("https://peak.example", session, {
      stageOfflineAuthorization,
    });

    expect(stageOfflineAuthorization).toHaveBeenCalledWith(envelope);
    expect(result.offlineAuthorization?.state).toBe("STAGED");
  });

  it("fails the offline authority closed without denying an otherwise valid online session", async () => {
    const envelope = { keyId: "key-1", payloadB64: "altered", signatureB64: "invalid" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/catalog")) return json({ outletId: "outlet-1", outletName: "Main Bar", products: [] });
      if (url.includes("orders?active=true")) return json([]);
      return json(envelope, 201);
    }));

    const result = await bootstrapOperationalSession("https://peak.example", session, {
      stageOfflineAuthorization: vi.fn(async () => { throw new Error("INVALID_AUTHORIZATION"); }),
    });

    expect(result.catalog.outletName).toBe("Main Bar");
    expect(result.offlineAuthorization).toEqual({ state: "INVALID" });
  });
});
