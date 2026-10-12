import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IdleLockView } from "./IdleLockOverlay";

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
