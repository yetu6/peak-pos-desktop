import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  LockedPinFixture,
  LockedRosterFixture,
  NoShiftFixture,
  PairingFixture,
  PairingWaitingFixture,
  SplashFixture,
} from "./JourneyFixtures";

describe("JourneyFixtures", () => {
  it("renders the branded startup composition", () => {
    render(<SplashFixture />);
    expect(screen.getByTestId("splash-screen")).toBeInTheDocument();
  });

  it("renders the unpaired pairing composition", () => {
    render(<PairingFixture />);
    expect(screen.getByTestId("pairing-screen")).toBeInTheDocument();
    expect(screen.getByText("Generate pairing code")).toBeInTheDocument();
  });

  it("renders the waiting-for-approval pairing composition", () => {
    render(<PairingWaitingFixture />);
    expect(screen.getByText("Waiting for manager approval…")).toBeInTheDocument();
  });

  it("renders the tap-to-select staff roster composition", () => {
    render(<LockedRosterFixture />);
    expect(screen.getByText("Who's using this terminal?")).toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(3);
  });

  it("renders the PIN pad composition", () => {
    render(<LockedPinFixture />);
    expect(screen.getByText("Amina Hassan")).toBeInTheDocument();
    expect(screen.getByText("Unlock")).toBeInTheDocument();
  });

  it("renders the no-shift entry composition", () => {
    render(<NoShiftFixture />);
    expect(screen.getByTestId("open-shift-screen")).toBeInTheDocument();
    expect(screen.getByText("No shift is open on this register")).toBeInTheDocument();
  });
});
