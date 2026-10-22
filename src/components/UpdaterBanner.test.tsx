import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lastUpdateNote, resetUpdateNotes } from "../lib/updateNotes";
import { UpdaterBanner } from "./UpdaterBanner";

type Status =
  | { kind: "idle" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

const updater = vi.hoisted(() => ({
  status: { kind: "idle" } as Status,
  blockedReason: null as string | null,
  canInstall: false,
}));

vi.mock("../hooks/useShiftSafeUpdater", () => ({
  useShiftSafeUpdater: () => ({ status: updater.status, blockedReason: updater.blockedReason, canInstall: updater.canInstall, installNow: vi.fn() }),
}));

const device = vi.hoisted(() => ({ phase: "ready" as string }));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSession: () => ({ phase: device.phase }),
}));

function show(status: Status, blockedReason: string | null = null) {
  updater.status = status;
  updater.blockedReason = blockedReason;
}

beforeEach(() => {
  resetUpdateNotes();
  show({ kind: "idle" });
  device.phase = "ready";
  updater.canInstall = false;
});

describe("UpdaterBanner", () => {
  it("stays quiet when an update check fails, and records it for the Status screen", () => {
    show({ kind: "error", message: "Could not fetch a valid release JSON from the remote" });
    const { container } = render(<UpdaterBanner />);
    expect(container).toBeEmptyDOMElement();
    expect(lastUpdateNote()).toMatchObject({
      kind: "check-failed",
      detail: "Could not fetch a valid release JSON from the remote",
    });
  });

  it("stays quiet while an update is found and downloading", () => {
    show({ kind: "available", version: "0.2.0" });
    const { container, rerender } = render(<UpdaterBanner />);
    expect(container).toBeEmptyDOMElement();
    show({ kind: "downloading", version: "0.2.0" });
    rerender(<UpdaterBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stays quiet when a found update fails to download, and records it as that", () => {
    show({ kind: "available", version: "0.2.0" });
    const { container, rerender } = render(<UpdaterBanner />);
    show({ kind: "downloading", version: "0.2.0" });
    rerender(<UpdaterBanner />);
    show({ kind: "error", message: "download interrupted" });
    rerender(<UpdaterBanner />);
    expect(container).toBeEmptyDOMElement();
    expect(lastUpdateNote()).toMatchObject({ kind: "download-failed", detail: "download interrupted" });
  });

  it("does not call a later check's failure an install failure while the shift is on", () => {
    device.phase = "ready";
    show({ kind: "ready", version: "0.2.0" }, "Finish the shift or switch staff before installing an update.");
    const { rerender } = render(<UpdaterBanner />);
    show({ kind: "error", message: "Could not fetch a valid release JSON from the remote" });
    rerender(<UpdaterBanner />);
    expect(screen.queryByTestId("updater-failed")).not.toBeInTheDocument();
    expect(lastUpdateNote()?.kind).toBe("check-failed");
  });

  it("says an update is ready, and when it installs, in words", () => {
    show({ kind: "ready", version: "0.2.0" }, "Finish the shift or switch staff before installing an update.");
    render(<UpdaterBanner />);
    expect(screen.getByTestId("updater-ready")).toHaveTextContent(
      "An update is ready. It installs between 00:00 and 05:00 while the till is locked, or when the till is next started.",
    );
    expect(screen.getByTestId("updater-ready")).not.toHaveTextContent("0.2.0");
    expect(lastUpdateNote()?.kind).toBe("ready");
  });

  it("says the till is installing when nothing holds the update back", () => {
    show({ kind: "ready", version: "0.2.0" }, null);
    render(<UpdaterBanner />);
    expect(screen.getByTestId("updater-ready")).toHaveTextContent("Installing the update. The till restarts by itself.");
  });

  it("says in words when a ready update fails to install", () => {
    device.phase = "locked";
    updater.canInstall = true;
    show({ kind: "ready", version: "0.2.0" }, null);
    const { rerender } = render(<UpdaterBanner />);
    show({ kind: "error", message: "os error 5: access denied" });
    rerender(<UpdaterBanner />);
    const banner = screen.getByTestId("updater-failed");
    expect(banner).toHaveTextContent("The update didn't install. The till keeps working as it is; it will try again later.");
    expect(banner).not.toHaveTextContent("os error");
    expect(lastUpdateNote()).toMatchObject({ kind: "install-failed", detail: "os error 5: access denied" });
  });
});
