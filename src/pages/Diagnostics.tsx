import { CircleAlert, CircleCheck, CircleHelp, Printer, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import { useNetworkOnline } from "../access/useNetworkOnline";
import { Button, StatusChip, TechnicalDetails } from "../components/system";
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
import { useHasPermission } from "../hooks/usePosData";
import { PrintersCard } from "../print/PrintersCard";

/** The updater's last outcome, in words. */
function updateWords(note: UpdateNote | null): string {
  if (!note) return "No update problems since the till started.";
  if (note.kind === "ready") return "An update is ready. It installs the next time the till is locked.";
  if (note.kind === "download-failed") return "An update was found but didn't download. It will try again.";
  if (note.kind === "install-failed") {
    return `An update didn't install at ${clockTime(note.at)}. The till keeps working; it will try again later.`;
  }
  return `Couldn't check for updates at ${clockTime(note.at)}. The till keeps working.`;
}

type CheckState = "ok" | "problem" | "unknown";

export interface Check {
  id: string;
  name: string;
  state: CheckState;
  /** What the till knows, in one or two sentences. */
  words: string;
  /** What to do. */
  fix: string;
}

const STATE_CHIP: Record<CheckState, { tone: "success" | "danger" | "info"; words: string; icon: ReactNode }> = {
  ok: { tone: "success", words: "OK", icon: <CircleCheck aria-hidden="true" /> },
  problem: { tone: "danger", words: "Needs attention", icon: <CircleAlert aria-hidden="true" /> },
  unknown: { tone: "info", words: "Checking", icon: <CircleHelp aria-hidden="true" /> },
};

/** The six checks the spec names, from only what the till can truly know today. */
export function statusChecks(input: {
  online: boolean;
  peak: PeakProbe | null;
  realtime: string;
  printer: PrinterStatus | null;
  /** The till app (desktop) has a print path; a browser doesn't. */
  native: boolean;
  keyStorage: DeviceKeyStorageStatus | null;
}): Check[] {
  const printerName = input.printer?.name?.trim() || "this computer's default printer";
  const checks: Check[] = [
    input.online
      ? { id: "internet", name: "Internet", state: "ok", words: "This till is on a network.", fix: "If Yetu can't be reached, check the internet connection." }
      : { id: "internet", name: "Internet", state: "problem", words: "This till isn't on a network.", fix: "Check the network cable or Wi-Fi." },
    input.peak === null
      ? { id: "yetu", name: "Yetu", state: "unknown", words: "Asking Yetu…", fix: "Wait a moment." }
      : input.peak.status === "reachable"
        ? { id: "yetu", name: "Yetu", state: "ok", words: "Yetu answers.", fix: "Nothing to do." }
        : {
            id: "yetu",
            name: "Yetu",
            state: "problem",
            words: "Can't reach Yetu.",
            fix: "Check the internet connection. If other computers reach Yetu, call support.",
          },
    input.realtime === "connected"
      ? { id: "live", name: "Live updates", state: "ok", words: "On. New orders and changes show at once.", fix: "Nothing to do." }
      : input.realtime === "connecting" || input.realtime === "reconnecting"
        ? {
            id: "live",
            name: "Live updates",
            state: "unknown",
            words: "Reconnecting. Orders and the kitchen board still ask Yetu every few seconds.",
            fix: "Wait a moment. If it doesn't come back, lock the till and sign in again.",
          }
        : {
            id: "live",
            name: "Live updates",
            state: "problem",
            words: "Off. Orders and the kitchen board still ask Yetu every few seconds.",
            fix: "If it stays off, lock the till and sign in again.",
          },
    !input.native
      ? {
          id: "receipt-printer",
          name: "Receipt printer",
          state: "unknown",
          words: "Printing works only in the till app on the counter computer.",
          fix: "Use the till app to print.",
        }
      : input.printer?.available
        ? {
            id: "receipt-printer",
            name: "Receipt printer",
            state: "ok",
            words: `The till can send receipts to ${printerName}. It can't tell whether the printer is on or has paper.`,
            fix: "If nothing prints, check the printer is on, has paper and is this computer's default printer, then print a test page.",
          }
        : {
            id: "receipt-printer",
            name: "Receipt printer",
            state: "problem",
            words: "This computer has no way to print yet.",
            fix: "Ask support to set up the printer.",
          },
    !input.native
      ? {
          id: "kitchen-printer",
          name: "Kitchen printer",
          state: "unknown",
          words: "Printing works only in the till app on the counter computer.",
          fix: "Kitchen and bar displays show the tickets.",
        }
      : {
          id: "kitchen-printer",
          name: "Kitchen printer",
          state: input.printer?.available ? "ok" : "problem",
          words: `Kitchen tickets print on the same printer as receipts (${input.printer?.name?.trim() || "the default printer"}). Kitchen and bar displays show them too.`,
          fix: input.printer?.available ? "A separate kitchen printer isn't possible yet." : "Ask support to set up the printer.",
        },
    input.keyStorage === null
      ? { id: "keys", name: "Secure key storage", state: "unknown", words: "Checking the till's key…", fix: "Wait a moment." }
      : input.keyStorage.hardwareBacked
        ? { id: "keys", name: "Secure key storage", state: "ok", words: "The till's key is in this computer's secure store.", fix: "Nothing to do." }
        : {
            id: "keys",
            name: "Secure key storage",
            state: "problem",
            words: "This till can't store its key safely.",
            fix: "Call support before taking payments.",
          },
  ];
  return checks;
}

function CheckRow({ check }: { check: Check }) {
  const chip = STATE_CHIP[check.state];
  return (
    <li className="y-status__check" data-testid={`diag-check-${check.id}`}>
      <div className="y-status__head">
        <h3 className="y-status__name">{check.name}</h3>
        <StatusChip tone={chip.tone} icon={chip.icon}>
          {chip.words}
        </StatusChip>
      </div>
      <p className="y-status__words">{check.words}</p>
      <p className="y-status__fix" data-testid="diag-fix">
        {check.fix}
      </p>
    </li>
  );
}

function TechRow({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd data-testid={testId}>{children}</dd>
    </>
  );
}

/**
 * Status: how this till is doing, in words, each check with what to do, and
 * Print test page where the till app has a print path. Technical details
 * hold the technician snapshot (never a secret).
 */
export function Diagnostics() {
  const { state } = useRealtime();
  const isManager = useHasPermission("pos.report.manager");
  const { identity, session } = useDeviceSession();
  const updateNote = useLastUpdateNote();
  const online = useNetworkOnline();
  const [peak, setPeak] = useState<PeakProbe | null>(null);
  const [printer, setPrinter] = useState<PrinterStatus | null>(null);
  const [host, setHost] = useState<HostDiagnostics | null>(null);
  const [keyStorage, setKeyStorage] = useState<DeviceKeyStorageStatus | null>(null);
  const [native, setNative] = useState(false);
  const [checking, setChecking] = useState(false);
  const [testPrint, setTestPrint] = useState<{ ok: boolean; detail: string | null } | null>(null);
  const [testPrintBusy, setTestPrintBusy] = useState(false);

  const refresh = useCallback(async () => {
    setChecking(true);
    setPeak(null);
    const [nextPeak, nextPrinter, nextHost, nextKeys] = await Promise.all([
      probePeakServer(),
      loadPrinterStatus(),
      loadHostDiagnostics(),
      loadDeviceKeyStorageStatus(),
    ]);
    setPeak(nextPeak);
    setPrinter(nextPrinter);
    // Only the till app answers the printer check (a browser has no print path).
    setNative(nextPrinter !== null);
    setHost(nextHost);
    setKeyStorage(nextKeys);
    setChecking(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runTestPrint() {
    setTestPrintBusy(true);
    setTestPrint(null);
    const result = await printTestPage();
    setTestPrint(result.ok ? { ok: true, detail: null } : { ok: false, detail: result.error });
    setTestPrintBusy(false);
  }

  return (
    <StatusView
      checks={statusChecks({ online, peak, realtime: state.phase, printer, native, keyStorage })}
      canPrintTestPage={native && printer?.available === true}
      checking={checking}
      onCheckAgain={() => void refresh()}
      testPrint={testPrint}
      testPrintBusy={testPrintBusy}
      onTestPrint={() => void runTestPrint()}
      updateNote={updateNote}
      snapshot={buildTechnicianSnapshot({ identity, session, host, printer, keyStorage, peakOrigin: getApiBaseUrl() })}
      peak={peak}
      realtime={state}
      printers={isManager ? <PrintersCard /> : null}
    />
  );
}

export interface StatusViewProps {
  checks: readonly Check[];
  /** The till app has a print path and a printer to send to (print_test_page). */
  canPrintTestPage: boolean;
  checking: boolean;
  onCheckAgain: () => void;
  testPrint: { ok: boolean; detail: string | null } | null;
  testPrintBusy: boolean;
  onTestPrint: () => void;
  updateNote: UpdateNote | null;
  snapshot: TechnicianSnapshot;
  peak: PeakProbe | null;
  realtime: { phase: string; attempt: number; lastError: string | null };
  /** Manager -> Printers (S8a/S8b): this computer's printers, set up beside the printer's check. */
  printers?: ReactNode;
}

/** The Status screen itself, from what the container found out. */
export function StatusView({
  checks,
  canPrintTestPage,
  checking,
  onCheckAgain,
  testPrint,
  testPrintBusy,
  onTestPrint,
  updateNote,
  snapshot,
  peak,
  realtime: state,
  printers = null,
}: StatusViewProps) {
  return (
    <div className="y-status" data-testid="diagnostics">
      <header className="y-status__top">
        <div>
          <h1 className="y-status__title">Status</h1>
          <p className="y-status__lede">How this till is doing, and what to do if something isn't right.</p>
        </div>
        <Button variant="secondary" icon={<RefreshCw />} disabled={checking} onClick={onCheckAgain}>
          {checking ? "Checking…" : "Check again"}
        </Button>
      </header>

      <ul className="y-status__checks" aria-label="Checks">
        {checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ul>

      {canPrintTestPage ? (
        <div className="y-status__print">
          <Button icon={<Printer />} disabled={testPrintBusy} onClick={onTestPrint}>
            {testPrintBusy ? "Sending…" : "Print test page"}
          </Button>
          {testPrint ? (
            <p className="y-status__result" role={testPrint.ok ? "status" : "alert"} data-testid="diag-test-print-result">
              {testPrint.ok
                ? "Test page sent to the printer. Check it came out."
                : "The test page didn't print. Check the printer is on, has paper and is this computer's default printer, then try again."}
            </p>
          ) : null}
        </div>
      ) : null}

      {printers}

      <section className="y-status__updates" aria-labelledby="diag-updates-title">
        <h2 id="diag-updates-title" className="y-status__name">
          Updates
        </h2>
        <p data-testid="diag-updates">{updateWords(updateNote)}</p>
      </section>

      <TechnicalDetails>
        <dl className="y-status__technical" data-testid="diag-technician-view">
          <TechRow label="App version" testId="diag-app-version">
            {snapshot.appVersion}
          </TechRow>
          <TechRow label="OS" testId="diag-os">
            {snapshot.os} {snapshot.arch}
          </TechRow>
          <TechRow label="Printer" testId="diag-printer-name">
            {snapshot.printerAvailable ? snapshot.printerName : `${snapshot.printerName} (not configured)`}
          </TechRow>
          <TechRow label="Device code" testId="diag-device-code">
            {snapshot.deviceCode}
          </TechRow>
          <TechRow label="Device id" testId="diag-device-id">
            {snapshot.deviceId}
          </TechRow>
          <TechRow label="Terminal" testId="diag-terminal">
            {snapshot.terminalName}
          </TechRow>
          <TechRow label="Mode" testId="diag-mode">
            {snapshot.mode}
          </TechRow>
          <TechRow label="Yetu address" testId="diag-peak-origin">
            {snapshot.peakOrigin}
          </TechRow>
          <TechRow label="Yetu check" testId="diag-peak-detail">
            {peak ? `${peak.status}, ${peak.detail}` : "checking"}
          </TechRow>
          <TechRow label="Realtime" testId="diag-realtime-detail">
            {state.phase}
            {state.attempt > 0 ? `, attempt ${state.attempt}` : ""}
            {state.lastError ? `, ${state.lastError}` : ""}
          </TechRow>
          <TechRow label="Key storage" testId="diag-key-storage">
            {snapshot.keyStorageBackend}
            {snapshot.keyStorageHardwareBacked === false ? " (not hardware-backed)" : ""}
          </TechRow>
          <TechRow label="Last test print" testId="diag-test-print-detail">
            {testPrint ? (testPrint.ok ? "sent" : testPrint.detail ?? "failed") : "none"}
          </TechRow>
          <TechRow label="Last update problem" testId="diag-update-detail">
            {updateNote && updateNote.kind !== "ready" ? updateNote.detail ?? "No detail" : "None"}
          </TechRow>
        </dl>
      </TechnicalDetails>
    </div>
  );
}
