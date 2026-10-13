import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_IDLE_LOCK_SECONDS,
  IDLE_LOCK_MAX_DEFERRAL_SECONDS,
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

  it("defers the lock while a money request is with Yetu, and locks as usual once it settles", () => {
    vi.useFakeTimers();
    let now = 0;
    const onIdle = vi.fn();
    const stop = watchIdleActivity(onIdle, { idleMs: 60_000, now: () => now });
    const release = holdIdleLock();
    expect(idleLockHeld()).toBe(true);
    now = 70_000;
    vi.advanceTimersByTime(250);
    expect(onIdle).not.toHaveBeenCalled();
    release();
    vi.advanceTimersByTime(250);
    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
  });

  it("a request that never settles still locks after the lock time plus the most it may defer", () => {
    vi.useFakeTimers();
    let now = 0;
    const onIdle = vi.fn();
    const stop = watchIdleActivity(onIdle, { idleMs: 60_000, now: () => now });
    const release = holdIdleLock();
    now = 60_000 + IDLE_LOCK_MAX_DEFERRAL_SECONDS * 1_000 - 1_000;
    vi.advanceTimersByTime(250);
    expect(onIdle).not.toHaveBeenCalled();
    now = 60_000 + IDLE_LOCK_MAX_DEFERRAL_SECONDS * 1_000 + 250;
    vi.advanceTimersByTime(250);
    expect(onIdle).toHaveBeenCalledTimes(1);
    release();
    stop();
  });

  it("never locks before its configured time, held or not", () => {
    vi.useFakeTimers();
    let now = 0;
    const onIdle = vi.fn();
    const stop = watchIdleActivity(onIdle, { idleMs: 60_000, now: () => now });
    const release = holdIdleLock();
    now = 59_000;
    vi.advanceTimersByTime(250);
    release();
    vi.advanceTimersByTime(250);
    expect(onIdle).not.toHaveBeenCalled();
    stop();
  });

  it("locks rather than stay open when something goes wrong in the watcher", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const stop = watchIdleActivity(onIdle, {
      idleMs: 60_000,
      onCountdown: () => {
        throw new Error("broken");
      },
    });
    vi.advanceTimersByTime(250);
    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
  });

  it("the most the lock may be deferred is a named setting", () => {
    expect(IDLE_LOCK_MAX_DEFERRAL_SECONDS).toBe(30);
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
