import type { PaperWidth } from "./escpos";

export interface MonochromeRaster { width: 384 | 576; height: number; data: Uint8Array }
const MAX_LOGO_HEIGHT = 288;
const cache = new Map<string, MonochromeRaster>();
export const BILL_LOGO_CACHE_KEY = "yetu-bill-logos-v1";
const MAX_CACHE_ENTRIES = 8;
const MAX_CACHE_BYTES = 5 * 1024 * 1024;

function storedEntries(): [string, unknown][] {
  try {
    const raw = localStorage.getItem(BILL_LOGO_CACHE_KEY);
    if (!raw || raw.length > MAX_CACHE_BYTES) return [];
    const entries: unknown = JSON.parse(raw);
    return Array.isArray(entries) ? entries.filter((entry): entry is [string, unknown] => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string").slice(-MAX_CACHE_ENTRIES) : [];
  } catch { return []; }
}

/** URL (including property/version path) and width isolate cached branding. */
export function cachedBillLogo(url: string | undefined, paper: PaperWidth): MonochromeRaster | undefined {
  if (!url) return undefined;
  const key = `${paper}:${url}`;
  if (cache.has(key)) return cache.get(key);
  const entry = storedEntries().find(([storedKey]) => storedKey === key)?.[1];
  if (!entry || typeof entry !== "object") return undefined;
  const image = entry as Record<string, unknown>;
  const width = paper === 48 ? 576 : 384;
  if (image.width !== width || typeof image.height !== "number" || !Number.isSafeInteger(image.height) || image.height < 1 || image.height > MAX_LOGO_HEIGHT || !Array.isArray(image.data) || image.data.length !== width / 8 * image.height || !image.data.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return undefined;
  const raster: MonochromeRaster = { width, height: image.height, data: Uint8Array.from(image.data) };
  remember(key, raster, false);
  return raster;
}

function remember(key: string, raster: MonochromeRaster, persist = true): void {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, raster);
  if (!persist) return;
  try {
    const entries = storedEntries().filter(([storedKey]) => storedKey !== key);
    entries.push([key, { ...raster, data: Array.from(raster.data) }]);
    while (entries.length > MAX_CACHE_ENTRIES || JSON.stringify(entries).length > MAX_CACHE_BYTES) entries.shift();
    localStorage.setItem(BILL_LOGO_CACHE_KEY, JSON.stringify(entries));
  } catch { /* A full or unavailable store still permits the current text/image bill. */ }
}

/** Composite alpha onto white, resize without cropping, then pack black pixels MSB first. */
export function monochromeLogo(image: { width: number; height: number; data: Uint8ClampedArray }, paper: PaperWidth): MonochromeRaster {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.data.length !== image.width * image.height * 4) throw new Error("The logo image could not be read.");
  const width = paper === 48 ? 576 : 384;
  const height = Math.max(1, Math.min(MAX_LOGO_HEIGHT, Math.round(image.height * width / image.width)));
  // Tall images are fitted, not stretched; blank space remains white at the sides.
  const scale = Math.min(width / image.width, height / image.height);
  const drawnWidth = Math.max(1, Math.round(image.width * scale));
  const offset = Math.floor((width - drawnWidth) / 2);
  const data = new Uint8Array(width / 8 * height);
  for (let y = 0; y < height; y++) for (let x = offset; x < offset + drawnWidth; x++) {
    const sourceX = Math.min(image.width - 1, Math.floor((x - offset) / scale));
    const sourceY = Math.min(image.height - 1, Math.floor(y / scale));
    const i = (sourceY * image.width + sourceX) * 4;
    const alpha = image.data[i + 3] / 255;
    const grey = (0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2]) * alpha + 255 * (1 - alpha);
    if (grey < 128) data[y * width / 8 + Math.floor(x / 8)] |= 0x80 >> (x % 8);
  }
  return { width, height, data };
}

/** Branding is optional. A missing, unreadable or CORS-blocked image leaves a text bill. */
export async function loadBillLogo(url: string | undefined, width: PaperWidth, enabled = false, identity = url): Promise<MonochromeRaster | undefined> {
  if (!enabled || !url) return undefined;
  const key = `${width}:${identity}`;
  const saved = cachedBillLogo(identity, width);
  if (saved) return saved;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    const response = await fetch(parsed, { signal: AbortSignal.timeout(5000), credentials: "omit" });
    if (!response.ok) return undefined;
    const blob = await response.blob();
    if (blob.size > 5 * 1024 * 1024) return undefined;
    const bitmap = await createImageBitmap(blob);
    try {
      if (bitmap.width * bitmap.height > 16_000_000) return undefined;
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      context.drawImage(bitmap, 0, 0);
      const raster = monochromeLogo(context.getImageData(0, 0, bitmap.width, bitmap.height), width);
      remember(key, raster);
      return raster;
    } finally { bitmap.close(); }
  } catch { return undefined; }
}
