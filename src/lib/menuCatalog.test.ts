import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOutletMenu, parseMenuItems } from "./menuCatalog";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("outlet menu client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses Peak menu items when GET pos-config/menu-items succeeds", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse([
        { id: "item-1", name: "Ugali", category: "Kitchen" },
        { menuItemId: "item-2", name: "Samosa", categoryName: "Snacks" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchOutletMenu({
      baseUrl: "http://peak.test",
      propertyId: "p1",
      outletId: "o1",
      headers: { "X-Peak-Tenant-Id": "t1", "X-Peak-Tenant-User-Id": "u1" },
    });

    expect(result.source).toBe("peak");
    expect(result.items).toEqual([
      { id: "item-1", name: "Ugali", category: "Kitchen" },
      { id: "item-2", name: "Samosa", category: "Snacks" },
    ]);
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit?];
    expect(String(firstCall[0])).toBe(
      "http://peak.test/api/v1/properties/p1/pos-config/menu-items?outletId=o1",
    );
  });

  it("falls back to the documented dev catalog when Peak GET 404s", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ title: "Not Found" }, 404)));
    const result = await fetchOutletMenu({
      baseUrl: "http://peak.test",
      propertyId: "p1",
      outletId: "o1",
      headers: {},
    });
    expect(result.source).toBe("dev-catalog");
    expect(result.items.some((item) => item.name === "Nyama Choma")).toBe(true);
  });

  it("parses either a bare array or an items envelope", () => {
    expect(parseMenuItems({ items: [{ id: "a", name: "Tea" }] })).toEqual([
      { id: "a", name: "Tea", category: "Menu" },
    ]);
  });

  it("joins Peak category names onto menu items", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("menu-categories")) {
        return jsonResponse([{ id: "cat-1", name: "Grill" }]);
      }
      return jsonResponse([{ id: "item-1", name: "Nyama", categoryId: "cat-1" }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchOutletMenu({
      baseUrl: "http://peak.test",
      propertyId: "p1",
      outletId: "o1",
      headers: { Authorization: "Bearer ops_abc" },
    });
    expect(result).toEqual({
      source: "peak",
      items: [{ id: "item-1", name: "Nyama", category: "Grill" }],
    });
    expect(fetchMock.mock.calls.every((call) => {
      const init = (call as unknown as [string, RequestInit?])[1];
      const headers = new Headers(init?.headers);
      return headers.get("Authorization") && !headers.get("X-Peak-Tenant-Id");
    })).toBe(true);
  });

  it("does not fall back to the catalog on a non-404 failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ title: "Forbidden" }, 403)));
    await expect(
      fetchOutletMenu({
        baseUrl: "http://peak.test",
        propertyId: "p1",
        outletId: "o1",
        headers: { Authorization: "Bearer ops_abc" },
      }),
    ).rejects.toThrow(/HTTP 403/);
  });
});
