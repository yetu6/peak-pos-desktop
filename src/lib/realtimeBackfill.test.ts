import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({
  API_BASE_URL: "http://peak.test",
  getApiBaseUrl: () => "http://peak.test",
  devIdentityFromEnv: () => ({ tenantId: "t1", userId: "u1", propertyId: "p1", outletId: "o1" }),
}));

vi.mock("./peakConfig", () => ({
  getApiBaseUrl: () => "http://peak.test",
}));

async function freshModule() {
  vi.resetModules();
  return import("./realtimeBackfill");
}

describe("POS realtime catch-up", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("asks the backend for nothing: fbc-peak has no catch-up route for POS", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { noPosCatchUp } = await freshModule();
    expect(await noPosCatchUp(0)).toEqual([]);
    expect(await noPosCatchUp(42)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says so once in the log, and nothing on screen", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { noPosCatchUp } = await freshModule();
    await noPosCatchUp(0);
    await noPosCatchUp(3);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toMatch(/no POS realtime catch-up/i);
  });
});
