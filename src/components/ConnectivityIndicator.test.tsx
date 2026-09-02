import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConnectivityIndicator } from "./ConnectivityIndicator";

vi.mock("../realtime/RealtimeProvider", () => ({
  useRealtime: () => ({
    state: {
      phase: "reconnecting",
      attempt: 2,
      resyncGeneration: 1,
      lastError: null,
    },
  }),
}));

describe("ConnectivityIndicator", () => {
  it("announces operational connection changes without relying on color", () => {
    render(<ConnectivityIndicator />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Reconnecting");
    expect(status).toHaveAccessibleName("Connection status: Reconnecting, attempt 2");
  });
});
