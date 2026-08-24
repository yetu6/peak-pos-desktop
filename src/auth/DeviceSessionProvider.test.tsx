import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { generateDeviceKeyPair } from "../lib/deviceCrypto";
import {
  clearOperationalSession,
  getOperationalSession,
} from "../lib/operationalSession";
import type { SecretStore } from "../lib/deviceIdentity";
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
    claim,
    confirmPairing,
    rejectPairing,
    startPairing,
  } = useDeviceSession();
  return (
    <div>
      <div data-testid="shell">{shell}</div>
      <div data-testid="phase">{phase}</div>
      <div data-testid="device">{identity?.deviceCode ?? ""}</div>
      <div data-testid="approved">{identity?.approved ? "yes" : "no"}</div>
      <div data-testid="ops">{session?.token ?? ""}</div>
      <div data-testid="error">{error ?? ""}</div>
      <div data-testid="roster">{roster.map((entry) => entry.fullName).join(",")}</div>
      <div data-testid="claim-property">{claim?.propertyName ?? ""}</div>
      <button data-testid="unlock" onClick={() => void unlock("0007", "418205")}>
        Unlock
      </button>
      <button data-testid="switch" onClick={() => switchStaff()}>
        Switch
      </button>
      <button data-testid="confirm-claim" onClick={() => void confirmPairing()}>
        Confirm
      </button>
      <button data-testid="reject-claim" onClick={() => void rejectPairing()}>
        Reject
      </button>
      <button data-testid="start-pairing" onClick={() => void startPairing()}>
        Start pairing
      </button>
    </div>
  );
}

