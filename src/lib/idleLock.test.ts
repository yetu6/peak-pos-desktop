import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_IDLE_LOCK_SECONDS,
  IDLE_LOCK_WARNING_SECONDS,
  holdIdleLock,
  idleLockHeld,
  idleLockMs,
  idleLockSecondsFromEnv,
  watchIdleActivity,
} from "./idleLock";

describe("idleLock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("locks after a minute idle by default, and the build setting still overrides it", () => {
    expect(DEFAULT_IDLE_LOCK_SECONDS).toBe(60);
    expect(idleLockSecondsFromEnv(undefined)).toBe(60);
    expect(idleLockSecondsFromEnv("30")).toBe(30);
    expect(idleLockMs(60)).toBe(60_000);
    expect(IDLE_LOCK_WARNING_SECONDS).toBe(10);
  });

  it("never locks while a money request holds it, then waits a full idle window after", () => {
    vi.useFakeTimers();
    let now = 0;
    const onIdle = vi.fn();
    const stop = watchIdleActivity(onIdle, { idleMs: 60_000, now: () => now });
    const release = holdIdleLock();
    expect(idleLockHeld()).toBe(true);
    now = 120_000;
    vi.advanceTimersByTime(250);
    expect(onIdle).not.toHaveBeenCalled();
    release();
    expect(idleLockHeld()).toBe(false);
    now = 120_000 + 59_000;
    vi.advanceTimersByTime(250);
    expect(onIdle).not.toHaveBeenCalled();
    now = 120_000 + 60_250;
    vi.advanceTimersByTime(250);
    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
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
