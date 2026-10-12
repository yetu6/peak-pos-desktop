import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { idleLockHeld } from "../lib/idleLock";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import { IdleLockOverlay, IdleLockView } from "./IdleLockOverlay";

const { switchStaff } = vi.hoisted(() => ({ switchStaff: vi.fn() }));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSession: () => ({ phase: "ready", switchStaff }),
}));

describe("IdleLockView", () => {
  it("says when the till locks and how to stay signed in", () => {
    render(<IdleLockView remaining={8} />);
    const overlay = screen.getByTestId("idle-lock-overlay");
    expect(overlay).toHaveAttribute("role", "alertdialog");
    expect(overlay).toHaveAccessibleName("Locking in 8 seconds");
    expect(screen.getByTestId("idle-lock-count")).toHaveTextContent("0:08");
    expect(overlay).toHaveTextContent("Locking in 0:08");
    expect(overlay).toHaveTextContent("Touch anywhere to stay signed in.");
  });

  it("writes longer waits as minutes and seconds", () => {
    render(<IdleLockView remaining={75} />);
    expect(screen.getByTestId("idle-lock-count")).toHaveTextContent("1:15");
  });
});

describe("IdleLockOverlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    switchStaff.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it("covers nothing until the last 10 seconds, so a closed-shift summary stays readable", () => {
    render(<IdleLockOverlay idleSeconds={60} />);
    advance(49_000);
    expect(screen.queryByTestId("idle-lock-overlay")).not.toBeInTheDocument();
    advance(1_500);
    expect(screen.getByTestId("idle-lock-overlay")).toBeInTheDocument();
    advance(10_000);
    expect(switchStaff).toHaveBeenCalledWith("Locked after idle");
  });

  it("a tap on the countdown only resets the timer: it stays until the tap ends, and the tap goes no further", () => {
    const pressed = vi.fn();
    document.addEventListener("click", pressed);
    render(<IdleLockOverlay idleSeconds={60} />);
    advance(52_000);
    const overlay = screen.getByTestId("idle-lock-overlay");
    fireEvent.pointerDown(overlay);
    expect(screen.getByTestId("idle-lock-overlay")).toBeInTheDocument();
    fireEvent.click(overlay);
    expect(pressed).not.toHaveBeenCalled();
    expect(screen.queryByTestId("idle-lock-overlay")).not.toBeInTheDocument();
    advance(49_000);
    expect(screen.queryByTestId("idle-lock-overlay")).not.toBeInTheDocument();
    expect(switchStaff).not.toHaveBeenCalled();
    document.removeEventListener("click", pressed);
  });
});

describe("useHoldIdleLock", () => {
  function Holder({ active }: { active: boolean }) {
    useHoldIdleLock(active);
    return null;
  }

  it("holds the lock while active and lets go after", () => {
    const view = render(<Holder active />);
    expect(idleLockHeld()).toBe(true);
    view.rerender(<Holder active={false} />);
    expect(idleLockHeld()).toBe(false);
    view.rerender(<Holder active />);
    view.unmount();
    expect(idleLockHeld()).toBe(false);
  });
});
