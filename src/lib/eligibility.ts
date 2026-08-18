/**
 * POS eligibility is a UX gate on top of Peak's backend verification check.
 * UNKNOWN never grants operational capability unless a short last-known-good
 * cache, from a real READY observation for this tenant, is still inside TTL.
 */

export type EligibilityDecision = "LOADING" | "READY" | "UNVERIFIED" | "UNKNOWN";

export interface LastKnownGood {
  tenantId: string;
  observedAt: number;
}

export interface EligibilityCache {
  load(tenantId: string): LastKnownGood | null;
  save(entry: LastKnownGood): void;
  clear(): void;
}

export const LAST_KNOWN_GOOD_TTL_MS = 2 * 60 * 1000;

const STORAGE_KEY = "peak-pos-eligibility-lkg";

export function memoryEligibilityCache(initial?: LastKnownGood | null): EligibilityCache {
  let value: LastKnownGood | null = initial ?? null;
  return {
    load(tenantId) {
      if (!value || value.tenantId !== tenantId) return null;
      return value;
    },
    save(entry) {
      value = entry;
    },
    clear() {
      value = null;
    },
  };
}

export function sessionEligibilityCache(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): EligibilityCache {
  return {
    load(tenantId) {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as LastKnownGood;
        if (!parsed.tenantId || parsed.tenantId !== tenantId) return null;
        if (typeof parsed.observedAt !== "number") return null;
        return parsed;
      } catch {
        return null;
      }
    },
    save(entry) {
      storage.setItem(STORAGE_KEY, JSON.stringify(entry));
    },
    clear() {
      storage.removeItem(STORAGE_KEY);
    },
  };
}

export function defaultEligibilityCache(): EligibilityCache {
  if (typeof sessionStorage === "undefined") {
    return memoryEligibilityCache();
  }
  return sessionEligibilityCache(sessionStorage);
}

export function decideEligibility(input: {
  queryStatus: "loading" | "success" | "error";
  verifyBusinessSucceeded: boolean | null;
  tenantId: string;
  now: number;
  lastKnownGood: LastKnownGood | null;
}): EligibilityDecision {
  if (input.queryStatus === "loading") return "LOADING";
  if (input.queryStatus === "success") {
    return input.verifyBusinessSucceeded === true ? "READY" : "UNVERIFIED";
  }
  const cached = input.lastKnownGood;
  if (
    cached &&
    cached.tenantId === input.tenantId &&
    input.now - cached.observedAt >= 0 &&
    input.now - cached.observedAt <= LAST_KNOWN_GOOD_TTL_MS
  ) {
    return "READY";
  }
  return "UNKNOWN";
}

export function rememberReady(
  cache: EligibilityCache,
  tenantId: string,
  now: number,
): void {
  cache.save({ tenantId, observedAt: now });
}

export function forgetReady(cache: EligibilityCache): void {
  cache.clear();
}
