import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { noteUpdate, resetUpdateNotes } from "../lib/updateNotes";
import { noteRequestTime, resetRequestTimes } from "../lib/requestTimes";
import { Diagnostics } from "./Diagnostics";
import { clearOperationalSession, setOperationalSession } from "../lib/operationalSession";

const {
  probePeakServer,
  loadPrinterStatus,
  loadHostDiagnostics,
  loadDeviceKeyStorageStatus,
  printTestPage,
  realtime,
} = vi.hoisted(() => ({
  probePeakServer: vi.fn(),
  loadPrinterStatus: vi.fn(),
  loadHostDiagnostics: vi.fn(),
  loadDeviceKeyStorageStatus: vi.fn(),
  printTestPage: vi.fn(),
  realtime: { phase: "connected" as string, lastError: null as string | null },
}));

vi.mock("../lib/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("../lib/diagnostics")>("../lib/diagnostics");
  return {
    ...actual,
    probePeakServer,
    loadPrinterStatus,
    loadHostDiagnostics,
    printTestPage,
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
      phase: realtime.phase,
      attempt: 0,
      lastError: realtime.lastError,
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
    resetRequestTimes();
    realtime.phase = "connected";
    realtime.lastError = null;
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => true });
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
    await userEvent.click(screen.getByText("Details for support"));
    expect(await screen.findByTestId("diag-update-detail")).toHaveTextContent(
      "Could not fetch a valid release JSON from the remote",
    );
  });

  it("says when a found update didn't download", () => {
    healthy();
    noteUpdate({ kind: "download-failed", detail: "download interrupted", at: new Date(2026, 9, 12, 14, 5) });
    render(<Diagnostics />);
    expect(screen.getByTestId("diag-updates")).toHaveTextContent("An update was found but didn't download. It will try again.");
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
    await waitFor(() => expect(screen.getByTestId("diag-check-yetu")).toHaveTextContent("Yetu answers."));
    expect(screen.getByTestId("diag-check-live")).toHaveTextContent("On.");
    expect(screen.getByTestId("diag-check-receipt-printer")).toHaveTextContent("The till can send receipts to front-bar.");
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
    await userEvent.click(screen.getByText("Details for support"));

    expect(await screen.findByTestId("diag-technician-view")).toBeVisible();
    expect(screen.getByTestId("diag-app-version")).toHaveTextContent("0.1.0");
    expect(screen.getByTestId("diag-device-code")).toHaveTextContent("TILL-204");
    expect(screen.getByTestId("diag-device-id")).toHaveTextContent("device-uuid");
    // Friendly words in the details for support too (owner, 2026-10-19).
    expect(screen.getByTestId("diag-os")).toHaveTextContent("Linux, 64-bit");
    expect(screen.getByTestId("diag-technician-view")).not.toHaveTextContent(/x86_64|Realtime|Device id|unnamed/);
    // Yetu's own answer only in the row marked for support.
    expect(screen.getByTestId("diag-peak-detail")).toHaveTextContent("Answers");
    expect(screen.getByTestId("diag-peak-said")).toHaveTextContent("HTTP 200");
    const technical = screen.getByTestId("diag-technician-view").cloneNode(true) as HTMLElement;
    technical.querySelector("[data-testid=diag-peak-said]")?.remove();
    expect(technical).not.toHaveTextContent(/HTTP/);
    expect(screen.getByTestId("diag-printer-name")).toHaveTextContent("front-bar");
    expect(screen.getByTestId("diag-key-storage")).toHaveTextContent("file");
    expect(screen.queryByText("SECRET_PRIVATE_KEY")).not.toBeInTheDocument();
    expect(screen.queryByText("ops_SUPERSECRET")).not.toBeInTheDocument();
    expect(screen.queryByText("public-material")).not.toBeInTheDocument();
  });

  describe("checks in words, each with what to do", () => {
    it("a healthy till: every check says so, and the printer check says what it can't know", async () => {
      healthy();
      render(<Diagnostics />);
      await waitFor(() => expect(screen.getByTestId("diag-check-yetu")).toHaveTextContent("Yetu answers."));
      expect(screen.getByTestId("diag-check-internet")).toHaveTextContent("This till is on a network.");
      expect(screen.getByTestId("diag-check-live")).toHaveTextContent("On. New orders and changes show at once.");
      expect(screen.getByTestId("diag-check-receipt-printer")).toHaveTextContent(
        "The till can send receipts to front-bar. It can't tell whether the printer is on or has paper.",
      );
      expect(screen.getByTestId("diag-check-kitchen-printer")).toHaveTextContent(
        "Kitchen tickets print on the same printer as bills (front-bar). Kitchen and bar displays show them too.",
      );
      expect(screen.getByTestId("diag-check-keys")).toHaveTextContent("The till's key is in this computer's secure store.");
      for (const id of ["internet", "yetu", "live", "receipt-printer", "kitchen-printer", "keys"]) {
        expect(screen.getByTestId(`diag-check-${id}`).querySelector("[data-testid=diag-fix]")).not.toBeNull();
      }
    });

    it("problems say what to do", async () => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
      realtime.phase = "disconnected";
      realtime.lastError = "websocket closed: 1006";
      probePeakServer.mockResolvedValue({ status: "unreachable", detail: "Failed to fetch", origin: "https://hotel.example" });
      loadPrinterStatus.mockResolvedValue({ available: false, name: null });
      loadHostDiagnostics.mockResolvedValue({ os: "windows", arch: "x86_64", appVersion: "0.1.1" });
      loadDeviceKeyStorageStatus.mockResolvedValue({ hardwareBacked: false, backend: "file", warning: "file fallback" });
      render(<Diagnostics />);
      await waitFor(() => expect(screen.getByTestId("diag-check-yetu")).toHaveTextContent("Can't reach Yetu."));
      expect(screen.getByTestId("diag-check-internet")).toHaveTextContent("This till isn't on a network.");
      expect(screen.getByTestId("diag-check-internet")).toHaveTextContent("Check the network cable or Wi-Fi.");
      expect(screen.getByTestId("diag-check-yetu")).toHaveTextContent("Check the internet connection. If other computers reach Yetu, call support.");
      expect(screen.getByTestId("diag-check-live")).toHaveTextContent("Off. Orders and the kitchen board still ask Yetu every few seconds.");
      expect(screen.getByTestId("diag-check-receipt-printer")).toHaveTextContent("This computer has no way to print yet.");
      expect(screen.getByTestId("diag-check-receipt-printer")).toHaveTextContent("Ask support to set up the printer.");
      expect(screen.getByTestId("diag-check-keys")).toHaveTextContent("This till can't store its key safely.");
      expect(screen.getByTestId("diag-check-keys")).toHaveTextContent("Call support before taking payments.");
      // The checks are in staff words (owner, 2026-10-19)…
      expect(screen.getByRole("list", { name: "Checks" })).not.toHaveTextContent(/Failed to fetch|websocket|file fallback|unreachable/);
      expect(screen.getByTestId("diag-peak-detail")).toHaveTextContent("Can't be reached");
      // …and the details for support keep what the till actually saw, marked as for
      // support, so a call about a till that is offline can be answered (2026-10-20).
      expect(screen.getByText("Yetu's answer (for support)")).toBeInTheDocument();
      expect(screen.getByTestId("diag-peak-said")).toHaveTextContent("Failed to fetch");
      expect(screen.getByText("Last live-updates problem (for support)")).toBeInTheDocument();
      expect(screen.getByTestId("diag-realtime-said")).toHaveTextContent("websocket closed: 1006");
    });

    it("Yetu answering with a problem is not the hotel's internet", async () => {
      healthy();
      probePeakServer.mockResolvedValue({ status: "failing", detail: "HTTP 503", origin: "https://hotel.example" });
      render(<Diagnostics />);
      await waitFor(() => expect(screen.getByTestId("diag-check-yetu")).toHaveTextContent("Yetu answered, but has a problem right now."));
      expect(screen.getByTestId("diag-check-yetu")).toHaveAttribute("data-state", "problem");
      expect(screen.getByTestId("diag-check-yetu")).toHaveTextContent("It isn't this till's internet. If it lasts more than a few minutes, call support.");
      expect(screen.getByTestId("diag-check-yetu")).not.toHaveTextContent(/503|HTTP/);
      expect(screen.getByTestId("diag-peak-detail")).toHaveTextContent("Answers with a problem");
      expect(screen.getByTestId("diag-peak-said")).toHaveTextContent("HTTP 503");
    });

    it("a healthy till's details say what Yetu answered and that live updates had no problem", async () => {
      healthy();
      render(<Diagnostics />);
      await waitFor(() => expect(screen.getByTestId("diag-peak-said")).toHaveTextContent("HTTP 200"));
      expect(screen.getByTestId("diag-realtime-said")).toHaveTextContent("None");
      expect(screen.getByTestId("diag-answer-times")).toHaveTextContent("Nothing asked yet");
    });

    it("says how long Yetu takes to answer as this till waits (F-255)", async () => {
      healthy();
      noteRequestTime("POST", 410);
      noteRequestTime("GET", 190);
      render(<Diagnostics />);
      expect(screen.getByText("How long Yetu takes to answer (for support)")).toBeInTheDocument();
      expect(screen.getByTestId("diag-answer-times")).toHaveTextContent("Changes 0.41 s · Look-ups 0.19 s (usual of the last 2)");
    });

    it("in a browser there is no print path: no Print test page, and it says so", async () => {
      healthy();
      loadPrinterStatus.mockResolvedValue(null);
      render(<Diagnostics />);
      await waitFor(() => expect(screen.getByTestId("diag-check-receipt-printer")).toHaveTextContent("Printing works only in the till app on the counter computer."));
      expect(screen.queryByRole("button", { name: "Print test page" })).not.toBeInTheDocument();
    });

    it("Print test page goes through the till's own print path and says what happened", async () => {
      healthy();
      printTestPage.mockResolvedValueOnce({ ok: false, error: "No kitchen printer is configured" }).mockResolvedValueOnce({ ok: true });
      render(<Diagnostics />);
      const print = await screen.findByRole("button", { name: "Print test page" });
      await userEvent.click(print);
      const failed = await screen.findByTestId("diag-test-print-result");
      expect(failed).toHaveAttribute("role", "alert");
      expect(failed).toHaveTextContent("The test page didn't print. Check the printer is on, has paper and is this computer's default printer, then try again.");
      expect(failed).not.toHaveTextContent("No kitchen printer");
      await userEvent.click(screen.getByRole("button", { name: "Print test page" }));
      await waitFor(() => expect(screen.getByTestId("diag-test-print-result")).toHaveTextContent("Test page sent to the printer. Check it came out."));
      expect(screen.getByTestId("diag-test-print-result")).toHaveAttribute("role", "status");
      expect(printTestPage).toHaveBeenCalledTimes(2);
    });

    it("Check again asks every check again", async () => {
      healthy();
      render(<Diagnostics />);
      await waitFor(() => expect(probePeakServer).toHaveBeenCalledTimes(1));
      await userEvent.click(screen.getByRole("button", { name: "Check again" }));
      await waitFor(() => expect(probePeakServer).toHaveBeenCalledTimes(2));
      expect(loadPrinterStatus).toHaveBeenCalledTimes(2);
    });
  });
});

