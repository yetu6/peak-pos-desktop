import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deviceCredentialDigest,
  generateDeviceCredential,
  getPairingStatus,
  requestPairing,
} from "./deviceAuth";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("schema-84 POS pairing contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a pre-tenant request without sending the reusable device credential", async () => {
    const credential = "terminal-only-credential";
    const digest = await deviceCredentialDigest(credential);
    const fetchMock = vi.fn(async () =>
      response(
        {
          pairingRequestId: "11111111-1111-4111-8111-111111111111",
          pairingCode: "23456-ABCDE",
          claimToken: "claim-token-with-at-least-thirty-two-characters",
          fingerprint: "sha256:abc",
          expiresAt: "2099-01-01T00:00:00Z",
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const issued = await requestPairing("https://api.peak.test", "raw-ed25519-key", digest);

    expect(issued.pairingCode).toBe("23456-ABCDE");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.peak.test/api/v1/pos/pairing-requests");
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(body).toEqual({ publicKey: "raw-ed25519-key", deviceCredentialHash: digest });
    expect(JSON.stringify(body)).not.toContain(credential);
  });

  it("polls with the terminal-only claim token and accepts only real server states", async () => {
    const fetchMock = vi.fn(async () =>
      response({
        status: "CONSUMED",
        terminalId: "22222222-2222-4222-8222-222222222222",
        expiresAt: "2099-01-01T00:00:00Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const status = await getPairingStatus(
      "https://api.peak.test",
      "11111111-1111-4111-8111-111111111111",
      "claim-token-with-at-least-thirty-two-characters",
    );

    expect(status.status).toBe("CONSUMED");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.peak.test/api/v1/pos/pairing-requests/11111111-1111-4111-8111-111111111111",
      { headers: { "X-Peak-Pairing-Token": "claim-token-with-at-least-thirty-two-characters" } },
    );
  });

  it("generates a new high-entropy local credential for each pairing lifecycle", () => {
    const first = generateDeviceCredential();
    const second = generateDeviceCredential();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(second.length).toBeGreaterThanOrEqual(43);
  });
});
