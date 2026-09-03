import { describe, expect, it, vi } from "vitest";
import { createNativeDeviceAuthority } from "./nativeDeviceAuthority";

describe("native device authority", () => {
  it("returns public identity and delegates signing without exposing key material", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "ensure_device_identity") return { publicKey: "public-key" };
      if (command === "sign_device_challenge") return "signature";
      throw new Error("unexpected command");
    });
    const authority = createNativeDeviceAuthority(invoke);

    await expect(authority.ensureIdentity()).resolves.toEqual({ publicKey: "public-key" });
    await expect(authority.signChallenge("bm9uY2U")).resolves.toBe("signature");
    expect(invoke).toHaveBeenLastCalledWith("sign_device_challenge", { nonce: "bm9uY2U" });
    expect(JSON.stringify(await authority.ensureIdentity())).not.toMatch(/private|secret/i);
  });
});
