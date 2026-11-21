import { describe, expect, it, vi } from "vitest";
import { createNativeSignInKit, fetchSignInKit, mapSignInCheck, type NativeSignInCheck } from "./signInKit";

const staff = { staffId: "staff-1", displayName: "Amina Hassan", roleCode: "POS_CASHIER", permissions: ["pos.order.create"] };
const terminal = { mode: "BAR", prepStations: [], propertyName: "Casanova", outletName: "Bar", terminalName: "Main till", capabilities: {} };

describe("the sign-in kit boundary", () => {
  it("maps each native answer to its typed result", () => {
    const cases: Array<[NativeSignInCheck, unknown]> = [
      [{ state: "OK", staff, terminal }, { kind: "ok", staff, terminal }],
      [{ state: "WRONG", attemptsLeft: 3 }, { kind: "wrong", attemptsLeft: 3 }],
      [{ state: "LOCKED", untilMs: 99 }, { kind: "locked", untilMs: 99 }],
      [{ state: "NO_COPY" }, { kind: "no-copy" }],
      [{ state: "UNKNOWN" }, { kind: "unknown" }],
    ];
    for (const [native, typed] of cases) expect(mapSignInCheck(native)).toEqual(typed);
  });

  it("refuses an answer it does not know instead of guessing", () => {
    expect(() => mapSignInCheck({ state: "SOMETHING_NEW" } as unknown as NativeSignInCheck)).toThrow();
  });

  it("sends the kit, the PIN and the clear through the right native commands", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "verify_sign_in_pin") return { state: "WRONG", attemptsLeft: 4 };
      if (command === "install_sign_in_kit") return { terminalId: "t-1", issuedAtMs: 5, expiresAtMs: 99, staffCount: 2 };
      return undefined;
    });
    const store = createNativeSignInKit(invoke);
    await expect(store.install({ signedKit: "k", signature: "s", keyId: "id" })).resolves.toEqual({
      kind: "installed",
      summary: { terminalId: "t-1", issuedAtMs: 5, expiresAtMs: 99, staffCount: 2 },
    });
    await expect(store.verify("staff-1", "0000")).resolves.toEqual({ kind: "wrong", attemptsLeft: 4 });
    await store.clear();
    expect(invoke).toHaveBeenCalledWith("install_sign_in_kit", { signedKit: "k", signature: "s", keyId: "id" });
    expect(invoke).toHaveBeenCalledWith("verify_sign_in_pin", { staffId: "staff-1", pin: "0000" });
    expect(invoke).toHaveBeenCalledWith("clear_sign_in_kit");
  });

  it("says why a kit was refused: old, or refused for another reason", async () => {
    const refuseWith = (kind: string) =>
      createNativeSignInKit(async () => {
        throw kind;
      }).install({ signedKit: "k", signature: "s", keyId: "id" });
    await expect(refuseWith("KIT_ROLLBACK")).resolves.toEqual({ kind: "rollback" });
    await expect(refuseWith("INVALID_AUTHORIZATION")).resolves.toEqual({
      kind: "refused",
      reason: "INVALID_AUTHORIZATION",
    });
    await expect(refuseWith("AUTHORIZATION_ROLLBACK")).resolves.toEqual({
      kind: "refused",
      reason: "AUTHORIZATION_ROLLBACK",
    });
  });

  it("lets a failure of the store itself reach the caller", async () => {
    const store = createNativeSignInKit(async () => {
      throw "DISK_FULL";
    });
    await expect(store.install({ signedKit: "k", signature: "s", keyId: "id" })).rejects.toBe("DISK_FULL");
  });

  it("takes its nonce from the native store, and sends it with the device credential", async () => {
    const invoke = vi.fn(async () => "nonce-from-the-till");
    const store = createNativeSignInKit(invoke);
    const send = vi.fn(async () => new Response(JSON.stringify({ signedKit: "k", signature: "s", keyId: "id" })));
    const fetched = await fetchSignInKit(store, { baseUrl: "https://yetu.example", terminalId: "t-1", deviceCredential: "cred" }, send);
    expect(invoke).toHaveBeenCalledWith("new_sign_in_kit_nonce");
    expect(send).toHaveBeenCalledWith(
      "https://yetu.example/api/v1/pos/device/sign-in-kit",
      expect.objectContaining({ method: "POST" }),
    );
    const init = (send.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toEqual({
      terminalId: "t-1",
      deviceCredential: "cred",
      nonce: "nonce-from-the-till",
    });
    expect(fetched).toEqual({ kind: "kit", kit: { signedKit: "k", signature: "s", keyId: "id" } });
  });

  it("says the till is not paired on a 401 and throws on any other failure", async () => {
    const store = { newNonce: async () => "n" };
    const request = { baseUrl: "https://yetu.example", terminalId: "t-1", deviceCredential: "cred" };
    await expect(fetchSignInKit(store, request, async () => new Response("", { status: 401 }))).resolves.toEqual({
      kind: "not-paired",
    });
    await expect(fetchSignInKit(store, request, async () => new Response("", { status: 503 }))).rejects.toThrow();
    await expect(
      fetchSignInKit(store, request, async () => new Response(JSON.stringify({ signature: "s" }))),
    ).rejects.toThrow();
  });
});
