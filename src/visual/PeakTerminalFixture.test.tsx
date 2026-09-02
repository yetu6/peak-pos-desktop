import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PeakTerminalFixture } from "./PeakTerminalFixture";

describe("PeakTerminalFixture", () => {
  it("exercises the responsive three-plane terminal composition", () => {
    render(<PeakTerminalFixture />);

    expect(screen.getByLabelText("Terminal navigation")).toBeInTheDocument();
    expect(screen.getByLabelText("Catalog workspace")).toBeInTheDocument();
    expect(screen.getByLabelText("Current order")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /add/i }).length).toBeGreaterThan(3);
  });
});
