import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPLASH_SLOW_AFTER_MS } from "../access/accessSettings";
import { Splash } from "./Splash";

afterEach(() => {
  vi.useRealTimers();
});

describe("Splash", () => {
  it("opens the till calmly in words, never a percentage or a step count", () => {
    render(<Splash />);
    const screenEl = screen.getByTestId("splash-screen");
    // The brand is the lockup -- the FBC mark and the Yetu wordmark -- not a word.
    expect(screen.getAllByAltText("Yetu").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Opening the till" })).toBeInTheDocument();
    expect(screenEl).not.toHaveTextContent(/%|step \d|terminal|POS/i);
    expect(screen.queryByTestId("splash-slow")).not.toBeInTheDocument();
  });

  it("says what to do when opening takes longer than it should", () => {
    vi.useFakeTimers();
    render(<Splash />);
    act(() => {
      vi.advanceTimersByTime(SPLASH_SLOW_AFTER_MS - 1);
    });
    expect(screen.queryByTestId("splash-slow")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("splash-slow")).toHaveTextContent(
      "Opening is taking longer than usual. Check the till is connected to the internet. If nothing changes, close the till and open it again. If it keeps happening, call support.",
    );
  });

  it("keeps the slow-start wait in a named setting", () => {
    expect(SPLASH_SLOW_AFTER_MS).toBe(20_000);
  });
});
