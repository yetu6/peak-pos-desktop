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
  it("the release build bakes in Yetu's API address", async () => {
    const { readFileSync } = await import("node:fs");
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    // The step that runs `bunx tauri build`: from its `- name:` to the command.
    const command = workflow.indexOf("bunx tauri build");
    const step = workflow.slice(workflow.lastIndexOf("- name:", command), command);
    expect(step).toMatch(/^ +VITE_PEAK_API_URL: \$\{\{ vars\.YETU_API_URL \|\| 'https:\/\/api\.yetu\.fbcsoftwares\.com' \}\}$/m);
    expect(validatePeakApiUrl("https://api.yetu.fbcsoftwares.com").ok).toBe(true);
  });

  it("no env file in the repository sets it, so a developer's own .env.local keeps working", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    for (const file of [".env", ".env.production", ".env.development"]) {
      if (existsSync(file)) expect(readFileSync(file, "utf8")).not.toMatch(/^VITE_PEAK_API_URL=/m);
    }
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
