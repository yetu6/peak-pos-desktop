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
  const { shell, identity, session, unlock, switchStaff, phase } = useDeviceSession();
  return (
    <div>
      <div data-testid="shell">{shell}</div>
      <div data-testid="phase">{phase}</div>
      <div data-testid="device">{identity?.deviceCode ?? ""}</div>
      <div data-testid="ops">{session?.token ?? ""}</div>
      <button data-testid="unlock" onClick={() => void unlock("0007", "418205")}>
        Unlock
      </button>
      <button data-testid="switch" onClick={() => switchStaff()}>
        Switch
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
});