function renderSession(store: SecretStore) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <DeviceSessionProvider
        store={store}
        baseUrl="http://peak.test"
        applyOpsToken={async () => undefined}
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

  it("Switch Staff ends the ops session without unpairing or closing the till", async () => {
    const keys = await generateDeviceKeyPair();
    const store = memoryStore(
      JSON.stringify({
        ...keys,
        deviceCode: "dev_abc",
        approved: true,
        terminalName: "Bar 1",
      }),
    );
    localStorage.setItem("peak-pos-session-p1-o1", "till-1");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/devices/challenges")) {
        return jsonResponse({
          challengeId: "11111111-1111-1111-1111-111111111111",
          nonce: btoa("n".repeat(32)),
          expiresAt: "2099-01-01T00:00:00Z",
        });
      }
      return jsonResponse({
        token: "ops_live",
        expiresAt: "2099-01-01T00:00:00Z",
        sessionClass: "operational",
        deviceId: "d1",
        propertyId: "p1",
        tenantId: "t1",
        userId: "u1",
        outletId: "o1",
        mode: "cashier",
        terminalName: "Bar 1",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSession(store);
    expect(await screen.findByTestId("shell")).toHaveTextContent("PAIRED_LOCKED");

    await userEvent.click(screen.getByTestId("unlock"));
    await waitFor(() =>
      expect(screen.getByTestId("shell")).toHaveTextContent("OPERATIONAL"),
    );
    expect(screen.getByTestId("ops")).toHaveTextContent("ops_live");
    expect(getOperationalSession()?.token).toBe("ops_live");

    await userEvent.click(screen.getByTestId("switch"));
    await waitFor(() =>
      expect(screen.getByTestId("shell")).toHaveTextContent("PAIRED_LOCKED"),
    );
    expect(screen.getByTestId("device")).toHaveTextContent("dev_abc");
    expect(screen.getByTestId("ops")).toHaveTextContent("");
    expect(getOperationalSession()).toBeNull();
    expect(localStorage.getItem("peak-pos-session-p1-o1")).toBe("till-1");
  });

  it("loads the staff roster on entering the locked phase, for the tap-to-select PIN screen", async () => {
    const keys = await generateDeviceKeyPair();
    const store = memoryStore(
      JSON.stringify({
        ...keys,
        deviceCode: "dev_abc",
        approved: true,
        terminalName: "Bar 1",
      }),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/devices/challenges")) {
        return jsonResponse({
          challengeId: "11111111-1111-1111-1111-111111111111",
          nonce: btoa("n".repeat(32)),
          expiresAt: "2099-01-01T00:00:00Z",
        });
      }
      if (String(input).endsWith("/staff/sessions/roster")) {
        return jsonResponse({
          staff: [{ fullName: "Amina Hassan", staffNumber: "00001" }],
        });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSession(store);
    expect(await screen.findByTestId("shell")).toHaveTextContent("PAIRED_LOCKED");
    await waitFor(() => expect(screen.getByTestId("roster")).toHaveTextContent("Amina Hassan"));
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

  it("only pairs after this till signs and confirms the manager's candidate claim", async () => {
    const store = memoryStore();
    const future = new Date(Date.now() + 120_000).toISOString();
    let confirmBody: { claimId?: string; signature?: string } | null = null;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/devices/pairing-requests")) {
        return jsonResponse({
          pairingRequestId: "req-1",
          deviceCode: "dev_abc",
          pairingCode: "123456",
          fingerprint: "AA:BB:CC:DD",
          expiresAt: future,
        });
      }
      if (url.endsWith("/devices/pairing-requests/req-1")) {
        return jsonResponse({
          status: "claim_pending_confirmation",
          claimId: "claim-1",
          claimTenantId: "tenant-1",
          claimPropertyId: "property-1",
          claimPropertyName: "Alpha Grand Hotel",
          claimTerminalName: "Front Desk Till",
          claimMode: "POS",
          claimNonce: btoa("n".repeat(32)),
          claimExpiresAt: future,
        });
      }
      if (url.endsWith("/devices/pairing-requests/req-1/confirm")) {
        confirmBody = JSON.parse(String(init?.body)) as { claimId?: string; signature?: string };
        return jsonResponse({ deviceId: "device-1", deviceCode: "dev_abc" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSession(store);
    expect(await screen.findByTestId("shell")).toHaveTextContent("UNPAIRED");

    await userEvent.click(screen.getByTestId("start-pairing"));
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("confirming"));
    expect(screen.getByTestId("claim-property")).toHaveTextContent("Alpha Grand Hotel");
    // The claim alone never pairs the device — no paired state yet.
    expect(screen.getByTestId("shell")).toHaveTextContent("UNPAIRED");

    await userEvent.click(screen.getByTestId("confirm-claim"));
    await waitFor(() => expect(screen.getByTestId("shell")).toHaveTextContent("PAIRED_LOCKED"));
    expect(screen.getByTestId("device")).toHaveTextContent("dev_abc");
    expect(screen.getByTestId("approved")).toHaveTextContent("yes");
    expect(confirmBody).not.toBeNull();
    expect(confirmBody!.claimId).toBe("claim-1");
    expect(typeof confirmBody!.signature).toBe("string");
    expect(confirmBody!.signature!.length).toBeGreaterThan(0);
  });

  it("rejecting a claim rotates to a fresh pairing code instead of pairing it", async () => {
    const store = memoryStore();
    const future = new Date(Date.now() + 120_000).toISOString();
    let rejectCalled = false;
    let pairingRequestCalls = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/devices/pairing-requests")) {
        pairingRequestCalls += 1;
        return jsonResponse({
          pairingRequestId: "req-1",
          deviceCode: "dev_abc",
          pairingCode: pairingRequestCalls === 1 ? "111111" : "222222",
          fingerprint: "AA:BB:CC:DD",
          expiresAt: future,
        });
      }
      if (url.endsWith("/devices/pairing-requests/req-1/reject")) {
        rejectCalled = true;
        return jsonResponse({});
      }
      if (url.endsWith("/devices/pairing-requests/req-1")) {
        if (rejectCalled) {
          return jsonResponse({ status: "pending" });
        }
        return jsonResponse({
          status: "claim_pending_confirmation",
          claimId: "claim-1",
          claimTenantId: "tenant-attacker",
          claimPropertyId: "property-attacker",
          claimPropertyName: "Some Other Hotel",
          claimTerminalName: "Bar Till",
          claimMode: "POS",
          claimNonce: btoa("n".repeat(32)),
          claimExpiresAt: future,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSession(store);
    expect(await screen.findByTestId("shell")).toHaveTextContent("UNPAIRED");

    await userEvent.click(screen.getByTestId("start-pairing"));
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("confirming"));
    expect(screen.getByTestId("claim-property")).toHaveTextContent("Some Other Hotel");

    await userEvent.click(screen.getByTestId("reject-claim"));
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("waiting"));
    expect(screen.getByTestId("shell")).toHaveTextContent("UNPAIRED");
    expect(screen.getByTestId("approved")).toHaveTextContent("no");
    expect(pairingRequestCalls).toBeGreaterThanOrEqual(2);
  });
});
