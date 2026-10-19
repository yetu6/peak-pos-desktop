import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ROSTER_REFRESH_SECONDS } from "../access/accessSettings";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { generateDeviceKeyPair } from "../lib/deviceCrypto";
import {
  clearOperationalSession,
  getOperationalSession,
  setOperationalSession,
  type OperationalSession,
} from "../lib/operationalSession";
import type { SecretStore } from "../lib/deviceIdentity";
import type { OfflineAuthority } from "../lib/offlineAuthorization";
import { DeviceSessionProvider, useDeviceSession } from "./DeviceSessionProvider";

function memoryStore(initial?: string): SecretStore {
  let value = initial ?? null;
  return {
    async load() {
      return value;
    },
    async save(next: string) {
      value = next;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function Probe() {
  const {
    shell,
    identity,
    session,
    unlock,
    switchStaff,
    phase,
    error,
    roster,
    startPairing,
    continueAfterApproval,
    resetPairing,
    offlineEligibility,
    signInHeldUntil,
  } = useDeviceSession();
  return (
    <div>
      <div data-testid="shell">{shell}</div>
      <div data-testid="phase">{phase}</div>
      <div data-testid="device">{identity?.deviceCode ?? ""}</div>
      <div data-testid="approved">{identity?.approved ? "yes" : "no"}</div>
      <div data-testid="ops">{session?.token ?? ""}</div>
      <div data-testid="tenant">{session?.tenantId ?? ""}</div>
      <div data-testid="property">{session?.propertyId ?? ""}</div>
      <div data-testid="outlet">{session?.outletId ?? ""}</div>
      <div data-testid="error">{error ?? ""}</div>
      <div data-testid="offline-eligibility">{offlineEligibility?.state ?? ""}</div>
      <div data-testid="held-until">{signInHeldUntil ?? ""}</div>
      <div data-testid="roster">{roster.map((entry) => entry.fullName).join(",")}</div>
      <div data-testid="pairing-code">{identity?.pairing?.pairingCode ?? ""}</div>
      <button data-testid="unlock" onClick={() => void unlock("0007", "418205")}>
        Unlock
      </button>
      <button data-testid="switch" onClick={() => switchStaff()}>
        Switch
      </button>
      <button data-testid="check-pairing" onClick={() => void continueAfterApproval()}>
        Check pairing
      </button>
      <button data-testid="reset-pairing" onClick={() => void resetPairing()}>
        Reset pairing
      </button>
      <button data-testid="start-pairing" onClick={() => void startPairing()}>
        Start pairing
      </button>
    </div>
  );
}

function renderSession(
  store: SecretStore,
  applyOpsToken = async (_token: string) => undefined,
  offlineAuthority?: OfflineAuthority,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <DeviceSessionProvider
        store={store}
        baseUrl="http://peak.test"
        applyOpsToken={applyOpsToken}
        offlineAuthority={offlineAuthority}
      >
        <Probe />
      </DeviceSessionProvider>
    </QueryClientProvider>,
  );
}

describe("DeviceSessionProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearOperationalSession();
    localStorage.clear();
  });

  it("retains server tenant context, bootstraps real routes, and clears everything on logout", async () => {
    const keys = await generateDeviceKeyPair();
    const store = memoryStore(
      JSON.stringify({
        ...keys,
        deviceCode: "dev_abc",
        terminalId: "11111111-1111-1111-1111-111111111111",
        deviceCredential: "device-secret",
        approved: true,
        terminalName: "Bar 1",
      }),
    );
    localStorage.setItem("peak-pos-session-p1-o1", "till-1");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pos/device/challenges")) {
        return jsonResponse({
          challengeId: "11111111-1111-1111-1111-111111111111",
          nonce: btoa("n".repeat(32)),
          expiresAt: "2099-01-01T00:00:00Z",
          staff: [],
        });
      }
      if (url.endsWith("/pos/sessions")) return jsonResponse({
        token: `ops_live${"x".repeat(40)}`,
        expiresAt: "2099-01-01T00:00:00Z",
        assurance: "RESTRICTED",
        terminalId: "d1",
        propertyId: "p1",
        tenantId: "t1",
        staffId: "u1",
        outletId: "o1",
        mode: "cashier",
        terminalName: "Bar 1",
      });
      if (url.endsWith("/pos/catalog")) {
        return jsonResponse({ outletId: "o1", outletName: "Bar 1", products: [] });
      }
      if (url.endsWith("/pos/orders?active=true")) return jsonResponse([]);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const applyOpsToken = vi.fn(async () => undefined);

    renderSession(store, applyOpsToken);
    expect(await screen.findByTestId("shell")).toHaveTextContent("PAIRED_LOCKED");

    await userEvent.click(screen.getByTestId("unlock"));
    await waitFor(() =>
      expect(screen.getByTestId("shell")).toHaveTextContent("OPERATIONAL"),
    );
    expect(screen.getByTestId("ops")).toHaveTextContent("ops_live");
    expect(screen.getByTestId("tenant")).toHaveTextContent("t1");
    expect(screen.getByTestId("property")).toHaveTextContent("p1");
    expect(screen.getByTestId("outlet")).toHaveTextContent("o1");
    expect(getOperationalSession()?.token).toContain("ops_live");
    expect(getOperationalSession()?.tenantId).toBe("t1");
    expect(
      fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter((url) => !url.includes("/heartbeat")),
    ).toEqual([
      "http://peak.test/api/v1/pos/device/challenges",
      "http://peak.test/api/v1/pos/device/challenges",
      "http://peak.test/api/v1/pos/sessions",
      "http://peak.test/api/v1/pos/catalog",
      "http://peak.test/api/v1/pos/orders?active=true",
    ]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/heartbeat"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("onboarding"))).toBe(false);

    await userEvent.click(screen.getByTestId("switch"));
    await waitFor(() =>
      expect(screen.getByTestId("shell")).toHaveTextContent("PAIRED_LOCKED"),
    );
    expect(screen.getByTestId("device")).toHaveTextContent("dev_abc");
    expect(screen.getByTestId("ops")).toHaveTextContent("");
    expect(getOperationalSession()).toBeNull();
    expect(applyOpsToken).toHaveBeenLastCalledWith("");
    expect(localStorage.getItem("peak-pos-session-p1-o1")).toBe("till-1");
  });

  it("clears a previous tenant before a rejected PIN", async () => {
    const keys = await generateDeviceKeyPair();
    const store = memoryStore(JSON.stringify({
      ...keys,
      terminalId: "terminal-1",
      deviceCredential: "device-secret",
      approved: true,
    }));
    const stale: OperationalSession = {
      token: "stale-token",
      expiresAt: "2099-01-01T00:00:00Z",
      tenantId: "stale-tenant",
      propertyId: "stale-property",
      outletId: "stale-outlet",
      terminalId: "stale-terminal",
      staffId: "stale-staff",
      assurance: "RESTRICTED",
    };
    setOperationalSession(stale);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/challenges")
      ? jsonResponse({ challengeId: "c1", nonce: btoa("n".repeat(32)), expiresAt: "2099-01-01T00:00:00Z", staff: [] }, 201)
      : jsonResponse({}, 401)));

    renderSession(store);
    expect(await screen.findByTestId("shell")).toHaveTextContent("PAIRED_LOCKED");
    await userEvent.click(screen.getByTestId("unlock"));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent(/not accepted/i));
    expect(getOperationalSession()).toBeNull();
    expect(screen.getByTestId("shell")).toHaveTextContent("PAIRED_LOCKED");
  });

  it("holds sign-in for as long as Yetu asks after too many attempts (429), without trying offline", async () => {
    const keys = await generateDeviceKeyPair();
    const store = memoryStore(JSON.stringify({ ...keys, terminalId: "terminal-1", deviceCredential: "device-secret", approved: true }));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/challenges")
      ? jsonResponse({ challengeId: "c1", nonce: btoa("n".repeat(32)), expiresAt: "2099-01-01T00:00:00Z", staff: [] }, 201)
      : new Response(JSON.stringify({ status: 429, code: "RATE_LIMITED", detail: "Too many requests. Try again in 90 seconds." }), {
          status: 429,
          headers: { "Content-Type": "application/problem+json", "Retry-After": "90" },
        })));
    const authenticateStaff = vi.fn();
    const offline = { authenticateStaff, eligibilityStatus: vi.fn(), clearStaffSession: vi.fn(async () => undefined) } as unknown as OfflineAuthority;
    renderSession(store, async () => undefined, offline);
    expect(await screen.findByTestId("shell")).toHaveTextContent("PAIRED_LOCKED");
    const before = Date.now();
    await userEvent.click(screen.getByTestId("unlock"));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("Too many sign-in attempts. Wait before trying again."));
    const heldUntil = Number(screen.getByTestId("held-until").textContent);
    expect(heldUntil).toBeGreaterThanOrEqual(before + 90_000);
    expect(heldUntil).toBeLessThanOrEqual(Date.now() + 90_000);
    expect(authenticateStaff).not.toHaveBeenCalled();
    expect(screen.getByTestId("shell")).toHaveTextContent("PAIRED_LOCKED");
  });

  it("stays locked and publishes no session when post-login bootstrap is unavailable", async () => {
    const keys = await generateDeviceKeyPair();
    const store = memoryStore(JSON.stringify({
      ...keys,
      terminalId: "terminal-1",
      deviceCredential: "device-secret",
      approved: true,
    }));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/challenges")) return jsonResponse({ challengeId: "c1", nonce: btoa("n".repeat(32)), expiresAt: "2099-01-01T00:00:00Z", staff: [] }, 201);
      if (url.endsWith("/sessions")) return jsonResponse({ token: `ops_live${"x".repeat(40)}`, expiresAt: "2099-01-01T00:00:00Z", tenantId: "t1", propertyId: "p1", outletId: "o1", terminalId: "terminal-1", staffId: "u1", assurance: "RESTRICTED" }, 201);
      throw new TypeError("Failed to fetch");
    }));

    renderSession(store);
    expect(await screen.findByTestId("shell")).toHaveTextContent("PAIRED_LOCKED");
    await userEvent.click(screen.getByTestId("unlock"));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent(/reach Peak/i));
    expect(getOperationalSession()).toBeNull();
    expect(screen.getByTestId("shell")).toHaveTextContent("PAIRED_LOCKED");
  });

  it("loads the staff roster on entering the locked phase, for the tap-to-select PIN screen", async () => {
    const keys = await generateDeviceKeyPair();
    const store = memoryStore(
      JSON.stringify({
        ...keys,
        deviceCode: "dev_abc",
        terminalId: "11111111-1111-1111-1111-111111111111",
        deviceCredential: "device-secret",
        approved: true,
        terminalName: "Bar 1",
      }),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/pos/device/challenges")) {
        return jsonResponse({
          challengeId: "11111111-1111-1111-1111-111111111111",
          nonce: btoa("n".repeat(32)),
          expiresAt: "2099-01-01T00:00:00Z",
          staff: [{ id: "00001", displayName: "Amina Hassan", staffSuffix: "001" }],
        });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSession(store);
    expect(await screen.findByTestId("shell")).toHaveTextContent("PAIRED_LOCKED");
    await waitFor(() => expect(screen.getByTestId("roster")).toHaveTextContent("Amina Hassan"));
  });

  // F-227: Baraka and Zawadi chose their PINs while the till sat on its
  // sign-in screen, and it never offered them.
  it("asks again for the names while it waits on the sign-in screen, and when its window comes back", async () => {
    const keys = await generateDeviceKeyPair();
    const store = memoryStore(
      JSON.stringify({
        ...keys,
        deviceCode: "dev_abc",
        terminalId: "11111111-1111-1111-1111-111111111111",
        deviceCredential: "device-secret",
        approved: true,
        terminalName: "Bar 1",
      }),
    );
    const staff = [{ id: "00001", displayName: "Amina Hassan", staffSuffix: "001" }];
    const challenges = vi.fn(async () =>
      jsonResponse({ challengeId: "11111111-1111-1111-1111-111111111111", nonce: btoa("n".repeat(32)), expiresAt: "2099-01-01T00:00:00Z", staff: [...staff] }),
    );
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/pos/device/challenges")) return challenges();
      throw new Error(`unexpected fetch: ${String(input)}`);
    }));
    // The sign-in screen's own refresh, caught so the test can make it come round.
    const realSetInterval = window.setInterval.bind(window);
    const refreshes: Array<() => void> = [];
    const intervals = vi.spyOn(window, "setInterval").mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === ROSTER_REFRESH_SECONDS * 1000) {
        refreshes.push(fn);
        return 0;
      }
      return realSetInterval(fn, ms);
    }) as typeof window.setInterval);
    try {
      renderSession(store);
      await waitFor(() => expect(screen.getByTestId("roster")).toHaveTextContent("Amina Hassan"));
      expect(refreshes.length).toBeGreaterThan(0);

      // Zawadi chooses her PIN at the desk; the refresh comes round.
      staff.push({ id: "00002", displayName: "Zawadi Said", staffSuffix: "002" });
      act(() => refreshes.at(-1)?.());
      await waitFor(() => expect(screen.getByTestId("roster")).toHaveTextContent("Zawadi Said"));

      // Baraka too; the till's window is brought back to the front.
      staff.push({ id: "00003", displayName: "Baraka Mushi", staffSuffix: "003" });
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() => expect(screen.getByTestId("roster")).toHaveTextContent("Baraka Mushi"));
    } finally {
      intervals.mockRestore();
    }
  });

  it("unpairs when Peak withholds a challenge from a till that was already trusted", async () => {
    const keys = await generateDeviceKeyPair();
    const store = memoryStore(
      JSON.stringify({
        ...keys,
        deviceCode: "dev_abc",
        approved: true,
        terminalName: "Bar 1",
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ title: "Unauthorized" }, 401)),
    );

    renderSession(store);
    expect(await screen.findByTestId("shell")).toHaveTextContent("PAIRED_LOCKED");

    await userEvent.click(screen.getByTestId("unlock"));
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("unpaired"));
    expect(screen.getByTestId("shell")).toHaveTextContent("UNPAIRED");
    expect(screen.getByTestId("approved")).toHaveTextContent("no");
    expect(screen.getByTestId("ops")).toHaveTextContent("");
    expect(screen.getByTestId("error")).toHaveTextContent(
      "This register is no longer trusted. Pair it again.",
    );
    expect(getOperationalSession()).toBeNull();
    const saved = JSON.parse((await store.load()) ?? "{}") as {
      approved?: boolean;
      deviceCode?: string;
      privateKeyPkcs8?: string;
      publicKeySpki?: string;
    };
    expect(saved.approved).toBeFalsy();
    expect(saved.deviceCode).toBeUndefined();
    expect(saved.privateKeyPkcs8).toBe(keys.privateKeyPkcs8);
    expect(saved.publicKeySpki).toBe(keys.publicKeySpki);
  });

  it("keeps the shell locked and shows the certified prerequisite when online unlock loses network", async () => {
    const keys = await generateDeviceKeyPair();
    const store = memoryStore(JSON.stringify({
      ...keys,
      terminalId: "terminal-1",
      deviceCredential: "device-secret",
      approved: true,
    }));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const offlineAuthority: OfflineAuthority = {
      bindTerminal: vi.fn(),
      applyLifecycleEvent: vi.fn(),
      stageAuthorization: vi.fn(),
      clearStaffSession: vi.fn(async () => undefined),
      authenticateStaff: vi.fn(async () => ({ state: "NOT_ELIGIBLE" as const })),
      eligibilityStatus: vi.fn(async () => ({ state: "CATALOG_REQUIRED" as const })),
    };
    renderSession(store, undefined, offlineAuthority);
    expect(await screen.findByTestId("shell")).toHaveTextContent("PAIRED_LOCKED");

    await userEvent.click(screen.getByTestId("unlock"));

    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent(/certify.*catalog/i));
    expect(screen.getByTestId("phase")).toHaveTextContent("locked");
    expect(screen.getByTestId("offline-eligibility")).toHaveTextContent("CATALOG_REQUIRED");
    expect(getOperationalSession()).toBeNull();
  });

  it("enters an operational local session when the certified offline verifier authenticates", async () => {
    const keys=await generateDeviceKeyPair();
    const store=memoryStore(JSON.stringify({...keys,terminalId:"terminal-1",deviceCredential:"device-secret",approved:true,terminalName:"Bar 1"}));
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new TypeError("Failed to fetch")}));
    const offlineAuthority:OfflineAuthority={
      bindTerminal:vi.fn(),applyLifecycleEvent:vi.fn(),stageAuthorization:vi.fn(),clearStaffSession:vi.fn(async()=>undefined),
      authenticateStaff:vi.fn(async()=>({state:"AUTHENTICATED" as const,staffId:"staff-1",displayName:"Cashier",shiftId:"shift-1",leaseId:"lease-1",expiresAtMs:Date.now()+60_000,terminalId:"terminal-1",propertyId:"property-1",outletId:"outlet-1",registerId:"register-1",permissions:["pos.order.create","pos.payment.record"]})),
      eligibilityStatus:vi.fn(async()=>({state:"ELIGIBLE" as const})),
    };
    renderSession(store,undefined,offlineAuthority);
    expect(await screen.findByTestId("shell")).toHaveTextContent("PAIRED_LOCKED");
    await userEvent.click(screen.getByTestId("unlock"));
    await waitFor(()=>expect(screen.getByTestId("shell")).toHaveTextContent("OPERATIONAL"));
    expect(screen.getByTestId("property")).toHaveTextContent("property-1");
    expect(screen.getByTestId("outlet")).toHaveTextContent("outlet-1");
    expect(getOperationalSession()?.mode).toBe("offline-cash");
    expect(getOperationalSession()?.token).toBe("");
  });

  // Starting a pairing makes a real device key and saves it before asking Yetu;
  // with the whole suite running that can take longer than waitFor's one second.
  const PAIRING_STARTS = { timeout: 5_000 };

  it("persists the pending proof and accepts only the terminal id approved by Peak", async () => {
    const store = memoryStore();
    const future = new Date(Date.now() + 120_000).toISOString();
    let approved = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pos/pairing-requests")) {
        return jsonResponse({ pairingRequestId: "11111111-1111-4111-8111-111111111111", pairingCode: "23456-ABCDE", claimToken: "claim-token-with-at-least-thirty-two-characters", fingerprint: "sha256:device", expiresAt: future }, 201);
      }
      if (url.endsWith("/pos/pairing-requests/11111111-1111-4111-8111-111111111111")) {
        return jsonResponse(approved
          ? { status: "CONSUMED", terminalId: "22222222-2222-4222-8222-222222222222", expiresAt: future }
          : { status: "PENDING", expiresAt: future });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSession(store);
    expect(await screen.findByTestId("shell")).toHaveTextContent("UNPAIRED");
    await userEvent.click(screen.getByTestId("start-pairing"));
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("waiting"), PAIRING_STARTS);
    expect(screen.getByTestId("pairing-code")).toHaveTextContent("23456-ABCDE");
    const pending = JSON.parse((await store.load()) ?? "{}") as { approved?: boolean; terminalId?: string; deviceCredential?: string; pairing?: { claimToken?: string } };
    expect(pending.approved).toBe(false);
    expect(pending.terminalId).toBeUndefined();
    expect(pending.deviceCredential?.length).toBeGreaterThanOrEqual(43);
    expect(pending.pairing?.claimToken).toBe("claim-token-with-at-least-thirty-two-characters");

    approved = true;
    await userEvent.click(screen.getByTestId("check-pairing"));
    await waitFor(() => expect(screen.getByTestId("shell")).toHaveTextContent("PAIRED_LOCKED"));
    const paired = JSON.parse((await store.load()) ?? "{}") as { approved?: boolean; terminalId?: string; pairing?: unknown };
    expect(paired.approved).toBe(true);
    expect(paired.terminalId).toBe("22222222-2222-4222-8222-222222222222");
    expect(paired.pairing).toBeUndefined();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/devices/"))).toBe(false);
  });

  it("resumes an unexpired pending request after restart without inventing authority", async () => {
    const keys = await generateDeviceKeyPair();
    const future = new Date(Date.now() + 120_000).toISOString();
    const store = memoryStore(JSON.stringify({ ...keys, approved: false, deviceCredential: "pending-device-credential", pairing: { pairingRequestId: "11111111-1111-4111-8111-111111111111", pairingCode: "23456-ABCDE", claimToken: "claim-token-with-at-least-thirty-two-characters", fingerprint: "sha256:device", expiresAt: future } }));
    const fetchMock = vi.fn(async () => jsonResponse({ status: "PENDING", expiresAt: future }));
    vi.stubGlobal("fetch", fetchMock);

    renderSession(store);
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("waiting"));
    expect(screen.getByTestId("approved")).toHaveTextContent("no");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ "X-Peak-Pairing-Token": "claim-token-with-at-least-thirty-two-characters" });
  });

  it("fails closed on rejection and requires a new pairing lifecycle", async () => {
    const store = memoryStore();
    const future = new Date(Date.now() + 120_000).toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/pos/pairing-requests")
      ? jsonResponse({ pairingRequestId: "11111111-1111-4111-8111-111111111111", pairingCode: "23456-ABCDE", claimToken: "claim-token-with-at-least-thirty-two-characters", fingerprint: "sha256:device", expiresAt: future }, 201)
      : jsonResponse({ status: "REJECTED", expiresAt: future }));
    vi.stubGlobal("fetch", fetchMock);

    renderSession(store);
    await screen.findByTestId("shell");
    await userEvent.click(screen.getByTestId("start-pairing"));
    // "unpaired" is also where it starts: wait for the refusal itself, then the phase.
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent(/denied/i), PAIRING_STARTS);
    expect(screen.getByTestId("phase")).toHaveTextContent("unpaired");
    const saved = JSON.parse((await store.load()) ?? "{}") as Record<string, unknown>;
    expect(saved.approved).toBe(false);
    expect(saved.pairing).toBeUndefined();
    expect(saved.deviceCredential).toBeUndefined();
    expect(saved.terminalId).toBeUndefined();
  });

  it("clears an expired pending credential on restart", async () => {
    const keys = await generateDeviceKeyPair();
    const store = memoryStore(JSON.stringify({ ...keys, approved: false, deviceCredential: "expired-credential", pairing: { pairingRequestId: "11111111-1111-4111-8111-111111111111", pairingCode: "23456-ABCDE", claimToken: "claim-token-with-at-least-thirty-two-characters", fingerprint: "sha256:device", expiresAt: "2020-01-01T00:00:00Z" } }));
    vi.stubGlobal("fetch", vi.fn());

    renderSession(store);
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("unpaired"));
    const saved = JSON.parse((await store.load()) ?? "{}") as Record<string, unknown>;
    expect(saved.pairing).toBeUndefined();
    expect(saved.deviceCredential).toBeUndefined();
  });

  it("keeps the same pending proof through a polling network failure and clears it on reset", async () => {
    const keys = await generateDeviceKeyPair();
    const future = new Date(Date.now() + 120_000).toISOString();
    const store = memoryStore(JSON.stringify({ ...keys, approved: false, deviceCredential: "pending-device-credential", pairing: { pairingRequestId: "11111111-1111-4111-8111-111111111111", pairingCode: "23456-ABCDE", claimToken: "claim-token-with-at-least-thirty-two-characters", fingerprint: "sha256:device", expiresAt: future } }));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));

    renderSession(store);
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent(/reach Peak/i));
    expect(screen.getByTestId("phase")).toHaveTextContent("waiting");
    let saved = JSON.parse((await store.load()) ?? "{}") as Record<string, unknown>;
    expect(saved.pairing).toBeDefined();
    expect(saved.deviceCredential).toBe("pending-device-credential");

    await userEvent.click(screen.getByTestId("reset-pairing"));
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("unpaired"));
    saved = JSON.parse((await store.load()) ?? "{}") as Record<string, unknown>;
    expect(saved.pairing).toBeUndefined();
    expect(saved.deviceCredential).toBeUndefined();
  });
});
