import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceRevokedError, sendHeartbeat } from "./deviceAuth";

describe("sendHeartbeat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the device credential without a staff session", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendHeartbeat("https://api.yetu.test", "terminal-1", "device-secret");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.yetu.test/api/v1/pos/terminals/terminal-1/heartbeat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ deviceCredential: "device-secret" }),
      }),
    );
  });

  it("maps 401 to DeviceRevokedError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(sendHeartbeat("https://api.yetu.test", "terminal-1", "secret")).rejects.toBeInstanceOf(
      DeviceRevokedError,
    );
  });
});
