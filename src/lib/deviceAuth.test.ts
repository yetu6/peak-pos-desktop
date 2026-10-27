import { afterEach, describe, expect, it, vi } from "vitest";
import { generateDeviceKeyPair } from "./deviceCrypto";
import {
  createStaffSession,
  fetchStaffRoster,
  humanDeviceError,
  issueChallenge,
  NEW_PIN_REFUSED_WORDS,
  StaffLoginRateLimitedError,
  StaffLoginRejectedError,
  StaffNewPinRefusedError,
  StaffPinSetupRequiredError,
  StaffSetupCodeExpiredError,
} from "./deviceAuth";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const nonce = "bm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm4";

describe("Go POS device authentication", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the device credential and exposes only the minimal roster, with who is new", async () => {
    const fetchMock = vi.fn(async () => response({ challengeId: "c1", nonce, expiresAt: "2026-08-25T13:00:00Z", staff: [
      { id: "s1", displayName: "Amina", needsSetup: false },
      { id: "s2", displayName: "Neema", needsSetup: true },
      // An older Yetu sends no needsSetup at all.
      { id: "s3", displayName: "Baraka" },
    ] }, 201));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchStaffRoster("https://api.peak.localhost", "terminal-1", "secret")).toEqual([
      { staffNumber: "s1", fullName: "Amina", needsSetup: false },
      { staffNumber: "s2", fullName: "Neema", needsSetup: true },
      { staffNumber: "s3", fullName: "Baraka", needsSetup: false },
    ]);
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
      mode: undefined,
      terminalName: undefined,
      capabilities: [],
      permissions: [],
      prepStations: [],
    });
    const login = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const body = JSON.parse(String(login[1].body));
    expect(body).toMatchObject({ challengeId: "c1", staffId: "s1", pin: "418205" });
    expect(body.signature).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("carries the session's authoritative capabilities and permissions through (R6A-C)", async () => {
    const keys = await generateDeviceKeyPair();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/challenges")
      ? response({ challengeId: "c1", nonce, expiresAt: "2026-08-25T13:00:00Z", staff: [] }, 201)
      : response({
          token: "x".repeat(48), expiresAt: "2026-08-25T20:00:00Z", tenantId: "org1", propertyId: "p1",
          outletId: "o1", terminalId: "t1", staffId: "s1", assurance: "RESTRICTED",
          capabilities: ["CORE", "LODGING", "POS"], permissions: ["pos.order.create", "pos.payment.record"],
        }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const session = await createStaffSession({ baseUrl: "https://api.peak.localhost", terminalId: "t1", deviceCredential: "secret", privateKeyPkcs8: keys.privateKeyPkcs8, staffNumber: "s1", pin: "418205" });
    expect(session.capabilities).toEqual(["CORE", "LODGING", "POS"]);
    expect(session.permissions).toEqual(["pos.order.create", "pos.payment.record"]);
  });

  it("degrades a malformed or missing capabilities/permissions field to an empty list instead of throwing", async () => {
    const keys = await generateDeviceKeyPair();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/challenges")
      ? response({ challengeId: "c1", nonce, expiresAt: "2026-08-25T13:00:00Z", staff: [] }, 201)
      : response({
          token: "x".repeat(48), expiresAt: "2026-08-25T20:00:00Z", tenantId: "org1", propertyId: "p1",
          outletId: "o1", terminalId: "t1", staffId: "s1", assurance: "RESTRICTED", capabilities: "POS",
        }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const session = await createStaffSession({ baseUrl: "https://api.peak.localhost", terminalId: "t1", deviceCredential: "secret", privateKeyPkcs8: keys.privateKeyPkcs8, staffNumber: "s1", pin: "418205" });
    expect(session.capabilities).toEqual([]);
    expect(session.permissions).toEqual([]);
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

  it("says when Yetu limits sign-in attempts (429), with how long it asked the till to wait", async () => {
    const keys = await generateDeviceKeyPair();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/challenges")
      ? response({ challengeId: "c1", nonce, expiresAt: "soon", staff: [] }, 201)
      : new Response(JSON.stringify({ status: 429, code: "RATE_LIMITED", detail: "Too many requests. Try again in 1795 seconds." }), {
          status: 429,
          headers: { "Content-Type": "application/problem+json", "Retry-After": "1795" },
        })));
    const refused = await createStaffSession({ baseUrl: "https://api.peak.localhost", terminalId: "t1", deviceCredential: "secret", privateKeyPkcs8: keys.privateKeyPkcs8, staffNumber: "s1", pin: "418205" }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(StaffLoginRateLimitedError);
    expect((refused as StaffLoginRateLimitedError).retryAfterSeconds).toBe(1795);
    // Not a network failure: the till must not fall back to signing in offline.
    expect(humanDeviceError(refused)).toBe("Too many sign-in attempts. Wait before trying again.");
  });
});

describe("a new person's setup code (fbc-peak 00134: they choose their own PIN at the till)", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function signIn(answer: Response, pins: { pin: string; newPin?: string }) {
    const keys = await generateDeviceKeyPair();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/challenges")
      ? response({ challengeId: "c1", nonce, expiresAt: "soon", staff: [] }, 201)
      : answer);
    vi.stubGlobal("fetch", fetchMock);
    const result = await createStaffSession({ baseUrl: "https://api.peak.localhost", terminalId: "t1", deviceCredential: "secret", privateKeyPkcs8: keys.privateKeyPkcs8, staffNumber: "s1", ...pins })
      .catch((error: unknown) => error);
    const login = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    return { result, sent: JSON.parse(String(login[1].body)) as Record<string, unknown> };
  }

  it("says a right setup code sent alone needs a PIN chosen (409), and sends no newPin", async () => {
    const { result, sent } = await signIn(response({ code: "POS_PIN_SETUP_REQUIRED", detail: "Your setup code is right." }, 409), { pin: "246810" });
    expect(result).toBeInstanceOf(StaffPinSetupRequiredError);
    expect(sent.pin).toBe("246810");
    expect(sent).not.toHaveProperty("newPin");
  });

  it("sends the chosen PIN with the setup code", async () => {
    const { sent } = await signIn(response({ token: "x".repeat(48), expiresAt: "2026-08-25T20:00:00Z", tenantId: "org1", propertyId: "p1", outletId: "o1", terminalId: "t1", staffId: "s1", assurance: "RESTRICTED" }, 201), { pin: "246810", newPin: "583920" });
    expect(sent).toMatchObject({ staffId: "s1", pin: "246810", newPin: "583920" });
  });

  it("tells an expired setup code from a wrong one", async () => {
    const expired = await signIn(response({ code: "POS_SETUP_CODE_EXPIRED" }, 401), { pin: "246810" });
    expect(expired.result).toBeInstanceOf(StaffSetupCodeExpiredError);
    expect(humanDeviceError(expired.result)).toBe("This setup code has expired. Ask your manager for a new one.");
    const wrong = await signIn(response({ code: "POS_PIN_UNAUTHORIZED" }, 401), { pin: "246811" });
    expect(wrong.result).toBeInstanceOf(StaffLoginRejectedError);
  });

  it("passes on Yetu's own words when it refuses the chosen PIN (422)", async () => {
    const detail = "Choose your own six-digit PIN -- not the setup code, and not one anybody could guess like 123456 or 111111.";
    const weak = await signIn(response({ code: "VALIDATION_FAILED", detail }, 422), { pin: "246810", newPin: "123456" });
    expect(weak.result).toBeInstanceOf(StaffNewPinRefusedError);
    expect((weak.result as StaffNewPinRefusedError).words).toBe(detail);
    const bare = await signIn(response({ code: "VALIDATION_FAILED" }, 422), { pin: "246810", newPin: "123456" });
    expect((bare.result as StaffNewPinRefusedError).words).toBe(NEW_PIN_REFUSED_WORDS);
  });

  it("takes a 409 or 422 that is not about a setup code as any other failure", async () => {
    const other = await signIn(response({ code: "CONFLICT" }, 409), { pin: "246810" });
    expect(other.result).not.toBeInstanceOf(StaffPinSetupRequiredError);
    expect(other.result).toBeInstanceOf(Error);
    const noNewPin = await signIn(response({ code: "VALIDATION_FAILED", detail: "Bad body." }, 422), { pin: "246810" });
    expect(noNewPin.result).not.toBeInstanceOf(StaffNewPinRefusedError);
  });
});
