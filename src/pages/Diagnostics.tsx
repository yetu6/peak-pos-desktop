import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { loadDeviceKeyStorageStatus, type DeviceKeyStorageStatus } from "../lib/deviceIdentity";
import {
  buildTechnicianSnapshot,
  loadHostDiagnostics,
  loadPrinterStatus,
  printTestPage,
  probePeakServer,
  type HostDiagnostics,
  type PeakProbe,
  type PrinterStatus,
  type TechnicianSnapshot,
} from "../lib/diagnostics";
import { getApiBaseUrl } from "../lib/peakConfig";
import { useLastUpdateNote, type UpdateNote } from "../lib/updateNotes";
import { clockTime } from "../lib/words";
import { useRealtime } from "../realtime/RealtimeProvider";

const REALTIME_LABEL: Record<string, string> = {
  connecting: "Connecting",
  connected: "Live",
  reconnecting: "Reconnecting",
  disconnected: "Offline",
  error: "Realtime error",
};

/** The updater's last outcome, in words for the operator view. */
function updateWords(note: UpdateNote | null): string {
  if (!note) return "No update problems since the till started.";
  if (note.kind === "ready") return "An update is ready. It installs the next time the till is locked.";
  if (note.kind === "install-failed") {
    return `An update didn't install at ${clockTime(note.at)}. The till keeps working; it will try again later.`;
  }
  return `Couldn't check for updates at ${clockTime(note.at)}. The till keeps working.`;
}

function toneClass(ok: boolean): string {
  return ok ? "badge badge-success" : "badge badge-danger";
}

function Row({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] py-3 last:border-0">
      <div className="text-[12px] font-medium text-[var(--foreground-muted)]">{label}</div>
      <div className="text-right text-[13px] text-[var(--foreground)]" data-testid={testId}>
        {children}
      </div>
    </div>
  );
}

export function Diagnostics() {
  const { state } = useRealtime();
  const { identity, session } = useDeviceSession();
  const updateNote = useLastUpdateNote();
  const [view, setView] = useState<"operator" | "technician">("operator");
  const [peak, setPeak] = useState<PeakProbe | null>(null);
  const [printer, setPrinter] = useState<PrinterStatus | null>(null);
  const [host, setHost] = useState<HostDiagnostics | null>(null);
  const [keyStorage, setKeyStorage] = useState<DeviceKeyStorageStatus | null>(null);
  const [testPrint, setTestPrint] = useState<string | null>(null);
  const [testPrintBusy, setTestPrintBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [nextPeak, nextPrinter, nextHost, nextKeys] = await Promise.all([
      probePeakServer(),
      loadPrinterStatus(),
      loadHostDiagnostics(),
      loadDeviceKeyStorageStatus(),
    ]);
    setPeak(nextPeak);
    setPrinter(nextPrinter);
    setHost(nextHost);
    setKeyStorage(nextKeys);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runTestPrint = useCallback(async () => {
    setTestPrintBusy(true);
    setTestPrint(null);
    const result = await printTestPage();
    setTestPrint(result.ok ? "Test page sent to the printer." : result.error);
    setTestPrintBusy(false);
    void refresh();
  }, [refresh]);

  const realtimeOk = state.phase === "connected";
  const peakOk = peak?.status === "reachable";
  const printerOk = printer?.available === true;
  const snapshot: TechnicianSnapshot = buildTechnicianSnapshot({
    identity,
    session,
    host,
    printer,
    keyStorage,
    peakOrigin: getApiBaseUrl(),
  });

  return (
    <div className="space-y-5" data-testid="diagnostics">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--foreground)]">Status</h1>
          <p className="mt-0.5 text-[12px] text-[var(--foreground-muted)]">
            Peak, realtime, and the printer — without secrets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="diag-operator"
            onClick={() => setView("operator")}
            className={`btn-sm ${view === "operator" ? "btn-primary" : "btn-tertiary"}`}
          >
            Operator
          </button>
          <button
            type="button"
            data-testid="diag-technician"
            onClick={() => setView("technician")}
            className={`btn-sm ${view === "technician" ? "btn-primary" : "btn-tertiary"}`}
          >
            Technician
          </button>
          <button
            type="button"
            data-testid="diag-refresh"
            onClick={() => void refresh()}
            className="btn-tertiary btn-sm"
            aria-label="Refresh status"
          >
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        </div>
      </div>

      {view === "operator" ? (
        <div className="glass-panel p-5" data-testid="diag-operator-view">
          <Row label="Peak server" testId="diag-peak">
            {peak ? (
              <span className={toneClass(peakOk)}>{peakOk ? "Reachable" : "Unreachable"}</span>
            ) : (
              "Checking…"
            )}
          </Row>
          <Row label="Realtime" testId="diag-realtime">
            <span className={toneClass(realtimeOk)}>
              {REALTIME_LABEL[state.phase] ?? state.phase}
            </span>
          </Row>
          <Row label="Printer" testId="diag-printer">
            {printer ? (
              <span className={toneClass(printerOk)}>
                {printerOk ? "Ready" : "Not configured"}
              </span>
            ) : (
              <span className="badge badge-muted">Unknown on this host</span>
            )}
          </Row>
          <Row label="Updates" testId="diag-updates">
            {updateWords(updateNote)}
          </Row>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="diag-test-print"
              className="btn-secondary btn-sm"
              disabled={testPrintBusy || printer?.available === false}
              onClick={() => void runTestPrint()}
            >
              {testPrintBusy ? "Sending…" : "Print test page"}
            </button>
            {testPrint ? (
              <p className="text-[12px] text-[var(--foreground-muted)]" data-testid="diag-test-print-result">
                {testPrint}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="glass-panel p-5" data-testid="diag-technician-view">
          <Row label="App version" testId="diag-app-version">
            {snapshot.appVersion}
          </Row>
          <Row label="OS" testId="diag-os">
            {snapshot.os} {snapshot.arch}
          </Row>
          <Row label="Printer" testId="diag-printer-name">
            {snapshot.printerAvailable
              ? snapshot.printerName
              : `${snapshot.printerName} (not configured)`}
          </Row>
          <Row label="Device code" testId="diag-device-code">
            {snapshot.deviceCode}
          </Row>
          <Row label="Device id" testId="diag-device-id">
            {snapshot.deviceId}
          </Row>
          <Row label="Terminal" testId="diag-terminal">
            {snapshot.terminalName}
          </Row>
          <Row label="Mode" testId="diag-mode">
            {snapshot.mode}
          </Row>
          <Row label="Peak" testId="diag-peak-origin">
            {snapshot.peakOrigin}
          </Row>
          <Row label="Key storage" testId="diag-key-storage">
            {snapshot.keyStorageBackend}
            {snapshot.keyStorageHardwareBacked === false ? " (not hardware-backed)" : ""}
          </Row>
          <Row label="Last update problem" testId="diag-update-detail">
            {updateNote && updateNote.kind !== "ready" ? updateNote.detail ?? "No detail" : "None"}
          </Row>
          <div className="mt-4">
            <button
              type="button"
              data-testid="diag-test-print-tech"
              className="btn-secondary btn-sm"
              disabled={testPrintBusy}
              onClick={() => void runTestPrint()}
            >
              {testPrintBusy ? "Sending…" : "Print test page"}
            </button>
            {testPrint ? (
              <p className="mt-2 text-[12px] text-[var(--foreground-muted)]">{testPrint}</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
