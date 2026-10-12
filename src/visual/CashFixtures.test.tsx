import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CashCashierFixture,
  CashFixture,
  CloseCountFixture,
  CloseOverFixture,
  DayClosedFixture,
  NoShiftFixture,
  OpenShiftManagerFixture,
} from "./CashFixtures";

describe("CashFixtures", () => {
  it("renders opening the shift", () => {
    render(<NoShiftFixture />);
    expect(screen.getByTestId("open-shift-screen")).toBeInTheDocument();
  });

  it("renders the closed shift and Close the day for a manager", () => {
    render(<OpenShiftManagerFixture />);
    expect(screen.getByTestId("closed-shift-summary")).toHaveTextContent("Over by TSh 500");
    expect(screen.getByTestId("close-day")).toBeInTheDocument();
  });

  it("renders the Cash page", () => {
    render(<CashFixture />);
    expect(screen.getByTestId("cash-summary")).toBeInTheDocument();
  });

  it("renders a cashier's Cash page without the expected figure", () => {
    render(<CashCashierFixture />);
    expect(screen.getByTestId("open-close-shift")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/expected/i);
  });

  it("renders the day closed, with nothing to press again", () => {
    render(<DayClosedFixture />);
    expect(screen.getByTestId("day-close-result")).toBeInTheDocument();
    expect(screen.queryByTestId("close-business-day")).not.toBeInTheDocument();
  });

  it("renders the blind count and the manager approval", () => {
    const { unmount } = render(<CloseCountFixture />);
    expect(screen.getByTestId("close-step-count")).toBeInTheDocument();
    unmount();
    render(<CloseOverFixture />);
    expect(screen.getByRole("group", { name: "Supervisor PIN" })).toBeInTheDocument();
  });
});
