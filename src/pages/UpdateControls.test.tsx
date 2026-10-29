import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { packagedAppVersion } from "../lib/diagnostics";
import { Diagnostics } from "./Diagnostics";

const h = vi.hoisted(() => ({
  status: { kind: "ready", version: "0.1.8" } as { kind: string; version?: string; message?: string },
  permissions: ["pos.report.manager"] as string[],
  shift: null as { id: string } | null,
  phase: "ready",
  restartNow: vi.fn(async (_open: boolean) => undefined),
  checkNow: vi.fn(async () => undefined),
}));

vi.mock("../hooks/useShiftSafeUpdater", () => ({
  useShiftSafeUpdater: () => ({ status: h.status, restartNow: h.restartNow, checkNow: h.checkNow }),
}));
vi.mock("../hooks/usePosData", () => ({
  useHasPermission: (p: string) => h.permissions.includes(p),
  usePosShift: () => ({ shift: h.shift, isLoading: false }),
}));
vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSession: () => ({ phase: h.phase, identity: null, session: null }),
}));
vi.mock("../lib/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("../lib/diagnostics")>("../lib/diagnostics");
  return {
    ...actual,
    probePeakServer: vi.fn(async () => ({ status: "reachable", detail: "ok", origin: "https://x" })),
    loadPrinterStatus: vi.fn(async () => null),
    loadHostDiagnostics: vi.fn(async () => null),
  };
});
vi.mock("../lib/deviceIdentity", async () => ({
  ...(await vi.importActual<object>("../lib/deviceIdentity")),
  loadDeviceKeyStorageStatus: vi.fn(async () => null),
}));
vi.mock("../realtime/RealtimeProvider", () => ({
  useRealtime: () => ({ state: { phase: "connected", attempt: 0, lastError: null, established: true, resyncGeneration: 1 } }),
}));
vi.mock("../print/PrintersCard", () => ({ PrintersCard: () => null }));
vi.mock("../print/PrintQueueCard", () => ({ PrintQueueCard: () => null }));

beforeEach(() => {
  h.status = { kind: "ready", version: "0.1.8" };
  h.permissions = ["pos.report.manager"];
  h.shift = null;
  h.phase = "ready";
  vi.clearAllMocks();
});

describe("Status: version and updates", () => {
  it("shows the running version in the header", async () => {
    render(<Diagnostics />);
    expect(await screen.findByTestId("status-version")).toHaveTextContent(`Yetu ${packagedAppVersion()}`);
  });

  it.each([
    [{ kind: "checking" }, "Checking for updates…"],
    [{ kind: "latest" }, `You have the latest version (${packagedAppVersion()}).`],
    [{ kind: "downloading", version: "0.1.8" }, "Yetu 0.1.8 found. Downloading it now…"],
    [{ kind: "ready", version: "0.1.8" }, "Yetu 0.1.8 is ready."],
    [{ kind: "error", message: "no route to host" }, "Couldn't check for updates: no route to host"],
  ])("Check for updates now says %j", async (status, words) => {
    h.status = status;
    render(<Diagnostics />);
    expect(await screen.findByTestId("diag-update-check")).toHaveTextContent(words);
  });

  it("Check for updates now asks the shared updater", async () => {
    h.status = { kind: "idle" };
    render(<Diagnostics />);
    await userEvent.click(await screen.findByTestId("diag-check-updates"));
    expect(h.checkNow).toHaveBeenCalledTimes(1);
  });

  it("offers Restart to update now to a manager with no open shift", async () => {
    render(<Diagnostics />);
    await userEvent.click(await screen.findByTestId("diag-restart-update"));
    expect(h.restartNow).toHaveBeenCalledWith(false);
  });

  it("hides Restart with an open shift and says why", async () => {
    h.shift = { id: "shift-1" };
    render(<Diagnostics />);
    expect(await screen.findByTestId("diag-restart-blocked")).toHaveTextContent("Close the shift first");
    expect(screen.queryByTestId("diag-restart-update")).toBeNull();
  });

  it("hides Restart from a waiter", async () => {
    h.permissions = ["pos.order.send"];
    render(<Diagnostics />);
    await screen.findByTestId("status-version");
    expect(screen.queryByTestId("diag-restart-update")).toBeNull();
    expect(screen.queryByTestId("diag-restart-blocked")).toBeNull();
  });

  it("hides Restart until an update is ready", async () => {
    h.status = { kind: "latest" };
    render(<Diagnostics />);
    await screen.findByTestId("status-version");
    expect(screen.queryByTestId("diag-restart-update")).toBeNull();
  });

  it("keeps the on-screen keyboard setting on Status, Automatic to start with", async () => {
    window.localStorage.clear();
    render(<Diagnostics />);
    const card = await screen.findByTestId("keyboard-card");
    expect(within(card).getByRole("radio", { name: "Automatic" })).toBeChecked();
    await userEvent.click(within(card).getByRole("radio", { name: "Off" }));
    expect(window.localStorage.getItem("yetu.onScreenKeyboard")).toBe("off");
    await userEvent.click(within(card).getByRole("radio", { name: "Automatic" }));
  });
});
