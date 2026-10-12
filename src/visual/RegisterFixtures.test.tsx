import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegisterFixture } from "./RegisterFixtures";

describe("RegisterFixtures", () => {
  it("renders the menu beside the ticket", () => {
    render(<RegisterFixture />);
    expect(screen.getByTestId("menu-grid")).toBeInTheDocument();
    expect(screen.getByTestId("ticket-panel")).toBeInTheDocument();
  });
});
