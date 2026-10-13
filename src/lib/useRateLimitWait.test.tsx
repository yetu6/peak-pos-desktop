import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_FALLBACK_WAIT_SECONDS, useRateLimitWait } from "./useRateLimitWait";

/** A 429 as the hooks throw it (usePosData unwrap), with the wait the transport kept. */
function tooMany(retryAfterSeconds?: number): Error {
  return new Error(
    JSON.stringify({ status: 429, code: "RATE_LIMITED", detail: "Too many requests.", ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) }),
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useRateLimitWait", () => {
  it("holds the next attempt until Yetu's wait is over, then lets it go", () => {
    const onWaited = vi.fn();
    const { result, rerender } = renderHook(({ error }) => useRateLimitWait(error, onWaited), { initialProps: { error: tooMany(3) as unknown } });
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(2_999));
    expect(onWaited).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onWaited).toHaveBeenCalledTimes(1);
    rerender({ error: null });
    expect(result.current).toBe(false);
  });

  it("waits the named fallback when Yetu gave no time", () => {
    const onWaited = vi.fn();
    renderHook(() => useRateLimitWait(tooMany(), onWaited));
    act(() => vi.advanceTimersByTime(RATE_LIMIT_FALLBACK_WAIT_SECONDS * 1000 - 1));
    expect(onWaited).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onWaited).toHaveBeenCalledTimes(1);
  });

  it("holds nothing for any other refusal", () => {
    const onWaited = vi.fn();
    const { result } = renderHook(() => useRateLimitWait(new Error(JSON.stringify({ status: 403, code: "FORBIDDEN" })), onWaited));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(120_000));
    expect(onWaited).not.toHaveBeenCalled();
  });
});