describe("Status: this computer's printers, for a manager", () => {
  afterEach(() => clearOperationalSession());

  function signIn(permissions: string[]) {
    setOperationalSession({
      token: "t",
      expiresAt: "2099-01-01T00:00:00Z",
      tenantId: "tenant-1",
      propertyId: "property-1",
      outletId: "outlet-1",
      terminalId: "device-uuid",
      staffId: "staff-12",
      assurance: "RESTRICTED",
      capabilities: ["CORE", "POS"],
      permissions,
    });
  }

  it("a manager sets the printers up here, beside the printer's check; a cashier doesn't see them", async () => {
    probePeakServer.mockResolvedValue({ status: "reachable", detail: "HTTP 200", origin: "https://hotel.example" });
    loadPrinterStatus.mockResolvedValue({ available: true, name: "front-bar" });
    loadHostDiagnostics.mockResolvedValue({ os: "linux", arch: "x86_64", appVersion: "0.1.0" });
    loadDeviceKeyStorageStatus.mockResolvedValue({ hardwareBacked: true, backend: "keyring", warning: null });
    signIn(["pos.order.read", "pos.report.manager"]);
    const { unmount } = render(<Diagnostics />);
    expect(await screen.findByTestId("printers-card")).toBeInTheDocument();
    unmount();
    signIn(["pos.order.read"]);
    render(<Diagnostics />);
    await screen.findByTestId("diagnostics");
    expect(screen.queryByTestId("printers-card")).toBeNull();
  });
});
