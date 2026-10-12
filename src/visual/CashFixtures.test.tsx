import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CashFixture, CloseCountFixture, CloseOverFixture, NoShiftFixture, OpenShiftManagerFixture } from "./CashFixtures";

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

  it("renders the blind count and the manager approval", () => {
    const { unmount } = render(<CloseCountFixture />);
    expect(screen.getByTestId("close-step-count")).toBeInTheDocument();
    unmount();
    render(<CloseOverFixture />);
    expect(screen.getByRole("group", { name: "Supervisor PIN" })).toBeInTheDocument();
  });
});
