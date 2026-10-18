import { describe, expect, it, vi } from "vitest";
import { validatePeakApiUrl } from "./peakConfig";

describe("validatePeakApiUrl", () => {
  it("accepts HTTPS hotel addresses and strips a trailing slash", () => {
    const check = validatePeakApiUrl("https://pos.peak.example/");
    expect(check).toEqual({ ok: true, url: "https://pos.peak.example" });
  });

  it("allows HTTP only on localhost", () => {
    expect(validatePeakApiUrl("http://localhost:8080")).toEqual({
      ok: true,
      url: "http://localhost:8080",
    });
    expect(validatePeakApiUrl("http://hotel.example").ok).toBe(false);
  });

  it("rejects empty or non-http schemes", () => {
    expect(validatePeakApiUrl("").ok).toBe(false);
    expect(validatePeakApiUrl("ftp://peak.example").ok).toBe(false);
  });
});

describe("a released till is connected to Yetu (no server address to type)", () => {
  it("a production build carries Yetu's API address", async () => {
    const { loadEnv } = await import("vite");
    const env = loadEnv("production", process.cwd(), "VITE_");
    expect(env.VITE_PEAK_API_URL).toBe("https://api.yetu.fbcsoftwares.com");
    expect(validatePeakApiUrl(env.VITE_PEAK_API_URL).ok).toBe(true);
  });

  it("a development build carries none, so it can point at a local Yetu", async () => {
    const { loadEnv } = await import("vite");
    expect(loadEnv("development", process.cwd(), "VITE_").VITE_PEAK_API_URL).toBeUndefined();
  });

  it("with an address baked in and none stored, the till is connected before anyone types one", async () => {
    vi.stubEnv("VITE_PEAK_API_URL", "https://api.yetu.fbcsoftwares.com");
    localStorage.clear();
    const { loadPeakApiUrl, setConfiguredApiUrl } = await import("./peakConfig");
    setConfiguredApiUrl(null);
    expect(await loadPeakApiUrl()).toBe("https://api.yetu.fbcsoftwares.com");
    vi.unstubAllEnvs();
  });

  it("an address the till stored still wins over the baked-in one", async () => {
    vi.stubEnv("VITE_PEAK_API_URL", "https://api.yetu.fbcsoftwares.com");
    localStorage.setItem("peak-pos-api-url", "https://staging.example");
    const { loadPeakApiUrl, setConfiguredApiUrl } = await import("./peakConfig");
    setConfiguredApiUrl(null);
    expect(await loadPeakApiUrl()).toBe("https://staging.example");
    localStorage.clear();
    vi.unstubAllEnvs();
  });
});
