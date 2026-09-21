import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Splash } from "./Splash";

describe("Splash", () => {
  it("shows calm branded progress, never a raw percentage or step count", () => {
    render(<Splash />);

    const screenEl = screen.getByTestId("splash-screen");
    // The brand is the lockup -- the FBC mark and the Yetu wordmark -- not a word.
    expect(screen.getAllByAltText("Yetu").length).toBeGreaterThan(0);
    expect(screenEl).toHaveTextContent("POS");
    expect(screenEl).toHaveTextContent("TERMINAL");
    expect(screenEl).toHaveTextContent("Preparing this terminal");
    expect(screenEl).not.toHaveTextContent(/%|step \d/i);
  });
});
