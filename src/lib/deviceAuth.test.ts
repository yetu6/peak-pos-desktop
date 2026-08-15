import { afterEach, describe, expect, it, vi } from "vitest";
import { generateDeviceKeyPair } from "./deviceCrypto";
import {
  DeviceNotApprovedError,
  StaffLoginRejectedError,
  createStaffSession,
  humanDeviceError,
  issueChallenge,
  requestPairing,
} from "./deviceAuth";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("deviceAuth client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an unauthenticated pairing request with the SPKI public key", async () => {
    const keys = await generateDeviceKeyPair();
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        deviceCode: "dev_abc",
        pairingCode: "418205",
        fingerprint: "AA:BB:CC:DD:EE:FF:00:11",
        expiresAt: "2026-08-15T21:00:00Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const issued = await requestPairing("http://peak.test", keys.publicKeySpki);

    expect(issued.deviceCode).toBe("dev_abc");
    expect(issued.pairingCode).toBe("418205");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect(url).toBe("http://peak.test/api/v1/devices/pairing-requests");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ publicKey: keys.publicKeySpki });
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-Peak-Tenant-Id")).toBeNull();
    expect(headers.get("X-Peak-Tenant-User-Id")).toBeNull();
  });

  it("treats a 401 challenge as not yet approved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ title: "Unauthorized" }, 401)));
    await expect(issueChallenge("http://peak.test", "dev_abc")).resolves.toBeNull();
  });

  it("signs the challenge nonce and opens a staff session", async () => {
    const keys = await generateDeviceKeyPair();
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const nonceB64 = btoa(String.fromCharCode(...nonce));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/devices/challenges")) {
        return jsonResponse({
          challengeId: "11111111-1111-1111-1111-111111111111",
          nonce: nonceB64,
          expiresAt: "2026-08-15T21:02:00Z",
        });
      }
      return jsonResponse({
        token: "ops_testtoken",
        expiresAt: "2026-08-16T05:00:00Z",
        sessionClass: "operational",
        deviceId: "22222222-2222-2222-2222-222222222222",
        propertyId: "33333333-3333-3333-3333-333333333333",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = await createStaffSession({
      baseUrl: "http://peak.test",
      deviceCode: "dev_abc",
      privateKeyPkcs8: keys.privateKeyPkcs8,
      staffNumber: "0007",
      pin: "418205",
    });

    expect(session.token).toBe("ops_testtoken");
    expect(session.propertyId).toBe("33333333-3333-3333-3333-333333333333");
    expect(session.staffNumber).toBe("0007");
    expect(session.tenantId).toBeUndefined();
    expect(session.userId).toBeUndefined();
    expect(session.outletId).toBeUndefined();

    const loginCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).endsWith("/staff/sessions"),
    ) as unknown as [string, RequestInit] | undefined;
    expect(loginCall).toBeTruthy();
    const init = loginCall?.[1] ?? {};
    const body = JSON.parse(String(init.body)) as {
      deviceCode: string;
      challengeId: string;
      signature: string;
      staffNumber: string;
      pin: string;
    };
    expect(body.deviceCode).toBe("dev_abc");
    expect(body.challengeId).toBe("11111111-1111-1111-1111-111111111111");
    expect(body.staffNumber).toBe("0007");
    expect(body.pin).toBe("418205");
    expect(body.signature.length).toBeGreaterThan(40);
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-Peak-Tenant-Id")).toBeNull();
  });

  it("keeps optional login identity fields when Peak starts returning them", async () => {
    const keys = await generateDeviceKeyPair();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/devices/challenges")) {
          return jsonResponse({
            challengeId: "11111111-1111-1111-1111-111111111111",
            nonce: btoa("n".repeat(32)),
            expiresAt: "2026-08-15T21:02:00Z",
          });
        }
        return jsonResponse({
          token: "ops_full",
          expiresAt: "2026-08-16T05:00:00Z",
          sessionClass: "operational",
          deviceId: "d1",
          propertyId: "p1",
          tenantId: "t1",
          userId: "u1",
          outletId: "o1",
          mode: "cashier",
          terminalName: "Bar 1",
        });
      }),
    );

    const session = await createStaffSession({
      baseUrl: "http://peak.test",
      deviceCode: "dev_abc",
      privateKeyPkcs8: keys.privateKeyPkcs8,
      staffNumber: "0007",
      pin: "418205",
    });
    expect(session).toMatchObject({
      tenantId: "t1",
      userId: "u1",
      outletId: "o1",
      propertyId: "p1",
      mode: "cashier",
      terminalName: "Bar 1",
    });
  });

  it("does not open a session when the device is still unpaired", async () => {
    const keys = await generateDeviceKeyPair();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 401)));
    await expect(
      createStaffSession({
        baseUrl: "http://peak.test",
        deviceCode: "dev_abc",
        privateKeyPkcs8: keys.privateKeyPkcs8,
        staffNumber: "0007",
        pin: "418205",
      }),
    ).rejects.toBeInstanceOf(DeviceNotApprovedError);
  });

  it("rejects a wrong PIN with a till-safe error", async () => {
    const keys = await generateDeviceKeyPair();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/devices/challenges")) {
          return jsonResponse({
            challengeId: "11111111-1111-1111-1111-111111111111",
            nonce: btoa("n".repeat(32)),
            expiresAt: "2026-08-15T21:02:00Z",
          });
        }
        return jsonResponse({ title: "Unauthorized" }, 401);
      }),
    );
    await expect(
      createStaffSession({
        baseUrl: "http://peak.test",
        deviceCode: "dev_abc",
        privateKeyPkcs8: keys.privateKeyPkcs8,
        staffNumber: "0007",
        pin: "000000",
      }),
    ).rejects.toBeInstanceOf(StaffLoginRejectedError);
  });

  it("maps network failures to till-safe copy", () => {
    expect(humanDeviceError(new TypeError("Failed to fetch"))).toBe(
      "Can't reach Peak. Check the server address.",
    );
    expect(humanDeviceError(new StaffLoginRejectedError())).toBe(
      "That staff number or PIN was not accepted.",
    );
    expect(humanDeviceError(new Error("boom at Object.<anonymous>"))).toBe(
      "Something went wrong. Try again.",
    );
  });
});
