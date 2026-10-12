import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { noteUpdate, resetUpdateNotes } from "../lib/updateNotes";
import { Diagnostics } from "./Diagnostics";

const {
  probePeakServer,
  loadPrinterStatus,
  loadHostDiagnostics,
  loadDeviceKeyStorageStatus,
} = vi.hoisted(() => ({
  probePeakServer: vi.fn(),
  loadPrinterStatus: vi.fn(),
  loadHostDiagnostics: vi.fn(),
  loadDeviceKeyStorageStatus: vi.fn(),
}));

vi.mock("../lib/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("../lib/diagnostics")>("../lib/diagnostics");
  return {
    ...actual,
    probePeakServer,
    loadPrinterStatus,
    loadHostDiagnostics,
  };
});

vi.mock("../lib/deviceIdentity", async () => {
  const actual = await vi.importActual<typeof import("../lib/deviceIdentity")>(
    "../lib/deviceIdentity",
  );
  return {
    ...actual,
    loadDeviceKeyStorageStatus,
  };
});

vi.mock("../lib/peakConfig", () => ({
  getApiBaseUrl: () => "https://hotel.example",
}));

vi.mock("../realtime/RealtimeProvider", () => ({
  useRealtime: () => ({
    state: {
      phase: "connected",
      attempt: 0,
      lastError: null,
      established: true,
      resyncGeneration: 1,
    },
  }),
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSession: () => ({
    identity: {
      privateKeyPkcs8: "SECRET_PRIVATE_KEY",
      publicKeySpki: "public-material",
      deviceCode: "TILL-204",
      mode: "POS",
      terminalName: "Bar 1",
    },
    session: {
      token: "ops_SUPERSECRET",
      expiresAt: "2099-01-01T00:00:00Z",
      tenantId: "tenant-1",
      propertyId: "property-1",
      outletId: "outlet-1",
      terminalId: "device-uuid",
      staffId: "staff-12",
      assurance: "RESTRICTED",
    },
  }),
}));

describe("Diagnostics", () => {
  afterEach(() => {
    vi.clearAllMocks();
    resetUpdateNotes();
  });

  function healthy() {
    probePeakServer.mockResolvedValue({ status: "reachable", detail: "HTTP 200", origin: "https://hotel.example" });
    loadPrinterStatus.mockResolvedValue({ available: true, name: "front-bar" });
    loadHostDiagnostics.mockResolvedValue({ os: "linux", arch: "x86_64", appVersion: "0.1.0" });
    loadDeviceKeyStorageStatus.mockResolvedValue({ hardwareBacked: true, backend: "keyring", warning: null });
  }

  it("shows a quiet update problem on the Status screen in words, and its detail for a technician", async () => {
    healthy();
    noteUpdate({ kind: "check-failed", detail: "Could not fetch a valid release JSON from the remote", at: new Date(2026, 9, 12, 14, 5) });
    render(<Diagnostics />);
    expect(screen.getByTestId("diag-updates")).toHaveTextContent("Couldn't check for updates at 14:05. The till keeps working.");
    expect(screen.getByTestId("diag-updates")).not.toHaveTextContent("JSON");
    await userEvent.click(screen.getByTestId("diag-technician"));
    expect(await screen.findByTestId("diag-update-detail")).toHaveTextContent(
      "Could not fetch a valid release JSON from the remote",
    );
  });

  it("says when no update problem has been seen", () => {
    healthy();
    render(<Diagnostics />);
    expect(screen.getByTestId("diag-updates")).toHaveTextContent("No update problems since the till started.");
  });

  it("shows operator connectivity without secrets", async () => {
    probePeakServer.mockResolvedValue({
      status: "reachable",
      detail: "HTTP 401",
      origin: "https://hotel.example",
    });
    loadPrinterStatus.mockResolvedValue({ available: true, name: "front-bar" });
    loadHostDiagnostics.mockResolvedValue({
      os: "linux",
      arch: "x86_64",
      appVersion: "0.1.0",
    });
    loadDeviceKeyStorageStatus.mockResolvedValue({
      hardwareBacked: true,
      backend: "keyring",
      warning: null,
    });

    render(<Diagnostics />);

    expect(screen.getByTestId("diagnostics")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("diag-peak")).toHaveTextContent("Reachable"));
    expect(screen.getByTestId("diag-realtime")).toHaveTextContent("Live");
    expect(screen.getByTestId("diag-printer")).toHaveTextContent("Ready");
    expect(screen.queryByText("SECRET_PRIVATE_KEY")).not.toBeInTheDocument();
    expect(screen.queryByText("ops_SUPERSECRET")).not.toBeInTheDocument();
  });

  it("shows the embedded version and device code in technician view", async () => {
    probePeakServer.mockResolvedValue({
      status: "reachable",
      detail: "HTTP 200",
      origin: "https://hotel.example",
    });
    loadPrinterStatus.mockResolvedValue({ available: true, name: "front-bar" });
    loadHostDiagnostics.mockResolvedValue({
      os: "linux",
      arch: "x86_64",
      appVersion: "0.1.0",
    });
    loadDeviceKeyStorageStatus.mockResolvedValue({
      hardwareBacked: false,
      backend: "file",
      warning: "file fallback",
    });

    render(<Diagnostics />);
    await userEvent.click(screen.getByTestId("diag-technician"));

    expect(await screen.findByTestId("diag-technician-view")).toBeInTheDocument();
    expect(screen.getByTestId("diag-app-version")).toHaveTextContent("0.1.0");
    expect(screen.getByTestId("diag-device-code")).toHaveTextContent("TILL-204");
    expect(screen.getByTestId("diag-device-id")).toHaveTextContent("device-uuid");
    expect(screen.getByTestId("diag-os")).toHaveTextContent("linux");
    expect(screen.getByTestId("diag-printer-name")).toHaveTextContent("front-bar");
    expect(screen.getByTestId("diag-key-storage")).toHaveTextContent("file");
    expect(screen.queryByText("SECRET_PRIVATE_KEY")).not.toBeInTheDocument();
    expect(screen.queryByText("ops_SUPERSECRET")).not.toBeInTheDocument();
    expect(screen.queryByText("public-material")).not.toBeInTheDocument();
  });
});
