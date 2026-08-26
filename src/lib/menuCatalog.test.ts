import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOutletMenu, parseMenuItems } from "./menuCatalog";

describe("restricted POS catalog", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("loads products only from the session-bound Go catalog", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ outletId: "o1", outletName: "Bar", products: [{ id: "p1", name: "Coffee", priceMinor: 400000, currency: "TZS", taxRateBp: 0 }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchOutletMenu({ baseUrl: "https://api.peak.localhost", propertyId: "ignored", outletId: "ignored", headers: { Authorization: "Bearer restricted" } });
    expect(result).toEqual({ source: "peak", items: [{ id: "p1", name: "Coffee", category: "Menu" }] });
    expect(fetchMock).toHaveBeenCalledWith("https://api.peak.localhost/api/v1/pos/catalog", expect.anything());
  });
  it("fails closed instead of showing a fake catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(fetchOutletMenu({ baseUrl: "https://api.peak.localhost", propertyId: "p", outletId: "o", headers: {} })).rejects.toThrow("HTTP 503");
  });
  it("parses catalog product envelopes", () => {
    expect(parseMenuItems({ products: [{ id: "p1", name: "Tea" }] })).toEqual([{ id: "p1", name: "Tea", category: "Menu" }]);
  });
});
