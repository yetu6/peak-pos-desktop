import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KitchenBusyFixture, KitchenDisplayFixture, KitchenFixture } from "./KitchenFixtures";

describe("KitchenFixtures", () => {
  it("renders a selling till's board: new, late, preparing and ready", () => {
    render(<KitchenFixture />);
    expect(within(screen.getByTestId("kitchen-column-SENT")).getAllByRole("article")).toHaveLength(2);
    expect(screen.getByTestId("kitchen-age-order-138")).toHaveTextContent("Late · 18 min");
    expect(within(screen.getByTestId("kitchen-ticket-order-143")).getByText("New")).toBeInTheDocument();
    expect(screen.getByTestId("kitchen-age-order-141")).toHaveTextContent("Getting late · 12 min");
  });

  it("renders a display: no rail, its stations to choose from", () => {
    render(<KitchenDisplayFixture />);
    expect(screen.queryByTestId("terminal-navigation")).toBeNull();
    expect(screen.getByRole("radio", { name: "Grill" })).toBeInTheDocument();
  });

  it("renders a busy display with a long ticket, one held step and a refusal", () => {
    render(<KitchenBusyFixture />);
    expect(screen.getByRole("alert")).toHaveTextContent("Someone moved this ticket");
    expect(screen.getAllByRole("button", { name: /Marking ready…/ })).toHaveLength(1);
  });
});
