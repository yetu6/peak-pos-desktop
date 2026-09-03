import { describe, expect, it, vi } from "vitest";
import { createNativeOfflineAuthority } from "./offlineAuthorization";

describe("native offline authority boundary", () => {
  it("passes only typed envelopes, PIN input, and safe status through Tauri commands", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "offline_eligibility_status") return { state: "CATALOG_REQUIRED" };
      if (command === "authenticate_offline_staff") return { state: "DENIED", retryAfterMs: 3_000 };
      return undefined;
    });
    const authority = createNativeOfflineAuthority(invoke);
    const envelope = { keyId: "key-1", payloadB64: "payload", signatureB64: "signature" };

    await authority.applyLifecycleEvent(envelope);
    await expect(authority.authenticateStaff("staff-1", "2468")).resolves.toEqual({
      state: "DENIED",
      retryAfterMs: 3_000,
    });
    await expect(authority.eligibilityStatus("staff-1")).resolves.toEqual({
      state: "CATALOG_REQUIRED",
    });
    await authority.clearStaffSession();
    expect(invoke).toHaveBeenCalledWith("apply_terminal_lifecycle_event", { envelope });
    expect(invoke).toHaveBeenCalledWith("authenticate_offline_staff", {
      staffId: "staff-1",
      pin: "2468",
    });
    expect(invoke).toHaveBeenCalledWith("clear_active_staff_session");
  });
});
