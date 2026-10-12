import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AccessBannersFixture,
  LockedPinPausedFixture,
  LockedRosterFixture,
  LockedRosterSearchFixture,
  NoShiftFixture,
  PairingDeclinedFixture,
  PairingFixture,
  PairingWaitingFixture,
  SetupProblemFixture,
  SplashFixture,
} from "./JourneyFixtures";

describe("JourneyFixtures", () => {
  it("renders the opening screen", () => {
    render(<SplashFixture />);
    expect(screen.getByTestId("splash-screen")).toHaveTextContent("Opening the till");
  });

  it("renders the server setup after an address the till will not use", async () => {
    render(<SetupProblemFixture />);
    await waitFor(() => expect(screen.getByTestId("setup-error")).toHaveTextContent("The address must start with https://"));
  });

  it("renders connecting the till before and after a code", () => {
    const { unmount } = render(<PairingFixture />);
    expect(screen.getByRole("button", { name: "Get a code" })).toBeInTheDocument();
    unmount();
    render(<PairingWaitingFixture />);
    expect(screen.getByTestId("pairing-code")).toHaveTextContent("7F3KQ-9ABCD");
    expect(screen.getByTestId("pairing-expiry")).toHaveTextContent(/This code works for \d:\d\d more/);
  });

  it("renders the declined till", () => {
    render(<PairingDeclinedFixture />);
    expect(screen.getByTestId("pairing-error")).toHaveTextContent("A manager declined this till.");
  });

  it("renders who's working, with a search for a large team", () => {
    const { unmount } = render(<LockedRosterFixture />);
    expect(screen.getByRole("heading", { name: "Who's working?" })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    unmount();
    render(<LockedRosterSearchFixture />);
    expect(screen.getByRole("searchbox", { name: "Find your name" })).toBeInTheDocument();
  });

  it("renders a paused PIN", () => {
    render(<LockedPinPausedFixture />);
    expect(screen.getByTestId("pin-error")).toHaveTextContent("Too many tries.");
  });

  it("renders the update and key-storage notices above the screen", () => {
    render(<AccessBannersFixture />);
    expect(screen.getByTestId("updater-ready")).toBeInTheDocument();
    expect(screen.getByTestId("key-storage-warning")).toBeInTheDocument();
  });

  it("keeps the open-shift composition until S3 redesigns it", () => {
    render(<NoShiftFixture />);
    expect(screen.getByTestId("open-shift-screen")).toBeInTheDocument();
  });
});
