import { expect, it, vi } from "vitest";
import { monochromeLogo, loadBillLogo } from "./billLogo";
import { EscPos, readable } from "./escpos";
import { receiptBytes } from "./receipt";

it.each([[32, 384], [48, 576]] as const)("packs monochrome raster at %s characters (%s dots)", (width, dots) => {
  const logo = monochromeLogo({ width: 2, height: 1, data: new Uint8ClampedArray([0,0,0,255, 0,0,0,0]) }, width);
  expect(logo.width).toBe(dots);
  expect(logo.height).toBe(dots / 2);
  expect(logo.data).toHaveLength(dots / 8 * logo.height);
  expect(logo.data[0]).toBe(255);
  expect(logo.data[dots / 8 - 1]).toBe(0);
  const bytes = new EscPos(width).raster(logo).line("Business name").build();
  expect(Array.from(bytes.slice(2, 10))).toEqual([29,118,48,0,dots/8,0,logo.height % 256,Math.floor(logo.height/256)]);
  expect(readable(bytes)).toBe("Business name\n");
});
it("invalid raster falls back to text without printing image bytes", () => {
  const bytes = receiptBytes({ propertyName: "Bahari QA Hotel", beforePayment: true, lines: [] }, 48,
    { logo: { width: 576, height: 1, data: new Uint8Array(0) } });
  expect(readable(bytes)).toContain("BAHARI QA HOTEL");
  expect(Array.from(bytes).join(",")).not.toContain("29,118,48,0");
});
it("image loading errors and disabled logos safely return text fallback", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Printer branding unavailable"));
  try {
    expect(await loadBillLogo("https://example.invalid/logo.png", 48, false)).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await loadBillLogo("not a URL", 48, true)).toBeUndefined();
    expect(await loadBillLogo("https://example.invalid/missing.png", 48, true)).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { fetcher.mockRestore(); }
});
it("malformed image dimensions are refused", () => {
  expect(() => monochromeLogo({ width: 0, height: 1, data: new Uint8ClampedArray() }, 48)).toThrow();
});

it("reads a previously converted logo after memory is gone and refuses corrupt cache entries", async () => {
  const { cachedBillLogo, BILL_LOGO_CACHE_KEY } = await import("./billLogo");
  const url = "https://files.example.test/property-a/logo-v2.png";
  const raster = { width: 576, height: 1, data: Array(72).fill(255) };
  localStorage.setItem(BILL_LOGO_CACHE_KEY, JSON.stringify([[`48:${url}`, raster]]));
  expect(cachedBillLogo(url, 48)?.data).toEqual(new Uint8Array(72).fill(255));
  expect(cachedBillLogo(url.replace("property-a", "property-b"), 48)).toBeUndefined();
  expect(cachedBillLogo(url, 32)).toBeUndefined();
  localStorage.setItem(BILL_LOGO_CACHE_KEY, JSON.stringify([["48:broken", { ...raster, data: [] }]]));
  expect(cachedBillLogo("broken", 48)).toBeUndefined();
  localStorage.removeItem(BILL_LOGO_CACHE_KEY);
});
