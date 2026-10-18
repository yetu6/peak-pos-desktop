import { describe, expect, it } from "vitest";
import { describePosError, POS_ERROR_KINDS, rateLimitWords, type PosErrorKind } from "./posErrors";

/** A problem as fbc-peak writes it (internal/platform/httpx/problem.go), for one code. */
function problem(code: string, extra: Record<string, unknown> = {}) {
  return { type: "about:blank", title: "x", status: 400, code, detail: "x", request_id: "req-1", ...extra };
}

/** One way to reach each kind, as Yetu (or the network) actually says it. */
const SAMPLE: Record<PosErrorKind, unknown> = {
  AUTHENTICATION_REQUIRED: problem("UNAUTHENTICATED", { status: 401 }),
  PERMISSION_DENIED: problem("FORBIDDEN", { status: 403 }),
  CAPABILITY_NOT_ENABLED: problem("CAPABILITY_NOT_ENABLED", { status: 403 }),
  DEVICE_REVOKED: problem("DEVICE_REVOKED", { status: 401 }),
  SESSION_EXPIRED: problem("SESSION_EXPIRED", { status: 401 }),
  STALE_VERSION: problem("STALE_VERSION", { status: 409 }),
  VALIDATION_ERROR: problem("VALIDATION_FAILED", { status: 422, detail: undefined }),
  BUSINESS_CONFLICT: problem("CONFLICT", { status: 409 }),
  NOT_FOUND: problem("NOT_FOUND", { status: 404 }),
  NO_APPROVER: problem("NO_APPROVER_SET", { status: 409 }),
  RATE_LIMITED: problem("RATE_LIMITED", { status: 429, detail: "Too many requests. Try again in 31 seconds.", retryAfterSeconds: 31 }),
  SERVER_UNAVAILABLE: problem("SERVICE_UNAVAILABLE", { status: 503 }),
  NETWORK_ERROR: new TypeError("Failed to fetch"),
  RETRYABLE_INFRASTRUCTURE_ERROR: problem("INTERNAL_ERROR", { status: 500 }),
  UNKNOWN: problem("SOMETHING_NEW", { status: 418 }),
};

describe("every Yetu refusal in words", () => {
  it.each(POS_ERROR_KINDS)("%s: a sentence and a next step, no codes", (kind) => {
    const described = describePosError(SAMPLE[kind]);
    expect(described.kind).toBe(kind);
    expect(described.sentence).toMatch(/^[A-Z].*\.$/);
    expect(described.nextStep).toMatch(/^[A-Z].*\.$/);
    expect(described.message).toBe(`${described.sentence} ${described.nextStep}`);
    // Words, not codes: no code, no status number, no old product name, no developer words.
    expect(described.message).not.toMatch(/[A-Z]{3,}_|\b(4|5)\d\d\b|HTTP|Peak|terminal|register|API|JSON|error/);
  });

  it("names a stale order as the spec writes it", () => {
    expect(describePosError(SAMPLE.STALE_VERSION).message).toBe(
      "This order changed on another till. We've reloaded it. Check it, then try again.",
    );
  });
});

describe("too many attempts (429)", () => {
  it("says to wait a minute when Yetu asks for a minute or less, and keeps how long", () => {
    const described = describePosError(SAMPLE.RATE_LIMITED);
    expect(described.message).toBe("Too many attempts. Wait a minute and try again.");
    expect(described.retryAfterSeconds).toBe(31);
    expect(described.retryable).toBe(true);
  });

  it("names the time when Yetu asks for longer", () => {
    const now = new Date(2026, 9, 12, 14, 2, 0);
    expect(rateLimitWords(1_800, now)).toBe("Too many attempts. Wait until 14:32 and try again.");
    expect(rateLimitWords(60, now)).toBe("Too many attempts. Wait a minute and try again.");
  });

  it("reads the wait from Yetu's own sentence when the header did not arrive", () => {
    const described = describePosError(problem("RATE_LIMITED", { status: 429, detail: "Too many requests. Try again in 12 seconds." }));
    expect(described.retryAfterSeconds).toBe(12);
  });

  it("reads a problem that reached the screen as JSON text (application/problem+json)", () => {
    const text = JSON.stringify(SAMPLE.RATE_LIMITED);
    expect(describePosError(text).kind).toBe("RATE_LIMITED");
    expect(describePosError(text).retryAfterSeconds).toBe(31);
  });
});
