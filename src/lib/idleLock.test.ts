import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_IDLE_LOCK_SECONDS,
  idleLockMs,
  idleLockSecondsFromEnv,
  watchIdleActivity,
} from "./idleLock";

describe("idleLock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to ten seconds", () => {
    expect(DEFAULT_IDLE_LOCK_SECONDS).toBe(10);
    expect(idleLockSecondsFromEnv(undefined)).toBe(10);
    expect(idleLockMs(10)).toBe(10_000);
  });

  it("counts down and locks when idle, and activity cancels", () => {
    vi.useFakeTimers();
    let now = 1_000;
    const onIdle = vi.fn();
    const onCountdown = vi.fn();
    const stop = watchIdleActivity(onIdle, {
      idleMs: 1_000,
      onCountdown,
      now: () => now,
    });

    vi.advanceTimersByTime(250);
    now = 1_250;
    vi.advanceTimersByTime(250);
    expect(onCountdown).toHaveBeenCalled();
    expect(onIdle).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pointerdown"));
    now = 2_000;
    vi.advanceTimersByTime(250);
    expect(onCountdown).toHaveBeenCalledWith(null);

    now = 3_100;
    vi.advanceTimersByTime(1_200);
    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
  });
});
