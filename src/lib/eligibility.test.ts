import { describe, expect, it } from "vitest";
import {
  LAST_KNOWN_GOOD_TTL_MS,
  decideEligibility,
  forgetReady,
  memoryEligibilityCache,
  rememberReady,
  sessionEligibilityCache,
} from "./eligibility";

describe("decideEligibility", () => {
  const tenantId = "tenant-1";
  const now = 1_000_000;

  it("stays LOADING while the check is in flight", () => {
    expect(
      decideEligibility({
        queryStatus: "loading",
        verifyBusinessSucceeded: null,
        tenantId,
        now,
        lastKnownGood: null,
      }),
    ).toBe("LOADING");
  });

  it("is READY only after a real verify_business success", () => {
    expect(
      decideEligibility({
        queryStatus: "success",
        verifyBusinessSucceeded: true,
        tenantId,
        now,
        lastKnownGood: null,
      }),
    ).toBe("READY");
  });

  it("is UNVERIFIED when Peak says the business is not cleared", () => {
    expect(
      decideEligibility({
        queryStatus: "success",
        verifyBusinessSucceeded: false,
        tenantId,
        now,
        lastKnownGood: { tenantId, observedAt: now },
      }),
    ).toBe("UNVERIFIED");
  });

  it("UNKNOWN never opens the till without a fresh last-known-good for this tenant", () => {
    expect(
      decideEligibility({
        queryStatus: "error",
        verifyBusinessSucceeded: null,
        tenantId,
        now,
        lastKnownGood: null,
      }),
    ).toBe("UNKNOWN");
    expect(
      decideEligibility({
        queryStatus: "error",
        verifyBusinessSucceeded: null,
        tenantId,
        now,
        lastKnownGood: { tenantId: "other", observedAt: now },
      }),
    ).toBe("UNKNOWN");
    expect(
      decideEligibility({
        queryStatus: "error",
        verifyBusinessSucceeded: null,
        tenantId,
        now,
        lastKnownGood: { tenantId, observedAt: now - LAST_KNOWN_GOOD_TTL_MS - 1 },
      }),
    ).toBe("UNKNOWN");
  });

  it("a short last-known-good READY observation survives a transient check failure", () => {
    expect(
      decideEligibility({
        queryStatus: "error",
        verifyBusinessSucceeded: null,
        tenantId,
        now,
        lastKnownGood: { tenantId, observedAt: now - LAST_KNOWN_GOOD_TTL_MS },
      }),
    ).toBe("READY");
  });
});

describe("eligibility cache", () => {
  it("remembers READY only for the tenant that was observed", () => {
    const cache = memoryEligibilityCache();
    rememberReady(cache, "tenant-1", 10);
    expect(cache.load("tenant-1")?.observedAt).toBe(10);
    expect(cache.load("tenant-2")).toBeNull();
    forgetReady(cache);
    expect(cache.load("tenant-1")).toBeNull();
  });

  it("round-trips through sessionStorage without treating another tenant as READY", () => {
    const storage = new Map<string, string>();
    const cache = sessionEligibilityCache({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
      removeItem: (key) => {
        storage.delete(key);
      },
    });
    rememberReady(cache, "tenant-1", 42);
    expect(cache.load("tenant-1")).toEqual({ tenantId: "tenant-1", observedAt: 42 });
    expect(cache.load("tenant-2")).toBeNull();
  });
});
