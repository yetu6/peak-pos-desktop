import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionExpiredError, type OperationalSession } from "./operationalSession";
import {
  PostLoginBootstrapError,
  bootstrapOperationalSession,
  prepareOfflineStart,
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

  it("reads only the catalogue: no orders, and no route Yetu doesn't have", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/pos/catalog")) {
        return json({ outletId: "outlet-1", outletName: "Main Bar", products: [] });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await bootstrapOperationalSession("https://peak.example", session);

    expect(result).toEqual({ catalog: { outletId: "outlet-1", outletName: "Main Bar", products: [] } });
    // The open orders come from the orders list, every page (useActiveOrders);
    // ?active=true, /terminals/{id}/offline-leases and /catalog/snapshots/{v}
    // are never asked (2026-10-27).
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["https://peak.example/api/v1/pos/catalog"]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toEqual({ headers: { Authorization: "Bearer ops_live_token" } });
    }
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
});

// F-228: a new till signed in to Bahari QA Hotel read Lease STAGED, Catalog
// MISSING and "Offline" while every online call worked: it had no offline
// keys to check its start-up with until someone pressed Try again.
describe("the till's offline start-up (F-228)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const installed = {
    authorization: { state: "ACTIVE" } as never,
    catalog: { state: "ACTIVE", snapshotId: "snapshot-1" } as never,
  };

  it("installs Yetu's offline keys before it installs the start-up", async () => {
    const order: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      order.push(url.replace("https://peak.example/api/v1", ""));
      if (url.endsWith("/pos/offline/bootstrap")) return json({ lease: "signed" }, 201);
      return json({}, 200);
    }));
    const installTrustKeyset = vi.fn(async () => {
      order.push("keyset");
    });
    const installOfflineBootstrap = vi.fn(async () => {
      order.push("install");
      return installed;
    });
    const result = await prepareOfflineStart("https://peak.example", session, { installTrustKeyset, installOfflineBootstrap });
    expect(order).toEqual(["keyset", "/pos/offline/bootstrap", "install", "/pos/offline/catalog-acknowledge"]);
    expect(result).toEqual({ offlineAuthorization: installed.authorization, certifiedCatalog: installed.catalog });
  });

  it("at sign-in too, and a keyset that can't be had doesn't stop the online sign-in", async () => {
    const order: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      order.push(url.replace("https://peak.example/api/v1", ""));
      if (url.endsWith("/pos/catalog")) return json({ outletId: "outlet-1", outletName: "Main Bar", products: [] });
      if (url.endsWith("/pos/orders?active=true")) return json([]);
      // No shift open on the till yet.
      if (url.endsWith("/pos/offline/bootstrap")) return json({ code: "SHIFT_REQUIRED" }, 409);
      throw new Error(`unexpected URL: ${url}`);
    }));
    const installTrustKeyset = vi.fn(async () => {
      order.push("keyset");
      throw new Error("Yetu unreachable");
    });
    const result = await bootstrapOperationalSession("https://peak.example", session, {
      installTrustKeyset,
      installOfflineBootstrap: vi.fn(async () => installed),
    });
    expect(order).toEqual(["/pos/catalog", "keyset", "/pos/offline/bootstrap"]);
    expect(result.catalog.outletName).toBe("Main Bar");
    expect(result.offlineAuthorization).toEqual({ state: "UNAVAILABLE" });
  });
});

it("caches advisory cash preferences at the authenticated first bootstrap", async () => {
 const {cachedOutletMoney}=await import("./outletMoneySettings");
 localStorage.clear();
 vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith("/catalog")
  ? json({outletId:session.outletId,outletName:"Main Bar",products:[],standardFloat:5_000_000,quickCashNotes:[1000,2000,5000,10000]}) : json([])));
 try {
  await bootstrapOperationalSession("https://peak.example",session);
  expect(cachedOutletMoney(session.propertyId,session.outletId)).toEqual({standardFloat:5_000_000,quickCashNotes:[1000,2000,5000,10000]});
  expect(cachedOutletMoney("another-property",session.outletId).standardFloat).toBe(0);
 } finally {vi.unstubAllGlobals();localStorage.clear();}
});

it("caches authenticated table and guest prompts before the first offline sale", async () => {
 const {cachedOutletOrderSettings}=await import("./outletOrderSettings");
 localStorage.clear();
 vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith("/catalog")
  ? json({outletId:session.outletId,outletName:"Main Bar",products:[],askForTable:false,captureGuestCount:true}) : json([])));
 try {
  await bootstrapOperationalSession("https://peak.example",session);
  expect(cachedOutletOrderSettings(session.propertyId,session.outletId)).toEqual({askForTable:false,captureGuestCount:true});
  expect(cachedOutletOrderSettings("another-property",session.outletId)).toEqual({askForTable:true,captureGuestCount:false});
 } finally {vi.unstubAllGlobals();localStorage.clear();}
});
