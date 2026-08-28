import { afterEach, describe, expect, it, vi } from "vitest";
import { generateDeviceKeyPair } from "./deviceCrypto";
import { createStaffSession, fetchStaffRoster, issueChallenge, StaffLoginRejectedError } from "./deviceAuth";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const nonce = "bm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm4";

describe("Go POS device authentication", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the device credential and exposes only the minimal roster", async () => {
    const fetchMock = vi.fn(async () => response({ challengeId: "c1", nonce, expiresAt: "2026-08-25T13:00:00Z", staff: [{ id: "s1", displayName: "Amina", staffSuffix: "001" }] }, 201));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchStaffRoster("https://api.peak.localhost", "terminal-1", "secret")).toEqual([{ staffNumber: "s1", fullName: "Amina" }]);
    expect(fetchMock).toHaveBeenCalledWith("https://api.peak.localhost/api/v1/pos/device/challenges", expect.objectContaining({ body: JSON.stringify({ terminalId: "terminal-1", deviceCredential: "secret" }) }));
  });

  it("returns null when a terminal credential is revoked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ code: "POS_DEVICE_UNAUTHORIZED" }, 401)));
    await expect(issueChallenge("https://api.peak.localhost", "terminal-1", "revoked")).resolves.toBeNull();
  });

  it("signs the challenge and creates a restricted staff session", async () => {
    const keys = await generateDeviceKeyPair();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/challenges")
      ? response({ challengeId: "c1", nonce, expiresAt: "2026-08-25T13:00:00Z", staff: [] }, 201)
      : response({ token: "x".repeat(48), expiresAt: "2026-08-25T20:00:00Z", tenantId: "org1", propertyId: "p1", outletId: "o1", terminalId: "t1", staffId: "s1", assurance: "RESTRICTED" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const session = await createStaffSession({ baseUrl: "https://api.peak.localhost", terminalId: "t1", deviceCredential: "secret", privateKeyPkcs8: keys.privateKeyPkcs8, staffNumber: "s1", pin: "418205" });
    expect(session).toEqual({
      token: "x".repeat(48),
      expiresAt: "2026-08-25T20:00:00Z",
      tenantId: "org1",
      propertyId: "p1",
      outletId: "o1",
      terminalId: "t1",
      staffId: "s1",
      assurance: "RESTRICTED",
    });
    const login = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const body = JSON.parse(String(login[1].body));
    expect(body).toMatchObject({ challengeId: "c1", staffId: "s1", pin: "418205" });
    expect(body.signature).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects a session response that omits server authority context", async () => {
    const keys = await generateDeviceKeyPair();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/challenges")
      ? response({ challengeId: "c1", nonce, expiresAt: "2026-08-25T13:00:00Z", staff: [] }, 201)
      : response({ token: "x".repeat(48), expiresAt: "2026-08-25T20:00:00Z", propertyId: "p1", outletId: "o1", terminalId: "t1", staffId: "s1", assurance: "RESTRICTED" }, 201)));

    await expect(createStaffSession({ baseUrl: "https://api.peak.localhost", terminalId: "t1", deviceCredential: "secret", privateKeyPkcs8: keys.privateKeyPkcs8, staffNumber: "s1", pin: "418205" })).rejects.toThrow(/incomplete POS session/i);
  });

  it("maps a rejected PIN to a till-safe error", async () => {
    const keys = await generateDeviceKeyPair();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/challenges") ? response({ challengeId: "c1", nonce, expiresAt: "soon", staff: [] }, 201) : response({}, 401)));
    await expect(createStaffSession({ baseUrl: "https://api.peak.localhost", terminalId: "t1", deviceCredential: "secret", privateKeyPkcs8: keys.privateKeyPkcs8, staffNumber: "s1", pin: "000000" })).rejects.toBeInstanceOf(StaffLoginRejectedError);
  });
});
