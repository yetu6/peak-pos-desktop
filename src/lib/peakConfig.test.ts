import { describe, expect, it } from "vitest";
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
