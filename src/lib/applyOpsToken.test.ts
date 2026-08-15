import { afterEach, describe, expect, it, vi } from "vitest";
import { applyOpsTokenToBridge, opsTokenBridgeOrigin } from "./applyOpsToken";
import { handshakeHeaders } from "./bridgeHandshake";

function jsonResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}) } as Response;
}

describe("bridge ops token", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the ops token to the bridge origin and never identity headers", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(204));
    vi.stubGlobal("fetch", fetchMock);

    await applyOpsTokenToBridge("ops_abc", "ws://localhost:5174/bridge");

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:5174/ops-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "ops_abc" }),
    });
  });

  it("maps a websocket bridge URL to its http origin", () => {
    expect(opsTokenBridgeOrigin("ws://localhost:5174/bridge")).toBe("http://localhost:5174");
    expect(opsTokenBridgeOrigin("wss://till.example/bridge")).toBe("https://till.example");
  });

  it("builds token-only handshake headers and refuses to mix with X-Peak-*", () => {
    expect(handshakeHeaders({ opsToken: "ops_abc" })).toEqual({
      Authorization: "Bearer ops_abc",
      Origin: "http://localhost:5173",
    });
    expect(() =>
      handshakeHeaders({ opsToken: "ops_abc", tenantId: "t", userId: "u" }),
    ).toThrow(/cannot be combined/);
    expect(handshakeHeaders({ tenantId: "t", userId: "u" })).toEqual({
      "X-Peak-Tenant-Id": "t",
      "X-Peak-Tenant-User-Id": "u",
      Origin: "http://localhost:5173",
    });
  });
});
