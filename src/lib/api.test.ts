import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api";
import { problemOf } from "./problemWords";
import { tenderProblem } from "../register/registerWords";

vi.mock("./peakConfig", () => ({ getApiBaseUrl: () => "http://127.0.0.1:18080" }));

/** Yetu's 429, as fbc-peak's rate limiter writes it (internal/platform/httpx/ratelimit.go). */
function tooMany(retryAfter: string | null) {
  const headers = new Headers({ "Content-Type": "application/problem+json" });
  if (retryAfter !== null) headers.set("Retry-After", retryAfter);
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Too many requests.",
      status: 429,
      detail: "Too many requests. Try again in 41 seconds.",
      code: "RATE_LIMITED",
      request_id: "req-1",
    }),
    { status: 429, headers },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("the transport", () => {
  it("carries Yetu's Retry-After with a 429's problem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => tooMany("42")));
    const result = await createApiClient().POST("/api/v1/pos/orders/o1/void", { body: {} });
    expect(result.error).toMatchObject({ code: "RATE_LIMITED", status: 429, retryAfterSeconds: 42 });
  });

  it("leaves the wait to the problem's own words when there is no header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => tooMany(null)));
    const result = await createApiClient().POST("/api/v1/pos/orders/o1/void", { body: {} });
    expect(result.error).toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect((result.error as { retryAfterSeconds?: number }).retryAfterSeconds).toBeUndefined();
  });
});

describe("a refusal's code reaches the words", () => {
  it("reads Yetu's application/problem+json as the problem it is", async () => {
    // A cashier without pos.payment.record, as Yetu refuses it.
    const refusal = {
      type: "about:blank",
      title: "Forbidden.",
      status: 403,
      detail: "permission denied",
      code: "FORBIDDEN",
      request_id: "req-2",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(refusal), { status: 403, headers: { "Content-Type": "application/problem+json" } })),
    );
    const result = await createApiClient().POST("/api/v1/pos/orders/o1/payments", { body: {} });
    expect(result.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    // The hooks throw `new Error(JSON.stringify(error))` (usePosData unwrap); the screens read it back.
    const thrown = new Error(JSON.stringify(result.error));
    expect(problemOf(thrown)).toMatchObject({ code: "FORBIDDEN" });
    expect(tenderProblem(thrown)?.words).toBe("Only a cashier or manager can take payment.");
  });
});
