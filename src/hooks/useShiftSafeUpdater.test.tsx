import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShiftSafeUpdater } from "./useShiftSafeUpdater";

// The till's updater: one release found, downloaded, then installed only when allowed.
const updater = vi.hoisted(() => ({ download: vi.fn(), install: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(async () => ({ version: "0.1.5", download: updater.download, install: updater.install })),
}));
const device = vi.hoisted(() => ({ phase: "locked" as string }));
vi.mock("../auth/DeviceSessionProvider", () => ({ useDeviceSession: () => ({ phase: device.phase }) }));

const at = (hour: number, minute = 0) => new Date(2026, 9, 23, hour, minute);
/** Lets the found update download (promises only; the clock stays where the test put it). */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  updater.download.mockResolvedValue(undefined);
  updater.install.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.clearAllMocks();
});

describe("useShiftSafeUpdater (owner, 23 Oct: the new version takes over at midnight)", () => {
  it("waits for the night window once someone has signed in, then installs while the till is locked", async () => {
    vi.setSystemTime(at(13, 58));
    device.phase = "ready";
    const { result, rerender } = renderHook(() => useShiftSafeUpdater());
    await settle();
    expect(result.current.status.kind).toBe("ready");
    device.phase = "locked";
    rerender();
    expect(updater.install).not.toHaveBeenCalled();
    expect(result.current.blockedReason).toMatch(/between 00:00 and 05:00/);

    // The till looks at its clock each minute: 23:59 is outside the window, 00:00 inside.
    vi.setSystemTime(at(23, 58));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(updater.install).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(60_000));
    await settle();
    expect(updater.install).toHaveBeenCalledTimes(1);
  });

  it("a till just started installs before anyone signs in, whatever the hour", async () => {
    vi.setSystemTime(at(14, 0));
    device.phase = "locked";
    renderHook(() => useShiftSafeUpdater());
    await settle();
    expect(updater.install).toHaveBeenCalledTimes(1);
  });

  it("never installs while someone is signed in, even in the night window", async () => {
    vi.setSystemTime(at(1, 0));
    device.phase = "ready";
    const { result } = renderHook(() => useShiftSafeUpdater());
    await settle();
    expect(result.current.status.kind).toBe("ready");
    act(() => void vi.advanceTimersByTime(5 * 60_000));
    expect(updater.install).not.toHaveBeenCalled();
    expect(result.current.canInstall).toBe(false);
  });
});
