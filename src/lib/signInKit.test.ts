import { describe, expect, it, vi } from "vitest";
import { createNativeSignInKit, mapSignInCheck, type NativeSignInCheck } from "./signInKit";

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
      if (command === "install_sign_in_kit") return { terminalId: "t-1", issuedAtMs: 5, staffCount: 2 };
      return undefined;
    });
    const store = createNativeSignInKit(invoke);
    await expect(store.install({ signedKit: "k", signature: "s", keyId: "id" })).resolves.toEqual({
      terminalId: "t-1",
      issuedAtMs: 5,
      staffCount: 2,
    });
    await expect(store.verify("staff-1", "0000")).resolves.toEqual({ kind: "wrong", attemptsLeft: 4 });
    await store.clear();
    expect(invoke).toHaveBeenCalledWith("install_sign_in_kit", { signedKit: "k", signature: "s", keyId: "id" });
    expect(invoke).toHaveBeenCalledWith("verify_sign_in_pin", { staffId: "staff-1", pin: "0000" });
    expect(invoke).toHaveBeenCalledWith("clear_sign_in_kit");
  });

  it("lets a native refusal reach the caller", async () => {
    const store = createNativeSignInKit(async () => {
      throw "INVALID_AUTHORIZATION";
    });
    await expect(store.install({ signedKit: "k", signature: "s", keyId: "id" })).rejects.toBe("INVALID_AUTHORIZATION");
  });
});
